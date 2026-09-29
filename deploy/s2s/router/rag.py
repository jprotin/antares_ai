"""RAG des projets : documentation indexée par ai-to-boost, ajoutée à la consigne du LLM.

Le service `rag` d'ai-to-boost interroge Qdrant (embeddings nomic) sur une liste de
collections : `knowledge` (commune) et `proj-<slug>` (une par projet). Les scores ne
distinguent pas une question projet d'une question banale (une recette obtient le même
score qu'une question d'architecture) : le RAG n'est donc interrogé que si un projet est
choisi dans les Réglages, ou si la question cite un projet par son nom.
"""

import logging
import os
import re
import time
import unicodedata

import httpx

RAG_URL = os.environ.get("RAG_URL", "http://rag:8100")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
RAG_LIMIT = int(os.environ.get("RAG_LIMIT", "4"))
PREFIX = "proj-"
COMMON = "knowledge"
EXCERPT_CHARS = 600
# Une relance courte (« et ensuite ? ») est complétée par la question précédente
SHORT_QUESTION = 60
RULES = (
    "Documentation des projets de l'utilisateur (extraits indexés, source entre "
    "crochets). Appuie-toi dessus pour répondre. À l'oral, résume avec tes mots, sans "
    "lire les extraits ni citer les noms de fichiers. Si la réponse n'y figure pas, "
    "dis-le simplement plutôt que d'inventer."
)
# À l'écrit, les sources sont utiles au lecteur
WRITTEN_RULES = (
    "Documentation des projets de l'utilisateur (extraits indexés, source entre "
    "crochets). Appuie-toi dessus pour répondre et cite la source entre crochets, par "
    "exemple [projet · fichier], après l'information concernée. Si la réponse n'y "
    "figure pas, dis-le simplement plutôt que d'inventer."
)

logger = logging.getLogger("router.rag")
http = httpx.AsyncClient(timeout=httpx.Timeout(3))
# Dernière recherche, affichée par l'interface sous la réponse
last_usage: dict = {"at": 0.0, "projects": [], "sources": []}
# Liste des projets relue au plus toutes les minutes (un projet indexé apparaît vite)
PROJECTS_TTL = 60
_projects_cache: tuple[float, list[dict]] = (0.0, [])


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " " + re.sub(r"[^a-z0-9]+", " ", text).strip() + " "


async def projects() -> list[dict]:
    """Projets indexés (collections `proj-*` non vides), triés par nom."""
    global _projects_cache
    fetched_at, cached = _projects_cache
    if time.monotonic() - fetched_at < PROJECTS_TTL:
        return cached
    try:
        collections = (await http.get(f"{QDRANT_URL}/collections")).json()["result"][
            "collections"
        ]
        found = []
        for collection in collections:
            name = collection["name"]
            if not name.startswith(PREFIX):
                continue
            info = (await http.get(f"{QDRANT_URL}/collections/{name}")).json()
            chunks = info["result"].get("points_count") or 0
            if chunks:
                found.append({"id": name[len(PREFIX) :], "chunks": chunks})
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("Liste des projets indisponible : %s", exc)
        return []
    _projects_cache = (time.monotonic(), sorted(found, key=lambda p: p["id"]))
    return _projects_cache[1]


def cited(question: str, known: list[dict]) -> list[str]:
    """Projets nommés dans la question (« idp galaxy », « IDP-Galaxy », « idpgalaxy »)."""
    text = _normalize(question)
    compact = text.replace(" ", "")
    found = []
    for project in known:
        words = _normalize(project["id"])
        if words in text or words.replace(" ", "") in compact:
            found.append(project["id"])
    return found


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return ""


def question(messages: list[dict]) -> str:
    """Dernière question ; une relance courte est complétée par la précédente."""
    asked = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    asked = [q.strip() for q in asked if q.strip()]
    if not asked:
        return ""
    if len(asked[-1]) < SHORT_QUESTION and len(asked) > 1:
        return f"{asked[-2]} {asked[-1]}"
    return asked[-1]


async def augment(
    messages: list[dict], selected: str | None, spoken: bool = True
) -> list[dict]:
    """Ajoute les extraits pertinents à la consigne ; renvoie les messages inchangés sinon."""
    last_usage.update(at=time.time(), projects=[], sources=[])
    asked = question(messages)
    if not asked:
        return messages
    chosen = [selected] if selected else []
    targets = chosen + [p for p in cited(asked, await projects()) if p not in chosen]
    if not targets:
        return messages
    start = time.monotonic()
    try:
        response = await http.post(
            f"{RAG_URL}/query",
            json={
                "collections": [COMMON] + [PREFIX + p for p in targets],
                "query": asked,
                "limit": RAG_LIMIT,
            },
        )
        hits = response.json().get("hits", [])
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("RAG indisponible, réponse sans documentation : %s", exc)
        return messages
    if not hits:
        return messages

    excerpts = []
    for hit in hits:
        project = hit["collection"].removeprefix(PREFIX)
        label = "commun" if hit["collection"] == COMMON else project
        excerpts.append(
            f"[{label} · {hit['source']}]\n{hit['text'][:EXCERPT_CHARS].strip()}"
        )
    rules = RULES if spoken else WRITTEN_RULES
    context = rules + "\n\n" + "\n\n".join(excerpts)
    last_usage.update(
        projects=targets,
        sources=sorted(
            {f"{h['collection'].removeprefix(PREFIX)}/{h['source']}" for h in hits}
        ),
    )
    logger.info(
        "RAG %s : %d extraits en %.0f ms",
        ",".join(targets),
        len(hits),
        (time.monotonic() - start) * 1000,
    )

    return add_system(messages, context)


def add_system(messages: list[dict], text: str) -> list[dict]:
    """Ajoute `text` à la consigne système (créée si absente), sans modifier l'original."""
    augmented = [dict(m) for m in messages]
    system = next((m for m in augmented if m.get("role") == "system"), None)
    if system is not None:
        system["content"] = f"{_text(system['content'])}\n\n{text}"
    else:
        augmented.insert(0, {"role": "system", "content": text})
    return augmented
