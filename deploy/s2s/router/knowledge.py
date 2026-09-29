"""Fiches de connaissance : enrichir le RAG sans le polluer.

Rien n'est indexé automatiquement. Depuis une conversation ou un document joint, le LLM
rédige une fiche (faits et décisions durables seulement) que l'utilisateur relit et
corrige avant indexation. Avant d'indexer, les fiches proches du même projet sont
proposées au remplacement ; une fiche remplacée devient obsolète (retirée de l'index,
archivée ici). Une date de validité optionnelle exclut la fiche des recherches une fois
dépassée (filtre du service rag d'ai-to-boost).

Les fiches font foi ici (KNOWLEDGE_PATH, un JSON par fiche) ; le service rag n'en est
que l'index (POST/DELETE /documents, jeton RAG_WRITE_TOKEN).
"""

import datetime as dt
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

import httpx

KNOWLEDGE_PATH = Path(os.environ.get("KNOWLEDGE_PATH", "/data/knowledge"))
RAG_URL = os.environ.get("RAG_URL", "http://rag:8100")
RAG_WRITE_TOKEN = os.environ.get("RAG_WRITE_TOKEN", "")
COMMON = "knowledge"
PREFIX = "proj-"
# Source trop longue pour la rédaction : on le dit, plutôt que de tronquer en silence
MAX_SOURCE_CHARS = 60_000

DRAFT_RULES = """Tu rédiges une FICHE DE CONNAISSANCE destinée à la base documentaire (RAG) \
d'un projet. Elle sera relue par l'utilisateur avant indexation.

Ne retiens QUE l'information durable et réutilisable : faits techniques, décisions et \
leur raison, conventions, paramètres, procédures, contacts de rôle, échéances. \
EXCLUS : bavardage, politesse, hésitations, états temporaires (« je teste », « en \
cours »), questions sans réponse, données personnelles, secrets (mots de passe, jetons).

Réponds UNIQUEMENT par un objet JSON :
{"title": "titre court et précis",
 "body": "contenu en Markdown : puces factuelles, une idée par puce, sans phrase d'intro",
 "tags": ["2 à 5 mots-clés"],
 "valid_until": "AAAA-MM-JJ si l'information a une date d'expiration naturelle, sinon null"}
S'il n'y a rien de durable à retenir : {"empty": true}."""

logger = logging.getLogger("router.knowledge")
http = httpx.AsyncClient(timeout=httpx.Timeout(30))


class KnowledgeError(ValueError):
    """Refus explicite, affiché tel quel à l'utilisateur."""


def enabled() -> bool:
    return bool(RAG_WRITE_TOKEN)


def collection(project: str) -> str:
    return f"{PREFIX}{project}" if project else COMMON


def _path(card_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{12}", card_id):
        raise KnowledgeError("fiche inconnue")
    return KNOWLEDGE_PATH / f"{card_id}.json"


def load(card_id: str) -> dict:
    path = _path(card_id)
    if not path.exists():
        raise KnowledgeError("fiche inconnue")
    return json.loads(path.read_text(encoding="utf-8"))


def _store(card: dict) -> None:
    KNOWLEDGE_PATH.mkdir(parents=True, exist_ok=True)
    tmp = _path(card["id"]).with_suffix(".tmp")
    tmp.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_path(card["id"]))


def state(card: dict, today: dt.date | None = None) -> str:
    """active, expired (date de validité dépassée) ou obsolete (remplacée / retirée)."""
    if card.get("status") == "obsolete":
        return "obsolete"
    until = card.get("valid_until")
    today = today or dt.date.today()
    if until and dt.date.fromisoformat(until) < today:
        return "expired"
    return "active"


def cards(project: str | None = None) -> list[dict]:
    if not KNOWLEDGE_PATH.exists():
        return []
    found = []
    for path in KNOWLEDGE_PATH.glob("*.json"):
        card = json.loads(path.read_text(encoding="utf-8"))
        if project is None or card.get("project", "") == project:
            found.append({**card, "state": state(card)})
    return sorted(found, key=lambda c: c.get("updated", 0), reverse=True)


def _indexed_text(card: dict) -> str:
    tags = ", ".join(card.get("tags") or [])
    return f"# {card['title']}\n\n{card['body']}" + (
        f"\n\nMots-clés : {tags}" if tags else ""
    )


def _valid_until_ts(value: str | None) -> float | None:
    if not value:
        return None
    day = dt.date.fromisoformat(value)
    # Valide jusqu'à la fin de la journée indiquée
    return dt.datetime.combine(day, dt.time.max).timestamp()


async def _rag(method: str, payload: dict) -> dict:
    if not enabled():
        raise KnowledgeError(
            "indexation désactivée (RAG_WRITE_TOKEN absent d'ai-to-boost)"
        )
    try:
        response = await http.request(
            method,
            f"{RAG_URL}/documents",
            json=payload,
            headers={"Authorization": f"Bearer {RAG_WRITE_TOKEN}"},
        )
    except httpx.HTTPError as exc:
        raise KnowledgeError(f"service RAG injoignable : {exc}") from exc
    if response.status_code != 200:
        detail = response.json().get("error", response.text) if response.content else ""
        raise KnowledgeError(f"indexation refusée ({response.status_code}) : {detail}")
    return response.json()


async def _index(card: dict) -> None:
    metadata = {
        "source": f"fiche · {card['title']}",
        "origin": "antares",
        "card_id": card["id"],
        "title": card["title"],
        "created": card["created"],
        "status": "active",
    }
    until = _valid_until_ts(card.get("valid_until"))
    if until:
        metadata["valid_until_ts"] = until
    await _rag(
        "POST",
        {
            "collection": collection(card.get("project", "")),
            "doc_id": f"antares:{card['id']}",
            "text": _indexed_text(card),
            "metadata": metadata,
        },
    )


async def _unindex(card: dict) -> None:
    await _rag(
        "DELETE",
        {
            "collection": collection(card.get("project", "")),
            "doc_id": f"antares:{card['id']}",
        },
    )


def validate(draft: dict) -> dict:
    title = str(draft.get("title") or "").strip()
    body = str(draft.get("body") or "").strip()
    if not title or not body:
        raise KnowledgeError("titre et contenu requis")
    if len(title) > 160 or len(body) > 20_000:
        raise KnowledgeError("fiche trop longue (titre 160, contenu 20 000 caractères)")
    until = draft.get("valid_until") or None
    if until:
        try:
            dt.date.fromisoformat(str(until))
        except ValueError as exc:
            raise KnowledgeError("date de validité invalide (AAAA-MM-JJ)") from exc
    tags = [str(t).strip() for t in (draft.get("tags") or []) if str(t).strip()][:8]
    return {
        "title": title,
        "body": body,
        "tags": tags,
        "valid_until": str(until) if until else None,
        "project": str(draft.get("project") or ""),
        "source": draft.get("source") or {},
    }


async def save(draft: dict, replaces: list[str]) -> dict:
    """Crée (ou met à jour) une fiche, l'indexe, rend obsolètes celles qu'elle remplace."""
    data = validate(draft)
    now = time.time()
    card_id = draft.get("id")
    if card_id:
        card = load(card_id)
        card.update(data, updated=now, status="active")
    else:
        card = {
            "id": uuid.uuid4().hex[:12],
            **data,
            "created": now,
            "updated": now,
            "status": "active",
        }
    card["replaces"] = sorted(set(card.get("replaces", [])) | set(replaces))
    await _index(card)
    _store(card)
    for old_id in replaces:
        if old_id != card["id"]:
            await obsolete(old_id, replaced_by=card["id"])
    logger.info("Fiche indexée : %s (%s)", card["title"], collection(card["project"]))
    return {**card, "state": state(card)}


async def obsolete(card_id: str, replaced_by: str | None = None) -> dict:
    card = load(card_id)
    await _unindex(card)
    card.update(status="obsolete", updated=time.time())
    if replaced_by:
        card["replaced_by"] = replaced_by
    _store(card)
    return {**card, "state": state(card)}


async def delete(card_id: str) -> None:
    card = load(card_id)
    if card.get("status") != "obsolete":
        await _unindex(card)
    _path(card_id).unlink()


async def similar(draft: dict) -> list[dict]:
    """Fiches antares proches (même projet), pour proposer un remplacement."""
    text = f"{draft.get('title', '')}\n{draft.get('body', '')}".strip()
    if not text:
        return []
    try:
        response = await http.post(
            f"{RAG_URL}/query",
            json={
                "collections": [collection(str(draft.get("project") or ""))],
                "query": text,
                "limit": 8,
            },
        )
        hits = response.json().get("hits", [])
    except (httpx.HTTPError, ValueError):
        return []
    seen, found = set(), []
    for hit in hits:
        doc_id = hit.get("doc_id") or ""
        if hit.get("origin") != "antares" or not doc_id.startswith("antares:"):
            continue
        card_id = doc_id.removeprefix("antares:")
        if card_id in seen or card_id == draft.get("id"):
            continue
        seen.add(card_id)
        try:
            card = load(card_id)
        except KnowledgeError:
            continue
        found.append(
            {
                "id": card_id,
                "title": card["title"],
                "score": round(hit["score"], 3),
                "created": card["created"],
            }
        )
    return found[:4]


def source_text(
    messages: list[dict] | None, document: dict | None
) -> tuple[str, str, bool]:
    """Texte à résumer, libellé de la source, et indicateur de coupure (annoncée)."""
    if document:
        text = document.get("text") or ""
        label = document.get("name", "document")
    else:
        lines = []
        for m in messages or []:
            content = m.get("content")
            if (
                isinstance(content, str)
                and content.strip()
                and m.get("role") in ("user", "assistant")
            ):
                who = "Utilisateur" if m["role"] == "user" else "Assistant"
                lines.append(f"{who} : {content.strip()}")
        text = "\n".join(lines)
        label = "conversation"
    if not text.strip():
        raise KnowledgeError("rien à résumer")
    cut = len(text) > MAX_SOURCE_CHARS
    return text[:MAX_SOURCE_CHARS], label, cut


def parse_draft(answer: str) -> dict:
    """Extrait l'objet JSON de la réponse du LLM (tolère un bloc ```json)."""
    match = re.search(r"\{.*\}", answer, re.S)
    if not match:
        raise KnowledgeError("le modèle n'a pas rendu de fiche exploitable")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise KnowledgeError("le modèle a rendu une fiche mal formée") from exc
    if data.get("empty"):
        raise KnowledgeError("rien de durable à retenir dans cette source")
    return data
