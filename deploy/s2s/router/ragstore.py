"""Projets et documents du RAG intégré : dépôt, liste, retrait.

Réservé au mode intégré (Connexions → RAG) : le RAG d'ai-to-boost est alimenté par ses
propres scripts, antares n'y écrit que les fiches de connaissance (cf. knowledge.py).
Un projet est la collection Qdrant `proj-<projet>`, créée au premier document déposé.
L'indexation passe par le service rag (découpage et embeddings identiques à ceux
d'ai-to-boost) ; la liste et la suppression d'un projet lisent Qdrant directement.
"""

import re
import unicodedata

import httpx

import connections
import documents
import rag

PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
# Limite du service rag (MAX_TEXT_CHARS de rag/server.py)
MAX_TEXT_CHARS = 200_000
SCROLL_PAGE = 256

# Embeddings sur le processeur : un long document prend jusqu'à une minute
http = httpx.AsyncClient(timeout=httpx.Timeout(10, read=240))


class StoreError(ValueError):
    pass


def project_id(name: str) -> str:
    """« Mon Appli » -> « mon-appli » (identifiant de collection accepté par le RAG)."""
    text = unicodedata.normalize("NFKD", name.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9_]+", "-", text).strip("-_")[:64]


def _doc_id(filename: str) -> str:
    """Identifiant stable par nom de fichier : redéposer un fichier le remplace."""
    return "file:" + re.sub(r"[^A-Za-z0-9_.-]+", "-", filename).strip("-")[:120]


def _config() -> connections.Rag:
    config = connections.rag()
    if config.mode != "integrated":
        raise StoreError(
            "gestion des documents réservée au RAG intégré (Connexions → RAG) : le RAG "
            "existant est alimenté par ses propres outils"
        )
    if not config.write_token:
        raise StoreError("jeton RAG_INTEGRATED_TOKEN absent : relancer install.sh")
    return config


def _collection(project: str) -> str:
    if not PROJECT_RE.match(project):
        raise StoreError(f"nom de projet invalide : {project}")
    return f"{rag.PREFIX}{project}"


async def _service(method: str, config: connections.Rag, payload: dict) -> dict:
    try:
        response = await http.request(
            method,
            f"{config.url}/documents",
            json=payload,
            headers={"Authorization": f"Bearer {config.write_token}"},
        )
    except httpx.HTTPError as exc:
        raise StoreError(
            f"RAG intégré injoignable ({exc}) : démarrer le profil rag-integre"
        ) from exc
    if response.status_code != 200:
        error = response.json().get("error", "") if response.content else ""
        raise StoreError(f"RAG intégré : HTTP {response.status_code} {error}".strip())
    return response.json()


async def list_documents(project: str) -> list[dict]:
    """Documents d'un projet : un par doc_id, avec son nombre d'extraits."""
    config = _config()
    url = f"{config.qdrant_url}/collections/{_collection(project)}/points/scroll"
    found: dict[str, dict] = {}
    offset = None
    while True:
        body = {
            "limit": SCROLL_PAGE,
            "with_payload": ["doc_id", "source", "kind"],
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        response = await http.post(url, json=body)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        result = response.json()["result"]
        for point in result["points"]:
            payload = point.get("payload") or {}
            doc_id = payload.get("doc_id") or payload.get("source", "?")
            entry = found.setdefault(
                doc_id,
                {
                    "id": doc_id,
                    "source": payload.get("source", "?"),
                    "kind": payload.get("kind", ""),
                    "chunks": 0,
                },
            )
            entry["chunks"] += 1
        offset = result.get("next_page_offset")
        if offset is None:
            break
    return sorted(found.values(), key=lambda d: d["source"].lower())


async def add_document(project: str, filename: str, data: bytes) -> dict:
    config = _config()
    collection = _collection(project)
    try:
        extracted = documents.extract(filename, data, max_tokens=None)
    except documents.DocumentError as exc:
        raise StoreError(f"{filename} : {exc}") from exc
    if extracted["kind"] == "image":
        raise StoreError(f"{filename} : image non indexable (texte attendu)")
    if len(extracted["text"]) > MAX_TEXT_CHARS:
        raise StoreError(
            f"{filename} : trop long ({len(extracted['text'])} caractères, "
            f"{MAX_TEXT_CHARS} au maximum) : découpez-le"
        )
    doc_id = _doc_id(filename)
    result = await _service(
        "POST",
        config,
        {
            "collection": collection,
            "doc_id": doc_id,
            "text": extracted["text"],
            "metadata": {
                "source": filename,
                "origin": "antares",
                "kind": extracted["kind"],
            },
        },
    )
    rag.invalidate_projects()
    return {"id": doc_id, "source": filename, "chunks": result.get("chunks", 0)}


async def remove_document(project: str, doc_id: str) -> None:
    config = _config()
    await _service(
        "DELETE", config, {"collection": _collection(project), "doc_id": doc_id}
    )
    rag.invalidate_projects()


async def remove_project(project: str) -> None:
    config = _config()
    response = await http.delete(
        f"{config.qdrant_url}/collections/{_collection(project)}"
    )
    if response.status_code not in (200, 404):
        raise StoreError(
            f"suppression refusée par Qdrant (HTTP {response.status_code})"
        )
    rag.invalidate_projects()
