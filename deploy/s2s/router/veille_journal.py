"""La veille dans la conversation : l'avatar en parle, et présente le « journal ».

Deux usages, sur le dernier passage de la veille (veille.latest) :

- Questions en appel ou à l'écrit (« quoi de neuf dans l'IA ? », « tu as vu le truc sur
  Mistral ? ») : `wanted` repère la question, `context` ajoute à la consigne un résumé
  court du passage (météo, articles à la une, idées) et la manière d'en parler : raconter
  avec ses mots, donner son avis, demander celui de l'utilisateur ; ne jamais lire.
- Journal (bouton de la fenêtre Veille, ou « fais-moi le journal » en appel) : phase en
  cours tenue ici (`live`), comme la répétition. Le routeur choisit les sujets et garde
  l'index du sujet courant ; à chaque tour, le modèle ne reçoit que le sujet du moment
  et l'étape (ouvrir, réagir puis enchaîner, approfondir, idées, conclure) : un petit
  modèle se perd avec six sujets d'un coup.

Fonctions pures (sauf l'état `live`) : le routeur fait les lectures et l'appel au modèle.
"""

import re
import time
import unicodedata
from datetime import datetime

MARKER = "[Journal de la veille]"
TOPICS = 5
IDEAS = 2
CONTEXT_ITEMS = 15
SUMMARY_CHARS = 700
HISTORY_TURNS = 2
LIVE_TTL_S = 2 * 3600

ASK = re.compile(
    r" (veille|actu|actus|actualite|actualites|news|nouveaute|nouveautes|quoi de neuf"
    r"|journal|revue de presse|articles?|meteo|tes idees|les idees|idees du jour"
    r"|idees pour antares|ce matin dans|ce midi dans|ce soir dans|tu as vu|t as vu"
    r"|as tu vu|tu as lu|t as lu|as tu lu) "
)
JOURNAL_ASK = re.compile(
    r" (fais|fait|lance|raconte|donne|presente|commence)[a-z]* (moi |nous )?"
    r"(le|un|ton|la|ta) (journal|recap|recapitulatif|podcast|revue de presse|point)"
    r"| journal de la veille | (le|ton) journal (du jour|de l ia|tech) "
)
STOP = re.compile(
    r" (stop|arrete|arretes|arreter|termine|on arrete|ca suffit|fin du journal"
    r"|c est bon pour aujourd hui) "
)
SKIP = re.compile(
    r" (passe|passes|suivant|sujet suivant|suite|on continue|autre chose|next"
    r"|bof|pas interesse|ca m interesse pas|ca ne m interesse pas) "
)
MORE = re.compile(
    r" (plus de details|plus en detail|detaille|developpe|explique|c est a dire"
    r"|comment ca|raconte m en plus|dis m en plus|en savoir plus|precise) "
)
QUESTION_START = re.compile(
    r"^ (pourquoi|comment|qu est ce|est ce|c est quoi|quel|quelle|quels|quelles|qui"
    r"|combien|ou|quand) "
)
TITLE_WORD = re.compile(r"\b[A-Z][A-Za-z0-9.+-]{3,}")
COMMON_WORDS = {
    "pour",
    "dans",
    "avec",
    "sans",
    "plus",
    "comment",
    "pourquoi",
    "nouveau",
    "nouvelle",
    "nouvelles",
    "nouveaux",
    "leur",
    "votre",
    "notre",
    "cette",
    "what",
    "with",
    "from",
    "your",
    "this",
    "that",
    "when",
    "how",
    "why",
    "the",
    "les",
    "une",
    "des",
    "sur",
    "est",
    "sont",
    "news",
    "update",
    "release",
    "version",
}

TALK_RULES = (
    "Tu as lu toi-même la veille ci-dessus. Quand l'utilisateur t'en parle : ne lis "
    "jamais un article ni la liste, et n'énumère pas les titres. Raconte avec tes mots, "
    "en deux ou trois phrases, ce qui t'a marqué, ajoute ton avis personnel (une "
    "phrase, avec ton caractère), puis demande-lui ce qu'il en pense. Ne parle que de "
    "ce qui est dans la veille ; s'il demande un détail absent, dis que tu n'as lu que "
    "le résumé. Pas d'adresse web à l'oral."
)
JOURNAL_RULES = (
    "JOURNAL DE LA VEILLE. Tu présentes à l'utilisateur, à ta façon et avec ton "
    "caractère, le journal de la veille du jour, comme un présentateur complice à la "
    "radio. Règles : ne lis jamais un article, ne récite pas le résumé, n'annonce pas "
    "de numéro de sujet ni de liste ; raconte avec tes mots, en phrases courtes "
    "faites pour l'oral (pas de liste, pas de markdown, pas d'adresse web). Quand tu "
    "poses une question, arrête-toi juste après : c'est à lui de parler. Le dernier "
    "message contient une note de régie entre crochets : elle vient de la production, "
    "pas de l'utilisateur ; suis-la à la lettre, ne la mentionne jamais et ne parle "
    "que du sujet qu'elle donne, sans rien inventer."
)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " " + re.sub(r"[^a-z0-9]+", " ", text).strip() + " "


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return ""


def last_said(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return _text(message.get("content")).strip()
    return ""


def _run(latest: dict) -> dict | None:
    run = latest.get("run") if isinstance(latest, dict) else None
    return run if isinstance(run, dict) and run.get("items") else None


def _labels(latest: dict) -> dict[str, str]:
    return {
        c.get("slug", ""): c.get("label", "")
        for c in latest.get("categories") or []
        if isinstance(c, dict)
    }


def _item_words(item: dict) -> set[str]:
    """Mots distinctifs d'un titre (noms propres : Mistral, OpenAI, Kubernetes…)."""
    words = set()
    for word in TITLE_WORD.findall(item.get("title", "")):
        key = normalize(word).strip()
        if len(key) >= 4 and key not in COMMON_WORDS and " " not in key:
            words.add(key)
    return words


def title_words(latest: dict) -> set[str]:
    run = _run(latest)
    return set().union(*(_item_words(i) for i in run["items"])) if run else set()


def _cited(item: dict, text: str) -> bool:
    return any(f" {word} " in text for word in _item_words(item))


def wanted(question: str, latest: dict) -> bool:
    """Vrai si la question parle de la veille (et qu'un passage existe)."""
    if not question or _run(latest) is None:
        return False
    text = normalize(question)
    if ASK.search(text) or JOURNAL_ASK.search(text):
        return True
    return any(f" {word} " in text for word in title_words(latest))


def journal_asked(question: str) -> bool:
    return bool(question) and (
        MARKER in question or bool(JOURNAL_ASK.search(normalize(question)))
    )


def _slot(run: dict) -> str:
    try:
        moment = datetime.fromisoformat(run.get("slot_at", "")).astimezone()
    except (TypeError, ValueError):
        return ""
    return f"passage de {moment.hour} h"


def _weather_line(weather) -> str:
    if not isinstance(weather, dict) or not weather.get("text"):
        return ""
    condition = (weather.get("condition") or {}).get("label") or ""
    return f"Météo : {weather['text']}" + (f" ({condition})" if condition else "")


def _item_line(item: dict, labels: dict[str, str]) -> str:
    category = labels.get(item.get("category", ""), item.get("category", ""))
    head = f"[{category}] " if category else ""
    about = item.get("sentence") or item.get("summary", "")[:200]
    source = f" ({item['source']})" if item.get("source") else ""
    return f"- {head}{item.get('title', '')} : {about}{source}"


def context(latest: dict, question: str = "") -> str:
    """Résumé du dernier passage pour la consigne, avec la manière d'en parler ; les
    articles cités dans la question passent en tête (la liste est limitée)."""
    run = _run(latest)
    if run is None:
        return ""
    text = normalize(question)
    items = sorted(run["items"], key=lambda item: not _cited(item, text))
    labels = _labels(latest)
    lines = [f"VEILLE DU JOUR ({_slot(run) or 'dernier passage'}) :"]
    weather = _weather_line(latest.get("weather"))
    if weather:
        lines.append(weather)
    lines.append("Articles à la une :")
    lines += [_item_line(i, labels) for i in items[:CONTEXT_ITEMS]]
    ideas = [i for i in run.get("ideas") or [] if i.get("title")]
    if ideas:
        lines.append("Tes idées pour Antares :")
        lines += [f"- {i['title']} : {i.get('benefit', '')}" for i in ideas]
    lines.append("")
    lines.append(TALK_RULES)
    return "\n".join(lines)


def pick_topics(run: dict, count: int = TOPICS) -> list[dict]:
    """Sujets du journal : ordre de la une, une catégorie différente tant que possible,
    les articles aimés et ceux des sources privilégiées (déjà en tête de la une) d'abord."""
    items = [i for i in run.get("items") or [] if i.get("id") and i.get("title")]
    liked = [i for i in items if i.get("vote") == "like"]
    rest = [i for i in items if i.get("vote") not in ("like", "dislike")]
    ordered = liked + rest
    chosen: list[dict] = []
    seen: set[str] = set()
    for item in ordered:
        if len(chosen) == count:
            break
        if item.get("category", "") not in seen:
            chosen.append(item)
            seen.add(item.get("category", ""))
    for item in ordered:
        if len(chosen) == count:
            break
        if item not in chosen:
            chosen.append(item)
    order = {item["id"]: n for n, item in enumerate(ordered)}
    return sorted(chosen, key=lambda item: order[item["id"]])


# --- Journal : phase en cours ---------------------------------------------------------

live: dict = {}


def start(latest: dict, now: float | None = None) -> dict:
    """Prépare le journal sur le dernier passage ; ValueError sans passage."""
    run = _run(latest)
    if run is None:
        raise ValueError("aucune veille à présenter pour l'instant")
    labels = _labels(latest)
    topics = [
        {
            "id": item["id"],
            "title": item.get("title", ""),
            "category": labels.get(item.get("category", ""), item.get("category", "")),
            "source": item.get("source", ""),
            "sentence": item.get("sentence", ""),
            "summary": item.get("summary", "")[:SUMMARY_CHARS],
        }
        for item in pick_topics(run)
    ]
    ideas = [
        {"id": i.get("id"), "title": i["title"], "benefit": i.get("benefit", "")}
        for i in (run.get("ideas") or [])
        if i.get("title")
    ][:IDEAS]
    live.clear()
    live.update(
        run_id=run.get("id"),
        slot=_slot(run),
        weather=_weather_line(latest.get("weather")),
        topics=topics,
        ideas=ideas,
        index=0,
        stage="ready",
        at=now or time.time(),
    )
    return state()


def stop() -> None:
    live.clear()


def active(now: float | None = None) -> bool:
    if live and (now or time.time()) - live["at"] > LIVE_TTL_S:
        stop()
    return bool(live)


def state() -> dict:
    """État pour l'interface : sujet en cours (mis en évidence dans la liste)."""
    if not active():
        return {"active": False}
    index = live["index"]
    topics = live["topics"]
    current = (
        topics[index]
        if live["stage"] in ("topic", "deeper") and index < len(topics)
        else None
    )
    return {
        "active": True,
        "stage": live["stage"],
        "index": index,
        "total": len(topics),
        "current_id": current["id"] if current else None,
        "topics": [{"id": t["id"], "title": t["title"]} for t in topics],
    }


def _topic_block(topic: dict) -> str:
    about = ", ".join(
        part
        for part in (
            f"catégorie {topic['category']}" if topic["category"] else "",
            f"source {topic['source']}" if topic["source"] else "",
        )
        if part
    )
    return (
        f"Sujet : {topic['title']}"
        + (f" ({about})" if about else "")
        + f"\nEn bref : {topic['sentence'] or topic['title']}"
        + f"\nCe que dit l'article (seuls faits connus) : {topic['summary']}"
    )


def _ideas_block() -> str:
    return "\n".join(f"- {i['title']} : {i['benefit']}" for i in live["ideas"])


def intent(said: str) -> str:
    """Ce que veut l'utilisateur : stop, skip, more, question ou opinion."""
    if MARKER in said:
        rest = normalize(said.replace(MARKER, ""))
        if SKIP.search(rest):
            return "skip"
        if STOP.search(rest):
            return "stop"
        return "start"
    text = normalize(said)
    if STOP.search(text):
        return "stop"
    if MORE.search(text):
        return "more"
    if SKIP.search(text) and len(text.split()) <= 8:
        return "skip"
    if said.rstrip().endswith("?") or QUESTION_START.search(text):
        return "question"
    return "opinion"


def _present(topic: dict, first: bool) -> str:
    lead = (
        "Présente-le"
        if first
        else "Fais une courte transition naturelle, puis " "présente-le"
    )
    return (
        f"Le sujet à présenter maintenant est « {topic['title']} », et aucun autre. "
        f"{lead} en deux ou trois phrases, avec tes mots ; donne ton petit commentaire "
        "personnel en une phrase, puis demande à l'utilisateur ce qu'il en pense, et "
        f"arrête-toi.\n\n{_topic_block(topic)}"
    )


def _ideas_step(react: bool) -> str:
    lead = "Réagis d'abord en une phrase à ce qu'il vient de dire. " if react else ""
    return (
        f"{lead}Les sujets du jour sont terminés. Parle-lui en deux ou trois phrases "
        "des idées que la veille t'a données pour Antares (sans les lire), puis "
        f"demande-lui laquelle le tente, et arrête-toi.\n\nIdées :\n{_ideas_block()}"
    )


def _outro(react: bool) -> str:
    lead = "Réagis en une phrase à ce qu'il vient de dire, puis c" if react else "C"
    return (
        f"{lead}onclus le journal en une ou deux phrases chaleureuses, sans résumer. "
        "Dis-lui qu'il peut continuer à te parler de n'importe quel sujet du jour."
    )


def _next(react: bool) -> str:
    """Avance d'un sujet et renvoie la consigne de l'étape."""
    live["index"] += 1
    topics = live["topics"]
    if live["index"] < len(topics):
        live["stage"] = "topic"
        step = _present(topics[live["index"]], first=False)
        if react:
            step = (
                "Réagis d'abord en une ou deux phrases à ce qu'il vient de dire "
                "(d'accord ou pas, avec ton point de vue). Ensuite : " + step
            )
        return step
    if live["ideas"] and live["stage"] != "ideas":
        live["stage"] = "ideas"
        return _ideas_step(react)
    live["stage"] = "outro"
    return _outro(react)


def step(said: str) -> str:
    """Consigne de l'étape à jouer pour ce tour ; fait avancer le journal."""
    kind = intent(said)
    topics = live["topics"]
    if live["stage"] == "ready" or kind == "start":
        live.update(index=0, stage="topic")
        opening = (
            "Ouvre le journal en une phrase d'accroche"
            + (f" ({live['slot']})" if live["slot"] else "")
            + (
                f", donne la météo en une phrase ({live['weather']})"
                if live["weather"]
                else ""
            )
            + ". Ensuite : "
        )
        return opening + _present(topics[0], first=True)
    if kind == "stop" or live["stage"] == "outro":
        live["stage"] = "outro"
        return _outro(react=kind != "stop")
    if live["stage"] == "ideas":
        if kind in ("question", "more"):
            return (
                "Réponds à sa question sur les idées en deux ou trois phrases, puis "
                f"arrête-toi.\n\nIdées :\n{_ideas_block()}"
            )
        live["stage"] = "outro"
        return _outro(react=kind == "opinion")
    topic = topics[min(live["index"], len(topics) - 1)]
    if kind == "more":
        live["stage"] = "deeper"
        return (
            "Il veut en savoir plus : développe ce sujet en trois ou quatre phrases à "
            "partir de ce que dit l'article (sans le lire), puis demande-lui son avis, "
            f"et arrête-toi.\n\n{_topic_block(topic)}"
        )
    if kind == "question":
        live["stage"] = "deeper"
        return (
            "Réponds à sa question sur ce sujet en deux ou trois phrases, à partir de "
            "ce que dit l'article ; si la réponse n'y est pas, dis que tu n'as lu que le "
            "résumé. Puis demande-lui si on passe à la suite, et arrête-toi."
            f"\n\n{_topic_block(topic)}"
        )
    return _next(react=kind == "opinion")


def messages_for(messages: list[dict]) -> list[dict]:
    """Messages du tour : consigne du personnage (moteur) + étape du journal + fin de
    l'échange (sans le marqueur, invisible pour le modèle)."""
    said = last_said(messages)
    instruction = step(said)
    persona = [_text(m.get("content")) for m in messages if m.get("role") == "system"]
    system = "\n\n".join([*filter(None, persona), JOURNAL_RULES])
    turns = [m for m in messages if m.get("role") in ("user", "assistant")]
    # Peu d'historique : un petit modèle recopie sinon ses tours précédents
    recent = [
        {
            "role": m["role"],
            "content": _text(m.get("content")).replace(MARKER, "").strip() or "…",
        }
        for m in turns[-HISTORY_TURNS:]
    ]
    if not recent or recent[-1]["role"] != "user":
        recent.append({"role": "user", "content": ""})
    # Étape et sujet dans le dernier message : un petit modèle s'y tient mieux qu'à la
    # fin d'une longue consigne système
    said_now = "" if MARKER in said else recent[-1]["content"]
    recent[-1]["content"] = f"{said_now}\n\n[Régie : {instruction}]".strip()
    if live.get("stage") == "outro":
        live["done"] = True
    return [{"role": "system", "content": system}, *recent]


def finish_if_done() -> None:
    """Après la conclusion : la conversation reprend son cours normal."""
    if live.get("done"):
        stop()
