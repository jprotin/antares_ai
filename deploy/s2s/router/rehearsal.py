"""Répétition d'une présentation : discours sur slides, questions-réponses, rapport noté.

Déroulé, piloté par l'interface au fil d'un même appel vocal :
1. discours  : l'utilisateur parle en faisant défiler ses slides ; le moteur vocal
               demande une réponse à chaque pause (pas d'option côté serveur pour s'en
               passer) : le routeur renvoie une réponse vide, l'IA se tait ;
2. questions : l'IA joue le public choisi (public type ou agent) et pose ses questions
               à partir du discours et des slides ; les tours du discours sont retirés
               de l'historique (repère QA_MARKER) ;
3. rapport   : le LLM rédige le rapport (JSON : grille notée, points forts, à améliorer,
               à ne pas dire, questions-réponses) ; les mesures (durée, débit, temps par
               slide) sont calculées ici, pas par le modèle. L'avatar le présente partie
               par partie : le routeur renvoie le texte prévu (repère REPORT_MARKER) ;
4. discussion : l'orateur discute le rapport (à l'écrit ou à la voix) ; le coach répond
               et peut réviser une note d'un point par critère et par message, sur un
               fait nouveau ou une erreur de sa part. La note d'origine, les échanges et
               les révisions sont conservés.

Les répétitions restent sur la machine : /data/rehearsals/<id>/ (meta.json + slides).
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from collections import Counter
from pathlib import Path

from pydantic import BaseModel, Field

REHEARSALS_DIR = Path(os.environ.get("REHEARSALS_PATH", "/data/rehearsals"))
MAX_PDF_BYTES = 15 * 1024 * 1024
MAX_SLIDES = 80
SLIDE_WIDTH = 1600
# Phase oubliée (onglet fermé en plein discours) : l'appel suivant ne doit pas rester muet
LIVE_TTL_S = 3 * 3600
# Texte envoyé au LLM pour le rapport : discours + slides + questions (~17 000 tokens)
MAX_REPORT_CHARS = 60_000

QA_MARKER = "[Fin du discours]"
REPORT_MARKER = "[Rapport, partie "

AUDIENCES = {
    "client": {
        "name": "Client exigeant",
        "persona": (
            "un décideur côté client (DSI ou directeur métier) qui doit choisir de "
            "signer ou non. Tu es courtois mais exigeant : tu demandes des preuves, des "
            "chiffres, les risques, le coût, le planning et ce que tu y gagnes."
        ),
    },
    "jury": {
        "name": "Jury de soutenance",
        "persona": (
            "un membre de jury de soutenance. Tu vérifies la maîtrise du sujet, la "
            "démarche, les choix faits et leurs justifications, les limites et ce qui "
            "aurait pu être fait autrement."
        ),
    },
    "conference": {
        "name": "Public de conférence",
        "persona": (
            "une personne du public d'une conférence technique, curieuse et un peu "
            "pointue : tu demandes des détails concrets, des retours d'expérience, "
            "ce qui n'a pas marché et comment l'appliquer chez soi."
        ),
    },
    "codir": {
        "name": "Comité de direction",
        "persona": (
            "un membre de comité de direction pressé : tu vas à l'essentiel, tu "
            "questionnes l'enjeu, le retour sur investissement, les arbitrages "
            "demandés et la décision attendue."
        ),
    },
}

# Grille : 5 critères notés sur 4, total sur 20
CRITERIA = [
    ("structure", "Structure et fil conducteur"),
    ("clarity", "Clarté du message"),
    ("pace", "Rythme et gestion du temps"),
    ("slides", "Cohérence entre discours et slides"),
    ("answers", "Réponses aux questions"),
]
CRITERION_MAX = 4

# Mots de remplissage fréquents à l'oral (la transcription retire souvent les « euh »)
FILLERS = [
    "du coup",
    "en fait",
    "voilà",
    "genre",
    "bref",
    "quoi",
    "en gros",
    "effectivement",
    "globalement",
    "on va dire",
]

# Règles orales des questions du public (sans le personnage de l'avatar)
SPOKEN = (
    "Ta réponse sera lue à voix haute : parle en français, naturellement, en phrases "
    "courtes, sans Markdown, sans listes, sans titres ni emojis. "
)

DRAFT_HINT = (
    "Repères : le texte vient d'une transcription automatique (ponctuation et mots "
    "parfois approximatifs, hésitations souvent effacées) ; ne reproche pas les fautes "
    "de transcription."
)


class RehearsalError(ValueError):
    """Refus explicite, affiché tel quel à l'utilisateur."""


class RehearsalDraft(BaseModel):
    title: str = Field(default="", max_length=120)
    # Public type (AUDIENCES) ou "" quand un agent joue le public
    audience: str = "client"
    agent: str = ""
    goal: str = Field(default="", max_length=600)
    target_minutes: int = Field(default=0, ge=0, le=240)
    questions: int = Field(default=3, ge=1, le=8)


class Segment(BaseModel):
    slide: int = Field(ge=0)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(max_length=8000)


class SlideTime(BaseModel):
    slide: int = Field(ge=0)
    at: float = Field(ge=0)


class Talk(BaseModel):
    duration: float = Field(ge=0)
    segments: list[Segment] = Field(default=[], max_length=2000)
    slide_times: list[SlideTime] = Field(default=[], max_length=2000)


class Exchange(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=8000)


class QuestionsAndAnswers(BaseModel):
    exchanges: list[Exchange] = Field(default=[], max_length=200)


class DiscussionMessage(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


# --- Stockage ------------------------------------------------------------------------


def _folder(rehearsal_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{12}", rehearsal_id):
        raise RehearsalError("répétition inconnue")
    return REHEARSALS_DIR / rehearsal_id


def load(rehearsal_id: str) -> dict:
    path = _folder(rehearsal_id) / "meta.json"
    if not path.exists():
        raise RehearsalError("répétition inconnue")
    return json.loads(path.read_text(encoding="utf-8"))


def save(rehearsal: dict) -> dict:
    folder = _folder(rehearsal["id"])
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / "meta.json.tmp"
    tmp.write_text(json.dumps(rehearsal, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(folder / "meta.json")
    return rehearsal


def create(draft: RehearsalDraft, agent_name: str | None) -> dict:
    if draft.audience and draft.audience not in AUDIENCES:
        raise RehearsalError(f"public inconnu : {draft.audience}")
    if not draft.audience and not agent_name:
        raise RehearsalError("choisissez un public ou un agent")
    return save(
        {
            "id": uuid.uuid4().hex[:12],
            "created": time.time(),
            **draft.model_dump(),
            "title": draft.title.strip() or "Présentation",
            "audience_name": agent_name or AUDIENCES[draft.audience]["name"],
            "slides": [],
            "talk": None,
            "qa": [],
            "report": None,
            "discussion": [],
        }
    )


def summary(rehearsal: dict) -> dict:
    report = rehearsal.get("report") or {}
    return {
        "id": rehearsal["id"],
        "created": rehearsal["created"],
        "title": rehearsal["title"],
        "audience_name": rehearsal["audience_name"],
        "slides": len(rehearsal["slides"]),
        "duration": (rehearsal.get("talk") or {}).get("duration"),
        "score": report.get("score"),
        "initial_score": report.get("initial_score"),
    }


def history() -> list[dict]:
    if not REHEARSALS_DIR.exists():
        return []
    found = []
    for meta in REHEARSALS_DIR.glob("*/meta.json"):
        try:
            found.append(summary(json.loads(meta.read_text(encoding="utf-8"))))
        except (ValueError, KeyError):
            continue
    return sorted(found, key=lambda r: r["created"], reverse=True)


def delete(rehearsal_id: str) -> None:
    folder = _folder(rehearsal_id)
    if live.get("id") == rehearsal_id:
        stop()
    shutil.rmtree(folder, ignore_errors=True)


def slide_path(rehearsal_id: str, number: int) -> Path:
    path = _folder(rehearsal_id) / "slides" / f"{number:03d}.jpg"
    if not path.exists():
        raise RehearsalError("slide inconnue")
    return path


def add_slides(rehearsal_id: str, pdf: bytes) -> dict:
    """PDF -> une image et le texte de chaque page (pdftoppm, pdftotext)."""
    rehearsal = load(rehearsal_id)
    if len(pdf) > MAX_PDF_BYTES:
        raise RehearsalError("PDF trop lourd (15 Mo au plus)")
    if not pdf.startswith(b"%PDF"):
        raise RehearsalError(
            "ce fichier n'est pas un PDF (exportez vos slides en PDF depuis "
            "PowerPoint, Keynote ou Google Slides)"
        )
    folder = _folder(rehearsal_id) / "slides"
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "slides.pdf"
        source.write_bytes(pdf)
        try:
            text = subprocess.run(
                ["pdftotext", "-layout", str(source), "-"],
                capture_output=True,
                check=True,
                timeout=120,
            ).stdout.decode("utf-8", "replace")
        except (subprocess.SubprocessError, OSError) as exc:
            raise RehearsalError("PDF illisible") from exc
        pages = text.split("\f")
        if pages and not pages[-1].strip():
            pages.pop()
        if not pages:
            raise RehearsalError("PDF vide")
        if len(pages) > MAX_SLIDES:
            raise RehearsalError(
                f"{len(pages)} slides : {MAX_SLIDES} au plus pour une répétition"
            )
        try:
            subprocess.run(
                [
                    "pdftoppm",
                    "-jpeg",
                    "-jpegopt",
                    "quality=85",
                    "-scale-to",
                    str(SLIDE_WIDTH),
                    str(source),
                    str(Path(tmp) / "page"),
                ],
                capture_output=True,
                check=True,
                timeout=300,
            )
        except (subprocess.SubprocessError, OSError) as exc:
            raise RehearsalError("impossible d'afficher les pages du PDF") from exc
        images = sorted(Path(tmp).glob("page-*.jpg"))
        for number, image in enumerate(images, start=1):
            shutil.move(image, folder / f"{number:03d}.jpg")
    rehearsal["slides"] = [
        {"number": n, "text": re.sub(r"[ \t]+", " ", page).strip()[:3000]}
        for n, page in enumerate(pages[: len(images)], start=1)
    ]
    return save(rehearsal)


def save_talk(rehearsal_id: str, talk: Talk) -> dict:
    rehearsal = load(rehearsal_id)
    rehearsal["talk"] = talk.model_dump()
    return save(rehearsal)


def save_qa(rehearsal_id: str, qa: QuestionsAndAnswers) -> dict:
    rehearsal = load(rehearsal_id)
    rehearsal["qa"] = [e.model_dump() for e in qa.exchanges if e.text.strip()]
    return save(rehearsal)


# --- Phase en cours (un seul appel vocal à la fois) ----------------------------------

live: dict = {}


def start(rehearsal_id: str, phase: str, persona: str = "") -> None:
    if phase not in {"speech", "qa", "report", "discussion"}:
        raise RehearsalError(f"phase inconnue : {phase}")
    rehearsal = load(rehearsal_id)
    if phase in {"report", "discussion"} and not rehearsal.get("report"):
        raise RehearsalError("le rapport n'est pas encore rédigé")
    live.clear()
    live.update(id=rehearsal_id, phase=phase, persona=persona, at=time.time())


def stop() -> None:
    live.clear()


def phase() -> str | None:
    if live and time.time() - live["at"] > LIVE_TTL_S:
        stop()
    return live.get("phase")


def _chunk(model: str, content: str | None = None, finish: str | None = None) -> bytes:
    delta = {"role": "assistant", "content": content} if content is not None else {}
    payload = {
        "id": "chatcmpl-rehearsal",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()


async def scripted(model: str, text: str):
    """Réponse imposée (vide pendant le discours), au format du flux OpenAI."""
    for sentence in re.split(r"(?<=[.!?…])\s+", text.strip()) if text else []:
        yield _chunk(model, sentence + " ")
    yield _chunk(model, finish="stop")
    yield b"data: [DONE]\n\n"


def _text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if p.get("type") == "text")
    return content or ""


def _clock(seconds: float) -> str:
    minutes, rest = divmod(int(round(seconds)), 60)
    return f"{minutes} min {rest:02d} s" if minutes else f"{rest} s"


def _slides_text(rehearsal: dict) -> str:
    return "\n".join(
        f"[Slide {s['number']}] {s['text'] or '(sans texte)'}"
        for s in rehearsal["slides"]
    )


def _talk_text(rehearsal: dict) -> str:
    """Discours regroupé par slide, avec le temps passé sur chacune."""
    talk = rehearsal.get("talk") or {}
    times = metrics(rehearsal)["per_slide"]
    lines = []
    for slide in times:
        said = " ".join(
            s["text"].strip()
            for s in talk.get("segments", [])
            if s["slide"] == slide["slide"] and s["text"].strip()
        )
        lines.append(
            f"[Slide {slide['slide']} — {_clock(slide['seconds'])}] "
            f"{said or '(rien dit)'}"
        )
    return "\n".join(lines)


def qa_messages(messages: list[dict]) -> list[dict]:
    """Questions-réponses : consigne du public, sans les tours du discours."""
    rehearsal = load(live["id"])
    persona = live.get("persona") or (
        "Tu joues "
        + AUDIENCES.get(rehearsal["audience"], AUDIENCES["client"])["persona"]
    )
    goal = (
        f"Objectif annoncé de la présentation : {rehearsal['goal']}\n"
        if rehearsal["goal"]
        else ""
    )
    system = (
        "EXERCICE DE RÉPÉTITION. L'utilisateur vient de répéter une présentation "
        f"intitulée « {rehearsal['title']} » devant toi. {persona}\n"
        f"{goal}"
        f"Pose exactement {rehearsal['questions']} questions, une seule à la fois, "
        "courte (une ou deux phrases), puis attends la réponse. Appuie-toi sur ce "
        "qu'il a dit et sur ses slides (cite le numéro de slide quand c'est utile) : "
        "points flous, affirmations sans preuve, oublis, risques. Si une réponse est "
        "vague ou évasive, relance une fois avant de passer à la question suivante. "
        "Ne donne aucun avis ni conseil sur sa prestation : le rapport viendra après. "
        "Après la réponse à ta dernière question, remercie-le en une phrase et dis "
        "qu'il peut cliquer sur « Voir le rapport ».\n\n"
        f"Slides :\n{_slides_text(rehearsal)}\n\n"
        f"Discours prononcé (transcription automatique) :\n{_talk_text(rehearsal)}"
    )
    after: list[dict] = []
    for message in reversed(messages):
        if message.get("role") == "system":
            continue
        if QA_MARKER in _text(message):
            break
        after.insert(0, message)
    start_turn = {
        "role": "user",
        "content": "J'ai terminé ma présentation. Pose ta première question.",
    }
    # La consigne de l'avatar (personnage, ton) est remplacée : le public parle
    return [{"role": "system", "content": SPOKEN + system}, start_turn, *after]


def last_said(messages: list[dict]) -> str:
    """Dernière parole de l'orateur (discussion du rapport à la voix)."""
    for message in reversed(messages):
        if message.get("role") == "user":
            return _text(message).strip()
    return ""


def report_part(messages: list[dict]) -> str:
    """Texte prévu pour la partie demandée du rapport (« [Rapport, partie 2] »)."""
    asked = _text(messages[-1]) if messages else ""
    found = re.search(re.escape(REPORT_MARKER) + r"(\d+)\]", asked)
    parts = load(live["id"])["report"]["script"]
    if not found or not 0 <= int(found.group(1)) < len(parts):
        return ""
    return parts[int(found.group(1))]["text"]


# --- Mesures et rapport -------------------------------------------------------------


def metrics(rehearsal: dict) -> dict:
    talk = rehearsal.get("talk") or {"duration": 0, "segments": [], "slide_times": []}
    duration = talk["duration"]
    words = " ".join(s["text"] for s in talk["segments"])
    word_count = len(re.findall(r"\w+", words))
    spent: Counter = Counter()
    changes = sorted(talk["slide_times"], key=lambda c: c["at"]) or [
        {"slide": 1, "at": 0}
    ]
    for current, following in zip(changes, [*changes[1:], None]):
        until = following["at"] if following else duration
        spent[current["slide"]] += max(0.0, until - current["at"])
    numbers = [s["number"] for s in rehearsal["slides"]] or sorted(spent)
    per_slide = [
        {
            "slide": n,
            "seconds": round(spent.get(n, 0.0), 1),
            "words": sum(
                len(re.findall(r"\w+", s["text"]))
                for s in talk["segments"]
                if s["slide"] == n
            ),
        }
        for n in numbers
    ]
    lowered = f" {words.lower()} "
    fillers = {
        f: count
        for f in FILLERS
        if (count := len(re.findall(rf"(?<!\w){re.escape(f)}(?!\w)", lowered))) >= 3
    }
    target = rehearsal.get("target_minutes") or 0
    return {
        "duration": round(duration, 1),
        "target_seconds": target * 60,
        "words": word_count,
        "words_per_minute": round(word_count / (duration / 60)) if duration else 0,
        "per_slide": per_slide,
        # Slide passée trop vite ou sans rien dire
        "skipped": [
            s["slide"] for s in per_slide if s["seconds"] < 5 or not s["words"]
        ],
        "fillers": dict(sorted(fillers.items(), key=lambda kv: -kv[1])),
    }


REPORT_RULES = f"""Tu es un coach en prise de parole, bienveillant mais franc.
Tu évalues la répétition d'une présentation : le discours prononcé slide par slide,
les mesures de temps, puis l'échange de questions-réponses avec le public.
{DRAFT_HINT}

Réponds UNIQUEMENT avec un objet JSON, en français, de la forme :
{{
 "verdict": "une phrase de bilan",
 "criteria": {{
   {", ".join(f'"{key}": {{"score": 0-{CRITERION_MAX}, "comment": "une phrase"}}' for key, _ in CRITERIA)}
 }},
 "strengths": ["point fort concret", "..."],
 "improvements": [{{"slide": numéro ou null, "issue": "ce qui ne va pas",
                    "advice": "ce qu'il faut faire, concrètement"}}],
 "avoid": [{{"quote": "phrase exacte prononcée", "why": "pourquoi l'éviter",
             "instead": "formulation proposée"}}],
 "answers": [{{"question": "question posée", "assessment": "qualité de la réponse",
               "better": "meilleure réponse possible, en une ou deux phrases"}}]
}}

Critères (notes entières de 0 à {CRITERION_MAX}) :
{chr(10).join(f"- {key} : {label}" for key, label in CRITERIA)}

Règles :
- 2 à 4 points forts ; 3 à 6 améliorations, de la plus importante à la moins
  importante, rattachées à une slide quand c'est possible ;
- "avoid" : 0 à 5 phrases réellement prononcées (citation exacte du discours ou des
  réponses) qui desservent l'orateur : excuses, dévalorisation, jargon non expliqué,
  promesses risquées, approximations ; liste vide si rien de tel ;
- "answers" : une entrée par question du public ; liste vide s'il n'y en a pas eu ;
- tiens compte des mesures (débit, temps visé, slides survolées) pour le rythme ;
- dans les meilleures réponses et reformulations, n'invente ni chiffre ni fait : mets
  entre crochets ce que l'orateur doit compléter (ex. [source de l'estimation]) ;
- pas de Markdown dans les textes."""


def report_prompt(rehearsal: dict) -> str:
    measured = metrics(rehearsal)
    target = (
        f"durée visée {_clock(measured['target_seconds'])}"
        if measured["target_seconds"]
        else "pas de durée visée"
    )
    exchanges = "\n".join(
        f"{'Public' if e['role'] == 'assistant' else 'Orateur'} : {e['text']}"
        for e in rehearsal["qa"]
    )
    fillers = ", ".join(f"« {k} » ×{v}" for k, v in measured["fillers"].items())
    text = (
        f"Présentation : « {rehearsal['title']} », devant : "
        f"{rehearsal['audience_name']}.\n"
        + (f"Objectif : {rehearsal['goal']}\n" if rehearsal["goal"] else "")
        + f"Mesures : durée {_clock(measured['duration'])} ({target}), "
        f"{measured['words']} mots, {measured['words_per_minute']} mots par minute "
        "(repère : 120 à 160)"
        + (
            f", slides survolées : {', '.join(map(str, measured['skipped']))}"
            if measured["skipped"]
            else ""
        )
        + (f", mots de remplissage : {fillers}" if fillers else "")
        + f".\n\nSlides :\n{_slides_text(rehearsal)}\n\n"
        f"Discours prononcé, slide par slide :\n{_talk_text(rehearsal)}\n\n"
        f"Questions-réponses :\n{exchanges or '(aucune)'}"
    )
    if len(text) > MAX_REPORT_CHARS:
        raise RehearsalError(
            "discours trop long pour être analysé en une fois "
            f"({len(text) // 1000} 000 caractères, {MAX_REPORT_CHARS // 1000} 000 au plus)"
        )
    return text


def _plain(value) -> str:
    """Texte sans Markdown (le modèle met parfois de l'emphase malgré la consigne)."""
    return re.sub(r"[*_`#]+", "", str(value or "")).strip()


def _items(value, keys: tuple[str, ...]) -> list[dict]:
    if not isinstance(value, list):
        return []
    found = []
    for item in value:
        if isinstance(item, dict) and _plain(item.get(keys[0])):
            found.append(
                {k: item.get(k) if k == "slide" else _plain(item.get(k)) for k in keys}
            )
    return found


def build_report(rehearsal: dict, answer: str) -> dict:
    """Réponse JSON du LLM -> rapport complet (note recalculée, mesures, texte parlé)."""
    try:
        raw = json.loads(answer[answer.find("{") : answer.rfind("}") + 1])
    except ValueError as exc:
        raise RehearsalError(
            "le modèle n'a pas rendu un rapport lisible, réessayez"
        ) from exc
    given = raw.get("criteria")
    if not isinstance(given, dict):
        given = {}
    criteria: list[dict] = []
    total = 0
    for key, label in CRITERIA:
        entry = given.get(key)
        if not isinstance(entry, dict):
            entry = {}
        try:
            score = min(CRITERION_MAX, max(0, int(round(float(entry.get("score", 0))))))
        except (TypeError, ValueError):
            score = 0
        if key == "answers" and not rehearsal["qa"]:
            score = 0
        total += score
        criteria.append(
            {
                "key": key,
                "label": label,
                "score": score,
                "max": CRITERION_MAX,
                "comment": _plain(entry.get("comment")),
            }
        )
    report = {
        "created": time.time(),
        "score": total,
        "out_of": CRITERION_MAX * len(CRITERIA),
        "verdict": _plain(raw.get("verdict")),
        "criteria": criteria,
        "strengths": [_plain(s) for s in raw.get("strengths") or [] if _plain(s)],
        "improvements": _items(raw.get("improvements"), ("issue", "slide", "advice")),
        "avoid": _items(raw.get("avoid"), ("quote", "why", "instead")),
        "answers": _items(raw.get("answers"), ("question", "assessment", "better")),
        "metrics": metrics(rehearsal),
    }
    report["script"] = script(report)
    return report


ORDINALS = [
    "Premièrement",
    "Deuxièmement",
    "Troisièmement",
    "Quatrièmement",
    "Cinquièmement",
    "Sixièmement",
]


def _spoken_number(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def script(report: dict) -> list[dict]:
    """Texte lu par l'avatar, une partie par section du rapport affiché."""
    parts = [
        {
            "section": "score",
            "text": (
                f"Votre note : {_spoken_number(report['score'])} sur "
                f"{report['out_of']}"
                + (
                    f", révisée depuis {_spoken_number(report['initial_score'])}. "
                    if report.get("initial_score") not in (None, report["score"])
                    else ". "
                )
                + f"{report['verdict']} "
                + " ".join(
                    f"{c['label']} : {c['score']} sur {c['max']}."
                    for c in report["criteria"]
                )
            ),
        }
    ]
    if report["strengths"]:
        parts.append(
            {
                "section": "strengths",
                "text": "Vos points forts. " + " ".join(report["strengths"]),
            }
        )
    if report["improvements"]:
        steps = []
        for index, item in enumerate(report["improvements"]):
            where = f"slide {item['slide']} : " if item.get("slide") else ""
            first = ORDINALS[index] if index < len(ORDINALS) else "Ensuite"
            steps.append(f"{first}, {where}{item['issue']} {item['advice'] or ''}")
        parts.append(
            {
                "section": "improvements",
                "text": "Ce qu'il faut améliorer, pas à pas. " + " ".join(steps),
            }
        )
    if report["avoid"]:
        quotes = [
            f"Vous avez dit : « {a['quote']} ». {a['why'] or ''} "
            + (f"Dites plutôt : « {a['instead']} »." if a.get("instead") else "")
            for a in report["avoid"]
        ]
        parts.append(
            {
                "section": "avoid",
                "text": "Ce qu'il vaut mieux ne pas dire. " + " ".join(quotes),
            }
        )
    if report["answers"]:
        parts.append(
            {
                "section": "answers",
                "text": "Vos réponses aux questions. "
                + " ".join(
                    f"À la question « {a['question']} » : {a['assessment'] or ''}"
                    for a in report["answers"]
                ),
            }
        )
    measured = report["metrics"]
    timing = f"Vous avez parlé {_clock(measured['duration'])}"
    if measured["target_seconds"]:
        gap = measured["duration"] - measured["target_seconds"]
        timing += (
            f", soit {_clock(abs(gap))} de {'trop' if gap > 0 else 'moins'} que prévu"
            if abs(gap) >= 30
            else ", dans le temps prévu"
        )
    timing += f", à {measured['words_per_minute']} mots par minute."
    if measured["fillers"]:
        top = list(measured["fillers"].items())[:3]
        timing += (
            " Mots qui reviennent souvent : "
            + ", ".join(f"« {word} », {count} fois" for word, count in top)
            + "."
        )
    parts.append(
        {
            "section": "metrics",
            "text": timing.replace(" min ", " minutes ")
            .replace(" s,", " secondes,")
            .replace(" s ", " secondes "),
        }
    )
    return parts


# --- Discussion du rapport ----------------------------------------------------------

# Révision d'une note : un point au plus par critère, sur toute la discussion (répéter
# un argument ne fait pas monter la note)
MAX_REVISION_STEP = 1
DISCUSSION_TURNS = 20
# Durée citée par l'orateur (« 30 secondes », « 10 min ») : comparée à la durée mesurée
DURATION_PATTERN = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(h|heures?|min|minutes?|s|sec|secondes?)\b", re.IGNORECASE
)

DISCUSSION_RULES = f"""Tu es le coach en prise de parole qui a rédigé le rapport
ci-dessous. L'orateur discute ton évaluation : réponds-lui franchement et avec
bienveillance, en t'adressant à lui (vous).
{DRAFT_HINT}

Réponds UNIQUEMENT avec un objet JSON, en français, de la forme :
{{
 "reply": "ton avis sur son argument, 2 à 4 phrases, sans Markdown",
 "revisions": [{{"criterion": "clé du critère", "score": nouvelle note entière,
                 "reason": "pourquoi, en une phrase"}}]
}}

Clés des critères (notes de 0 à {CRITERION_MAX}) :
{chr(10).join(f"- {key} : {label}" for key, label in CRITERIA)}

Règles :
- ne change une note que sur un fait nouveau (contexte, contrainte, intention
  expliquée) ou sur une erreur de ta part (transcription mal lue, slide mal
  attribuée) ; une contestation sans argument ou une insistance ne suffit pas :
  maintiens alors la note et dis ce qui te ferait changer d'avis ;
- un fait nouveau peut aussi faire baisser une note ;
- ne révise que les critères directement concernés par le message de l'orateur ;
- la durée et le débit sont mesurés, pas discutables : si l'orateur annonce une durée
  visée différente, compare-la à la durée mesurée ; s'il a parlé plus longtemps que
  cette nouvelle durée, il a dépassé et la note de rythme baisse ;
- une note ne s'écarte pas de plus de {MAX_REVISION_STEP} point de la note d'origine
  du rapport, sur toute la discussion ; un argument déjà pris en compte ne compte pas
  une seconde fois ;
- "revisions" est une liste vide quand aucune note ne change ;
- dans "reply", dis si l'argument est recevable et pourquoi, sans citer aucune note :
  la décision chiffrée est ajoutée à ta réponse d'après "revisions" ;
- n'invente ni chiffre ni fait sur la présentation."""


def cited_durations(text: str) -> list[float]:
    """Durées citées dans un message, en secondes."""
    unit = {"h": 3600, "m": 60, "s": 1}
    return [
        float(value.replace(",", ".")) * unit[name[0].lower()]
        for value, name in DURATION_PATTERN.findall(text)
    ]


def overruns(rehearsal: dict, text: str) -> list[str]:
    """Durée mesurée comparée à chaque durée citée (le modèle calcule mal)."""
    measured = metrics(rehearsal)["duration"]
    lines = []
    for seconds in cited_durations(text):
        gap = measured - seconds
        lines.append(
            f"si la durée visée est de {_clock(seconds)}, la durée mesurée "
            f"({_clock(measured)}) "
            + (
                f"la dépasse de {_clock(gap)} : la note de rythme ne peut pas monter"
                if gap > seconds * 0.1
                else "la respecte"
            )
        )
    return lines


def discussion_prompt(rehearsal: dict, text: str) -> str:
    report = rehearsal["report"]
    initial = _initial_scores(report)
    grid = "\n".join(
        f"- {c['key']} ({c['label']}) : {c['score']}/{c['max']}"
        + (
            f" (note d'origine {initial[c['key']]})"
            if initial[c["key"]] != c["score"]
            else ""
        )
        + f" — {c['comment']}"
        for c in report["criteria"]
    )
    computed = overruns(rehearsal, text)
    improvements = "\n".join(
        "- " + (f"slide {i['slide']} : " if i.get("slide") else "") + i["issue"]
        for i in report["improvements"]
    )
    thread = "\n".join(
        f"{'Coach' if m['role'] == 'assistant' else 'Orateur'} : {m['text']}"
        for m in rehearsal.get("discussion", [])[-DISCUSSION_TURNS:]
    )
    return (
        f"{report_prompt(rehearsal)}\n\n"
        f"Ton rapport : note {report['score']}/{report['out_of']}. "
        f"{report['verdict']}\nGrille :\n{grid}\n"
        f"À améliorer :\n{improvements or '(rien)'}\n\n"
        f"Discussion jusqu'ici :\n{thread or '(début)'}\n\n"
        + (
            "Calcul fait pour toi : " + " ; ".join(computed) + ".\n\n"
            if computed
            else ""
        )
        + f"Nouveau message de l'orateur : {text}"
    )


def _initial_scores(report: dict) -> dict:
    """Note d'origine de chaque critère (avant toute révision)."""
    initial = {c["key"]: c["score"] for c in report["criteria"]}
    for change in reversed(report.get("revisions", [])):
        initial[change["criterion"]] = change["before"]
    return initial


def discuss(rehearsal: dict, text: str, answer: str, via: str) -> dict:
    """Réponse JSON du coach -> réponse enregistrée, notes révisées, note recalculée."""
    try:
        raw = json.loads(answer[answer.find("{") : answer.rfind("}") + 1])
        reply = _plain(raw.get("reply"))
    except (ValueError, AttributeError) as exc:
        raise RehearsalError("le coach n'a pas pu répondre, réessayez") from exc
    # Notes recopiées malgré la consigne (« (revisions: pace 2/4…) ») : la décision
    # chiffrée est rédigée plus bas
    reply = re.sub(r"\s*\([^)]*\d\s*/\s*\d[^)]*\)", "", reply).strip()
    if not reply:
        raise RehearsalError("le coach n'a pas pu répondre, réessayez")
    report = rehearsal["report"]
    criteria = {c["key"]: c for c in report["criteria"]}
    initial = _initial_scores(report)
    measured = metrics(rehearsal)["duration"]
    cited = cited_durations(text)
    overrun = any(measured - d > d * 0.1 for d in cited)
    applied: list[dict] = []
    revisions = raw.get("revisions")
    for revision in revisions if isinstance(revisions, list) else []:
        if not isinstance(revision, dict):
            continue
        criterion = criteria.get(revision.get("criterion"))
        if not criterion or criterion["key"] in {r["criterion"] for r in applied}:
            continue
        if criterion["key"] == "answers" and not rehearsal["qa"]:
            continue
        # Argument de durée : il ne concerne que le rythme
        if cited and criterion["key"] != "pace":
            continue
        try:
            wanted = int(round(float(revision["score"])))
        except (KeyError, TypeError, ValueError):
            continue
        before = criterion["score"]
        origin = initial[criterion["key"]]
        after = min(
            CRITERION_MAX,
            max(0, origin - MAX_REVISION_STEP, min(origin + MAX_REVISION_STEP, wanted)),
        )
        if criterion["key"] == "pace" and overrun:
            after = min(after, before)
        if after == before:
            continue
        applied.append(
            {
                "at": time.time(),
                "criterion": criterion["key"],
                "label": criterion["label"],
                "before": before,
                "after": after,
                "reason": _plain(revision.get("reason")),
            }
        )
    if applied:
        report.setdefault("initial_score", report["score"])
        for change in applied:
            criteria[change["criterion"]]["score"] = change["after"]
        report["score"] = sum(c["score"] for c in report["criteria"])
        report.setdefault("revisions", []).extend(applied)
        report["script"] = script(report)
    # Décision chiffrée rédigée ici : l'écran et la voix disent la même chose
    if applied:
        reply += (
            " Je révise donc "
            + " ; ".join(
                f"{c['label']}, de {c['before']} à {c['after']} sur {CRITERION_MAX}"
                for c in applied
            )
            + f". Votre note passe à {_spoken_number(report['score'])} sur "
            f"{report['out_of']}."
        )
    else:
        reply += " Je maintiens vos notes."
    now = time.time()
    entry = {"role": "assistant", "text": reply, "at": now, "revisions": applied}
    rehearsal.setdefault("discussion", []).extend(
        [{"role": "user", "text": text.strip(), "at": now, "via": via}, entry]
    )
    return entry
