"""Routeur LLM d'antares : relaie le moteur s2s vers Ollama avec le modèle choisi dans l'interface.

- /v1/*          : relais OpenAI-compatible vers Ollama ; le champ `model` est réécrit
                   avec le modèle actif (le moteur s2s fixe le sien au démarrage).
- /api/models    : modèles de chat installés dans Ollama, avec la vitesse mesurée sur les
                   conversations relayées (la part VRAM rapportée par Ollama est fausse
                   pour les modèles à experts comme gemma4:26b).
                   S'y ajoutent les modèles Claude (`claude:*`) servis par le claude-bridge
                   d'ai-to-boost (cf. claude.py) : texte envoyé chez Anthropic.
- /api/settings  : réglages actifs {model, fallback, voice, project, agent, mode},
                   persistés dans SETTINGS_PATH. `fallback` : modèle de repli quand le
                   modèle choisi est indisponible (hors ligne, partage) ; aucun modèle
                   n'est figé dans la configuration de déploiement.
- /api/modes     : modes de conversation (cf. modes.py).
- /api/projects  : projets indexés dans le RAG d'ai-to-boost (cf. rag.py).
- /api/agents    : agents « consignes » (cf. agents.py) : liste, création, modification,
                   suppression ; /api/agents/meta : domaines et utilités proposés.
- /api/turn/last : agent, modèle, projets et sources de la dernière réponse.
- /api/chat      : conversation écrite hors appel (réponse texte en flux SSE, sans voix),
                   avec le même mode, agent et documentation que la voix.
- /api/documents : documents joints à la conversation (cf. documents.py) : envoi (corps
                   brut + en-tête X-Filename), liste, retrait.
- /api/net       : connexion Internet, recherche web en cours (cf. web.py) et partage
                   actif. Hors ligne ou pendant un partage, les modèles Claude sont
                   indisponibles.
- /api/rag/projects : projets et documents du RAG intégré (cf. ragstore.py) : dépôt
                   (corps brut + X-Filename), liste, retrait d'un document ou d'un projet.
- /api/knowledge : fiches de connaissance (cf. knowledge.py) : rédaction par le LLM,
                   fiches proches, indexation relue, obsolescence, suppression.
- /healthz       : sonde de santé.
"""

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import uvicorn
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

import agents
import claude
import connections
import documents
import knowledge
import mcp
import modes
import providers
import rag
import ragstore
import voicecode
import web

SETTINGS_PATH = Path(os.environ.get("SETTINGS_PATH", "/data/settings.json"))
# Partage en cours (tunnel ngrok, cf. share.sh) : fichier posé le temps du partage.
# Claude (abonnement de l'utilisateur) et l'écriture dans le RAG sont alors bloqués.
SHARING_FLAG = SETTINGS_PATH.with_name("sharing")
# Vitesses mesurées par modèle : {"model": {"ttft": s, "speed": tokens/s}}
OBSERVED_PATH = SETTINGS_PATH.with_name("observed.json")
SMOOTHING = 0.3
VOICES_CATALOG = Path(os.environ.get("VOICES_CATALOG", "/voices/voices.json"))
PORT = int(os.environ.get("PORT", "11434"))

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - router - %(levelname)s - %(message)s"
)
logger = logging.getLogger("router")

app = FastAPI(title="antares llm-router", docs_url=None, redoc_url=None)


class Settings(BaseModel):
    # Modèle choisi ("" : modèle de repli)
    model: str = ""
    voice: str
    # Modèle de repli, hors Claude ("" : premier modèle disponible, local d'abord)
    fallback: str = ""
    # Projet dont la documentation est ajoutée à chaque question ("" : aucun)
    project: str = ""
    # Agent appliqué à tout l'appel ("" : aucun, sauf agent cité dans la question)
    agent: str = ""
    # Manière de répondre (ton, structure) ; cf. modes.py
    mode: str = modes.DEFAULT
    # Documents joints à la conversation en cours (identifiants, cf. documents.py)
    documents: list[str] = []


class SettingsUpdate(BaseModel):
    model: str | None = None
    fallback: str | None = None
    voice: str | None = None
    project: str | None = None
    agent: str | None = None
    mode: str | None = None


def voice_catalog() -> dict:
    return json.loads(VOICES_CATALOG.read_text(encoding="utf-8"))


def load_settings() -> Settings:
    defaults = Settings(voice=voice_catalog()["default"])
    if not SETTINGS_PATH.exists():
        return defaults
    stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    settings = defaults.model_copy(
        update={k: v for k, v in stored.items() if k in Settings.model_fields}
    )
    # Réglages antérieurs aux fournisseurs : « gemma4:e4b » -> « ollama/gemma4:e4b »
    settings.model = providers.normalize(settings.model)
    settings.fallback = providers.normalize(settings.fallback)
    return settings


def save_settings(settings: Settings) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(SETTINGS_PATH)


def load_observed() -> dict:
    if not OBSERVED_PATH.exists():
        return {}
    stored = json.loads(OBSERVED_PATH.read_text())
    return {providers.normalize(name): value for name, value in stored.items()}


def record_observed(model: str, ttft: float, speed: float | None) -> None:
    """Moyenne glissante : suit les changements (modèle voisin chargé, VRAM libérée…).

    `speed` vaut None pour Claude : le bridge renvoie la réponse d'un bloc.
    """
    observed = load_observed()
    previous = observed.get(model)
    if previous:
        ttft = previous["ttft"] + SMOOTHING * (ttft - previous["ttft"])
        if speed is not None and previous.get("speed") is not None:
            speed = previous["speed"] + SMOOTHING * (speed - previous["speed"])
    observed[model] = {
        "ttft": round(ttft, 2),
        "speed": round(speed, 1) if speed is not None else None,
    }
    OBSERVED_PATH.parent.mkdir(parents=True, exist_ok=True)
    OBSERVED_PATH.write_text(json.dumps(observed, indent=2))


async def measure(
    model: str, start: float, chunks: AsyncIterator[bytes]
) -> AsyncIterator[bytes]:
    """Relaie le flux SSE tel quel en chronométrant premier mot et débit (1 delta ≈ 1 token).

    `start` est pris avant l'envoi : Ollama ne répond qu'une fois le prompt traité.
    """
    first = None
    deltas = 0
    pending = b""
    async for chunk in chunks:
        yield chunk
        pending += chunk
        *lines, pending = pending.split(b"\n")
        for line in lines:
            if not line.startswith(b"data: {"):
                continue
            for choice in json.loads(line[6:]).get("choices", []):
                if choice.get("delta", {}).get("content"):
                    first = first or time.monotonic()
                    deltas += 1
    end = time.monotonic()
    if first and deltas > 5 and end > first:
        record_observed(model, first - start, deltas / (end - first))


def sharing() -> bool:
    return SHARING_FLAG.exists()


def external_allowed() -> bool:
    """Services hors local (Claude, API externes) : connectés et hors partage."""
    return web.online() and not sharing()


def claude_available() -> bool:
    return external_allowed()


async def model_available(name: str) -> bool:
    if claude.is_claude(name):
        return claude_available()
    return any(m["name"] == name and m["available"] for m in await chat_models())


async def fallback_model(settings: Settings) -> str:
    """Modèle de repli réglé s'il est disponible, sinon premier modèle disponible hors
    Claude (local d'abord) ; "" si aucun fournisseur ne répond."""
    candidates = [
        m
        for m in await chat_models()
        if m["available"] and not claude.is_claude(m["name"])
    ]
    names = [m["name"] for m in candidates]
    if settings.fallback in names:
        return settings.fallback
    local = [m["name"] for m in candidates if m.get("local")]
    return (local or names or [""])[0]


async def usable_model(model: str, settings: Settings, local_only: bool = False) -> str:
    """`model` s'il est disponible (et non Claude si `local_only`), sinon le repli."""
    if model and not (local_only and claude.is_claude(model)):
        if await model_available(model):
            return model
    fallback = await fallback_model(settings)
    if not fallback:
        raise HTTPException(
            503, "Aucun modèle disponible : configurer un fournisseur dans Connexions"
        )
    return fallback


def refuse_while_sharing() -> None:
    if sharing():
        raise HTTPException(403, "Désactivé pendant un partage (tunnel ngrok ouvert)")


async def chat_models(force: bool = False) -> list[dict]:
    """Modèles de tous les fournisseurs (cf. providers.py), puis Claude (bridge)."""
    observed = load_observed()
    models = [
        {**m, "observed": observed.get(m["name"])}
        for m in await providers.list_models(external_allowed(), force)
    ]
    for model in await claude.available_models():
        models.append(
            {
                **model,
                "local": False,
                "loaded": True,
                "observed": observed.get(model["name"]),
                # Claude passe par Internet (indisponible hors ligne) et utilise
                # l'abonnement de l'utilisateur (indisponible pendant un partage)
                "available": claude_available(),
            }
        )
    return models


@app.on_event("startup")
async def start_watch() -> None:
    app.state.web_watch = asyncio.create_task(web.watch())


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/net")
async def net_state() -> dict:
    return {**web.state, "sharing": sharing()}


class TagsRequest(BaseModel):
    question: str = Field(max_length=4000)
    answer: str = Field(max_length=20000)


@app.post("/api/web/tags")
async def web_tags(request: TagsRequest) -> dict:
    """Mots-clés d'une réponse issue d'une recherche web (modèle local, après coup)."""
    settings = load_settings()
    model = await usable_model(settings.model, settings, local_only=True)
    try:
        answer = await providers.complete(
            model,
            [
                {"role": "system", "content": web.TAGS_PROMPT},
                {
                    "role": "user",
                    "content": f"Question : {request.question}\n\n"
                    f"Réponse : {request.answer[:6000]}",
                },
            ],
            json_mode=True,
            max_tokens=80,
            temperature=0.2,
            timeout=30,
        )
        return {"tags": web.parse_tags(answer)}
    except (httpx.HTTPError, KeyError, ValueError, LookupError) as exc:
        logger.warning("Mots-clés indisponibles : %s", exc)
        return {"tags": []}


@app.get("/api/models")
async def list_models(refresh: bool = False) -> list[dict]:
    return await chat_models(force=refresh)


# --- Connexions (fournisseurs de modèles) -----------------------------------------------


class ProviderDraft(connections.Provider):
    # Clé vide à l'enregistrement : la clé déjà enregistrée est conservée
    keep_key: bool = True


@app.get("/api/connections")
async def get_connections() -> dict:
    await chat_models()  # état des fournisseurs à jour (cache court)
    return {
        "providers": [connections.public(p) for p in connections.providers()],
        "status": providers.status(),
        "services": connections.public_services(),
        "fallbackModel": load_settings().fallback,
        "types": list(connections.PROVIDER_TYPES),
    }


@app.put("/api/connections/providers/{provider_id}")
async def save_provider(provider_id: str, draft: ProviderDraft) -> dict:
    refuse_while_sharing()
    if draft.id != provider_id:
        raise HTTPException(422, "identifiant incohérent")
    saved = connections.upsert(
        connections.Provider(**draft.model_dump(exclude={"keep_key"})), draft.keep_key
    )
    providers.invalidate()
    return connections.public(saved)


@app.delete("/api/connections/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: str) -> Response:
    refuse_while_sharing()
    fallback = load_settings().fallback
    if fallback and providers.split(fallback)[0] == provider_id:
        raise HTTPException(
            422, f"Fournisseur du modèle de repli ({fallback}) : non supprimable"
        )
    try:
        connections.remove(provider_id)
    except KeyError as exc:
        raise HTTPException(404, "fournisseur inconnu") from exc
    providers.invalidate()
    return Response(status_code=204)


# --- Connexions (services : RAG, recherche web, Claude, MCP) ---------------------------

SERVICES = ("rag", "search", "claude")


def _with_stored_secret(name: str, values: dict) -> dict:
    """Test d'une section non enregistrée : jeton vide = jeton enregistré."""
    secret = connections.SECRETS.get(name)
    if secret and not values.get(secret):
        values = {**values, secret: connections.load()[name].get(secret, "")}
    return values


@app.put("/api/connections/services/{name}")
async def save_service(name: str, values: dict) -> dict:
    refuse_while_sharing()
    if name not in SERVICES:
        raise HTTPException(404, "service inconnu")
    try:
        connections.update_service(name, dict(values))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    rag.invalidate_projects()
    providers.invalidate()
    asyncio.create_task(web.probe())
    return connections.public_services()[name]


@app.post("/api/connections/services/{name}/test")
async def test_service(name: str, values: dict) -> dict:
    refuse_while_sharing()
    if name not in SERVICES:
        raise HTTPException(404, "service inconnu")
    values = _with_stored_secret(name, dict(values))
    start = time.monotonic()
    http = httpx.AsyncClient(timeout=httpx.Timeout(8))
    try:
        if name == "rag":
            config = connections.resolved(connections.Rag(**values))
            if config.mode == "none":
                return {"ok": True, "detail": "pas de RAG"}
            health = (await http.get(f"{config.url}/health")).json()
            collections = (
                (await http.get(f"{config.qdrant_url}/collections")).json()["result"][
                    "collections"
                ]
                if config.qdrant_url
                else []
            )
            projects = [c["name"] for c in collections if c["name"].startswith("proj-")]
            detail = f"service {health.get('status', '?')} · {len(projects)} projet(s)"
            if config.write_token:
                # Vérifie le jeton sans rien écrire : suppression d'un document absent
                check = await http.request(
                    "DELETE",
                    f"{config.url}/documents",
                    json={
                        "collection": "knowledge",
                        "doc_id": "antares:test-connexion",
                    },
                    headers={"Authorization": f"Bearer {config.write_token}"},
                )
                detail += (
                    " · écriture autorisée"
                    if check.status_code == 200
                    else f" · écriture refusée (HTTP {check.status_code})"
                )
            else:
                detail += " · sans jeton d'écriture (fiches désactivées)"
        elif name == "search":
            config_s = connections.Search(**values)
            found = (
                await http.get(
                    f"{config_s.url}/search",
                    params={"q": "antares", "format": "json"},
                )
            ).json()
            detail = f"{len(found.get('results', []))} résultat(s) pour « antares »"
        else:
            config_c = connections.Claude(**values)
            (await http.get(f"{config_c.url}/health")).raise_for_status()
            detail = "bridge joignable" + (
                "" if config_c.token else " · sans jeton (Claude masqué)"
            )
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        reason = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        if name == "rag" and values.get("mode") == "integrated":
            reason += (
                " — RAG intégré non démarré : COMPOSE_PROFILES=rag-integre dans .env, "
                "puis docker compose up -d"
            )
        return {"ok": False, "error": reason[:300]}
    finally:
        await http.aclose()
    return {"ok": True, "detail": detail, "seconds": round(time.monotonic() - start, 2)}


class McpDraft(connections.McpServer):
    keep_token: bool = True


def _mcp_with_token(draft: McpDraft) -> connections.McpServer:
    server = connections.McpServer(**draft.model_dump(exclude={"keep_token"}))
    if draft.keep_token and not server.token:
        stored = {m.id: m for m in connections.mcp_servers()}.get(server.id)
        server.token = stored.token if stored else ""
    return server


@app.put("/api/connections/mcp/{server_id}")
async def save_mcp(server_id: str, draft: McpDraft) -> list[dict]:
    refuse_while_sharing()
    if draft.id != server_id:
        raise HTTPException(422, "identifiant incohérent")
    connections.upsert_mcp(_mcp_with_token(draft))
    return connections.public_services()["mcp"]


@app.delete("/api/connections/mcp/{server_id}", status_code=204)
async def delete_mcp(server_id: str) -> Response:
    refuse_while_sharing()
    try:
        connections.remove_mcp(server_id)
    except KeyError as exc:
        raise HTTPException(404, "serveur MCP inconnu") from exc
    return Response(status_code=204)


@app.post("/api/connections/mcp/test")
async def test_mcp(draft: McpDraft) -> dict:
    refuse_while_sharing()
    return await mcp.list_tools(_mcp_with_token(draft))


@app.post("/api/connections/test")
async def test_provider(draft: ProviderDraft) -> dict:
    """Teste un fournisseur (enregistré ou non) : modèles trouvés, durée, erreur."""
    refuse_while_sharing()
    provider = connections.Provider(**draft.model_dump(exclude={"keep_key"}))
    if draft.keep_key and not provider.api_key:
        stored = {p.id: p for p in connections.providers()}.get(provider.id)
        provider.api_key = stored.api_key if stored else ""
    models, error, seconds = await providers.probe(provider)
    # Premier mot sur le premier modèle (chargement compris) : révèle un raisonnement
    # silencieux ou un modèle trop gros pour la VRAM
    first = (
        await providers.first_token(provider, models[0]["model"])
        if models and not error
        else None
    )
    return {
        "ok": error is None,
        "error": error,
        "seconds": round(seconds, 2),
        "count": len(models),
        "models": [m["model"] for m in models][:12],
        "firstToken": first,
        "firstModel": models[0]["model"] if models else None,
    }


@app.get("/api/settings")
async def get_settings() -> Settings:
    return load_settings()


@app.put("/api/settings")
async def update_settings(update: SettingsUpdate) -> Settings:
    settings = load_settings()
    if update.model is not None:
        update.model = providers.normalize(update.model)
    if update.model is not None and update.model != settings.model:
        known = {m["name"]: m for m in await chat_models()}
        if update.model not in known:
            raise HTTPException(422, f"Modèle inconnu : {update.model}")
        if not known[update.model]["available"] and not claude.is_claude(update.model):
            raise HTTPException(
                422, "Modèle externe indisponible (hors ligne ou partage en cours)"
            )
        if claude.is_claude(update.model) and not claude_available():
            raise HTTPException(
                422,
                "Modèles Claude indisponibles (hors ligne ou partage en cours)",
            )
        settings.model = update.model
        if not claude.is_claude(update.model):
            asyncio.create_task(providers.preload(update.model))
    if update.fallback is not None:
        update.fallback = providers.normalize(update.fallback)
        if update.fallback and update.fallback != settings.fallback:
            if claude.is_claude(update.fallback):
                raise HTTPException(422, "Le modèle de repli ne peut pas être Claude")
            if update.fallback not in {m["name"] for m in await chat_models()}:
                raise HTTPException(422, f"Modèle inconnu : {update.fallback}")
        settings.fallback = update.fallback
    if update.voice is not None:
        if update.voice not in {v["id"] for v in voice_catalog()["voices"]}:
            raise HTTPException(422, f"Voix inconnue : {update.voice}")
        settings.voice = update.voice
    if update.project is not None:
        if update.project and update.project not in {
            p["id"] for p in await rag.projects()
        }:
            raise HTTPException(422, f"Projet inconnu : {update.project}")
        settings.project = update.project
    if update.agent is not None:
        if update.agent and agents.find(update.agent) is None:
            raise HTTPException(422, f"Agent inconnu : {update.agent}")
        settings.agent = update.agent
    if update.mode is not None:
        if modes.find(update.mode) is None:
            raise HTTPException(422, f"Mode inconnu : {update.mode}")
        settings.mode = update.mode
    save_settings(settings)
    logger.info(
        "Réglages : modèle=%s repli=%s voix=%s projet=%s agent=%s mode=%s",
        settings.model or "repli",
        settings.fallback or "auto",
        settings.voice,
        settings.project or "aucun",
        settings.agent or "aucun",
        settings.mode,
    )
    return settings


@app.get("/api/projects")
async def list_projects() -> list[dict]:
    return await rag.projects()


# --- RAG intégré : projets et documents (cf. ragstore.py) ---------------------------


@app.get("/api/rag/projects/{project}/documents")
async def rag_documents(project: str) -> list[dict]:
    try:
        return await ragstore.list_documents(project)
    except (ragstore.StoreError, httpx.HTTPError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/rag/projects/{project}/documents", status_code=201)
async def rag_add_document(project: str, request: Request) -> dict:
    """Corps brut du fichier ; nom dans l'en-tête X-Filename (encodé URL)."""
    refuse_while_sharing()
    name = unquote(request.headers.get("x-filename", "")).strip() or "document"
    name = name.replace("/", "_").replace("\\", "_")[:120]
    start = time.monotonic()
    try:
        doc = await ragstore.add_document(project, name, await request.body())
    except ragstore.StoreError as exc:
        raise HTTPException(422, str(exc)) from exc
    logger.info(
        "RAG intégré : %s indexé dans %s (%d extraits, %.1f s)",
        name,
        project,
        doc["chunks"],
        time.monotonic() - start,
    )
    return doc


@app.delete("/api/rag/projects/{project}/documents/{doc_id:path}", status_code=204)
async def rag_remove_document(project: str, doc_id: str) -> Response:
    refuse_while_sharing()
    try:
        await ragstore.remove_document(project, doc_id)
    except ragstore.StoreError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(status_code=204)


@app.delete("/api/rag/projects/{project}", status_code=204)
async def rag_remove_project(project: str) -> Response:
    refuse_while_sharing()
    try:
        await ragstore.remove_project(project)
    except (ragstore.StoreError, httpx.HTTPError) as exc:
        raise HTTPException(422, str(exc)) from exc
    settings = load_settings()
    if settings.project == project:
        settings.project = ""
        save_settings(settings)
    return Response(status_code=204)


@app.get("/api/turn/last")
async def turn_last() -> dict:
    return last_turn


async def check_agent(draft: agents.AgentDraft) -> None:
    if draft.project and draft.project not in {p["id"] for p in await rag.projects()}:
        raise HTTPException(422, f"Projet inconnu : {draft.project}")
    if draft.model:
        draft.model = providers.normalize(draft.model)
    if draft.model and draft.model not in {m["name"] for m in await chat_models()}:
        raise HTTPException(422, f"Modèle inconnu : {draft.model}")


@app.get("/api/modes")
async def list_modes() -> list[modes.Mode]:
    return modes.MODES


@app.get("/api/agents")
async def list_agents() -> list[agents.Agent]:
    # Modèle propre à l'agent : nom complet <fournisseur>/<modèle> (anciens noms inclus)
    return [
        a.model_copy(update={"model": providers.normalize(a.model)})
        for a in agents.load()
    ]


@app.get("/api/agents/meta")
async def agents_meta() -> dict:
    return {"domains": agents.DOMAINS, "usages": agents.USAGES}


@app.post("/api/agents", status_code=201)
async def create_agent(draft: agents.AgentDraft) -> agents.Agent:
    await check_agent(draft)
    known = agents.load()
    agent_id = agents.slug(draft.name)
    if not agent_id or any(a.id == agent_id for a in known):
        raise HTTPException(409, f"Un agent porte déjà ce nom : {draft.name}")
    agent = agents.Agent(id=agent_id, **draft.model_dump())
    agents.save([*known, agent])
    logger.info("Agent créé : %s", agent.name)
    return agent


@app.put("/api/agents/{agent_id}")
async def update_agent(agent_id: str, draft: agents.AgentDraft) -> agents.Agent:
    await check_agent(draft)
    known = agents.load()
    if not any(a.id == agent_id for a in known):
        raise HTTPException(404, f"Agent inconnu : {agent_id}")
    # L'identifiant reste stable même si le nom change (réglage `agent` conservé)
    agent = agents.Agent(id=agent_id, **draft.model_dump())
    agents.save([agent if a.id == agent_id else a for a in known])
    return agent


@app.delete("/api/agents/{agent_id}", status_code=204)
async def delete_agent(agent_id: str) -> None:
    known = agents.load()
    if not any(a.id == agent_id for a in known):
        raise HTTPException(404, f"Agent inconnu : {agent_id}")
    agents.save([a for a in known if a.id != agent_id])
    settings = load_settings()
    if settings.agent == agent_id:
        settings.agent = ""
        save_settings(settings)


# Agent, modèle et documentation de la dernière réponse, affichés sous celle-ci
last_turn: dict = {
    "at": 0.0,
    "agent": None,
    "model": None,
    "projects": [],
    "sources": [],
    # Blocs de code retirés de la voix, affichés sous la réponse (cf. voicecode)
    "code": [],
    # Documents joints lus ou écartés (trop longs pour la voix, image avec Claude)
    "documents": [],
    "skipped": [],
    # Recherche web : {"query", "sources"}, {"offline": True} ou None ; mots-clés
    "web": None,
    # Remarque affichée sous la réponse (ex. Claude remplacé hors ligne)
    "notice": None,
}


def keep_code(blocks: list[dict]) -> None:
    last_turn["code"] = blocks


async def prepare(
    messages: list[dict], settings: Settings, spoken: bool = True
) -> tuple[list[dict], str, dict]:
    """Assemble la consigne : documents joints, mode, agent (choisi ou cité), RAG.

    Les documents passent en premier (préfixe stable d'une question à l'autre, cache
    d'Ollama), la documentation RAG en dernier (elle change à chaque question).
    Renvoie les messages, le modèle (celui de l'agent s'il en a un) et l'usage des
    documents.
    """
    agent = agents.cited(rag.question(messages))
    if agent is None and settings.agent:
        agent = agents.find(settings.agent)
    model = providers.normalize(
        (agent.model if agent and agent.model else "") or settings.model
    )
    notice = None
    chosen, model = model, await usable_model(model, settings)
    if chosen and model != chosen:
        reason = (
            "partage en cours"
            if sharing()
            else "hors ligne"
            if not web.online()
            else "modèle indisponible"
        )
        notice = f"{reason} : {chosen} remplacé par le modèle de repli {model}"

    attached = [d for d in map(documents.load, settings.documents) if d]
    refused = []
    if claude.is_claude(model):
        # Le bridge Claude ne transmet que du texte
        refused = [
            f"{d['name']} (image, non lisible par Claude)"
            for d in attached
            if d["kind"] == "image"
        ]
        attached = [d for d in attached if d["kind"] != "image"]
    messages, usage = documents.inject(messages, attached, spoken)

    mode = modes.find(settings.mode)
    if mode and mode.instructions:
        messages = rag.add_system(messages, mode.instructions)
    if agent:
        messages = rag.add_system(messages, agents.instructions(agent))
    project = (agent.project if agent and agent.project else "") or settings.project
    messages = await rag.augment(messages, project, spoken)
    found, prefix = None, ""
    asked = rag.question(messages)
    if asked and web.wanted(asked):
        if web.online():
            found = await web.search(asked)
            if found:
                messages = rag.add_system(messages, web.context(found, spoken))
            else:
                notice = "recherche web sans résultat : réponse sur les connaissances du modèle"
        else:
            messages = rag.add_system(messages, web.OFFLINE_RULES)
            prefix = web.OFFLINE_NOTICE
    usage["prefix"] = prefix
    last_turn.update(
        web=(
            {"query": found["query"], "sources": web.public_sources(found)}
            if found
            else {"offline": True}
            if prefix
            else None
        ),
        notice=notice,
        at=time.time(),
        agent=agent.name if agent else None,
        model=model,
        projects=rag.last_usage["projects"],
        sources=rag.last_usage["sources"],
        code=[],
        documents=usage["used"],
        skipped=usage["skipped"] + refused,
    )
    if agent:
        logger.info("Agent %s (modèle %s)", agent.name, model)
    return messages, model, usage


# --- Documents joints ----------------------------------------------------------------


@app.post("/api/documents", status_code=201)
async def upload_document(request: Request) -> dict:
    """Corps brut du fichier ; nom dans l'en-tête X-Filename (encodé URL)."""
    name = unquote(request.headers.get("x-filename", "")).strip() or "document"
    name = name.replace("/", "_").replace("\\", "_")[:120]
    try:
        extracted = documents.extract(name, await request.body())
    except documents.DocumentError as exc:
        raise HTTPException(422, f"{name} : {exc}") from exc
    doc = documents.save(name, extracted)
    settings = load_settings()
    settings.documents = [*settings.documents, doc["id"]]
    save_settings(settings)
    logger.info(
        "Document joint : %s (%s, ~%d tokens)", name, doc["kind"], doc["tokens"]
    )
    return documents.summary(doc)


@app.get("/api/documents")
async def list_documents() -> list[dict]:
    return [
        documents.summary(d)
        for d in map(documents.load, load_settings().documents)
        if d
    ]


@app.delete("/api/documents/{doc_id}", status_code=204)
async def remove_document(doc_id: str) -> Response:
    settings = load_settings()
    settings.documents = [d for d in settings.documents if d != doc_id]
    save_settings(settings)
    documents.delete(doc_id)
    return Response(status_code=204)


@app.delete("/api/documents", status_code=204)
async def clear_documents() -> Response:
    """Nouvelle conversation : les documents joints sont retirés et supprimés."""
    settings = load_settings()
    for doc_id in settings.documents:
        documents.delete(doc_id)
    settings.documents = []
    save_settings(settings)
    return Response(status_code=204)


# --- Fiches de connaissance ------------------------------------------------------


class DraftRequest(BaseModel):
    messages: list[dict] | None = None
    document_id: str | None = None
    project: str = ""


async def ask_llm(system: str, user: str) -> str:
    """Réponse complète (non diffusée) du modèle actif, pour une tâche de rédaction."""
    settings = load_settings()
    model = await usable_model(settings.model, settings)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    if claude.is_claude(model):
        return await claude.ask(model, messages, spoken=False)
    return await providers.complete(model, messages, json_mode=True)


@app.post("/api/knowledge/draft")
async def knowledge_draft(request: DraftRequest) -> dict:
    refuse_while_sharing()
    document = documents.load(request.document_id) if request.document_id else None
    if request.document_id and not document:
        raise HTTPException(404, "document inconnu")
    if document and document["kind"] == "image":
        raise HTTPException(422, "une image ne peut pas être résumée en fiche")
    try:
        text, label, cut = knowledge.source_text(request.messages, document)
        answer = await ask_llm(knowledge.DRAFT_RULES, f"Source ({label}) :\n\n{text}")
        draft = knowledge.parse_draft(answer)
    except knowledge.KnowledgeError as exc:
        raise HTTPException(422, str(exc)) from exc
    draft = {
        "title": str(draft.get("title") or ""),
        "body": str(draft.get("body") or ""),
        "tags": draft.get("tags") or [],
        "valid_until": draft.get("valid_until") or None,
        "project": request.project,
        "source": {"kind": "document" if document else "conversation", "name": label},
    }
    return {"draft": draft, "cut": cut, "similar": await knowledge.similar(draft)}


@app.post("/api/knowledge/similar")
async def knowledge_similar(draft: dict) -> list[dict]:
    return await knowledge.similar(draft)


@app.get("/api/knowledge")
async def knowledge_list() -> dict:
    return {"enabled": knowledge.enabled(), "cards": knowledge.cards()}


class SaveRequest(BaseModel):
    card: dict
    replaces: list[str] = []


@app.post("/api/knowledge")
async def knowledge_save(request: SaveRequest) -> dict:
    refuse_while_sharing()
    try:
        return await knowledge.save(request.card, request.replaces)
    except knowledge.KnowledgeError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/knowledge/{card_id}/obsolete")
async def knowledge_obsolete(card_id: str) -> dict:
    refuse_while_sharing()
    try:
        return await knowledge.obsolete(card_id)
    except knowledge.KnowledgeError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/knowledge/{card_id}", status_code=204)
async def knowledge_delete(card_id: str) -> Response:
    refuse_while_sharing()
    try:
        await knowledge.delete(card_id)
    except knowledge.KnowledgeError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(status_code=204)


def to_native(messages: list[dict]) -> list[dict]:
    """Messages OpenAI -> API native d'Ollama (images à part, en base64)."""
    native = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            text = " ".join(
                p.get("text", "") for p in content if p.get("type") == "text"
            )
            images = [
                p["image_url"]["url"].split(",", 1)[1]
                for p in content
                if p.get("type") == "image_url"
            ]
            native.append({"role": message["role"], "content": text, "images": images})
        else:
            native.append({"role": message["role"], "content": content or ""})
    return native


async def with_prefix(
    model: str, prefix: str, chunks: AsyncIterator[bytes]
) -> AsyncIterator[bytes]:
    """Phrase imposée en tête de réponse (ex. connexion perdue), puis le flux du LLM."""
    if prefix:
        yield claude._chunk(model, prefix)
    async for chunk in chunks:
        yield chunk


class ChatRequest(BaseModel):
    messages: list[dict]


@app.post("/api/chat")
async def written_chat(request: ChatRequest) -> StreamingResponse:
    """Réponse écrite : même préparation que la voix, flux `chat.completion.chunk`."""
    start = time.monotonic()
    settings = load_settings()
    messages, model, usage = await prepare(request.messages, settings, spoken=False)
    if claude.is_claude(model):
        return StreamingResponse(
            claude.stream_reply(
                model,
                messages,
                on_done=lambda seconds: record_observed(model, seconds, None),
                spoken=False,
            ),
            media_type="text/event-stream",
        )
    long_context = usage["tokens"] > documents.LONG_CONTEXT_FROM
    provider, _ = providers.resolve(model)
    native = long_context and provider.type == "ollama"
    if native:
        # Contexte long : l'API /v1 d'Ollama ne transmet pas num_ctx, l'API native oui
        logger.info("Contexte long : ~%d tokens de documents", usage["tokens"])
    upstream = await providers.open_stream(
        model,
        {"messages": to_native(messages) if native else messages},
        native_ctx=documents.LONG_CONTEXT if native else None,
    )
    chunks = (
        providers.native_stream(model, upstream) if native else upstream.aiter_raw()
    )
    return StreamingResponse(
        with_prefix(model, usage["prefix"], measure(model, start, chunks)),
        status_code=upstream.status_code,
        media_type="text/event-stream",
        background=BackgroundTask(upstream.aclose),
    )


@app.api_route("/v1/{path:path}", methods=["GET", "POST"])
async def relay(path: str, request: Request) -> StreamingResponse:
    start = time.monotonic()
    body = await request.body()
    settings = load_settings()
    model = settings.model
    chat = path == "chat/completions" and request.method == "POST"
    payload: dict = {}
    prefix = ""
    if chat or (
        body and request.headers.get("content-type", "").startswith("application/json")
    ):
        payload = json.loads(body)
    if chat and "messages" in payload:
        # Voix : l'historique du moteur ne contient que le texte prononcé
        messages = voicecode.restore(payload["messages"])
        payload["messages"], model, usage = await prepare(messages, settings)
        prefix = usage["prefix"]
    if claude.is_claude(model):
        if not chat:
            raise HTTPException(501, f"/v1/{path} non disponible avec {model}")
        return StreamingResponse(
            claude.stream_reply(
                model,
                payload["messages"],
                on_done=lambda seconds: record_observed(model, seconds, None),
                on_blocks=keep_code,
            ),
            media_type="text/event-stream",
        )
    if path == "models":
        model = model or await fallback_model(settings)
        return JSONResponse({"object": "list", "data": [{"id": model}]})
    if not chat:
        raise HTTPException(404, f"/v1/{path} non relayé")
    upstream = await providers.open_stream(model, payload)
    chunks = voicecode.filter_sse(upstream.aiter_raw(), keep_code)
    return StreamingResponse(
        with_prefix(model, prefix, measure(model, start, chunks)),
        status_code=upstream.status_code,
        media_type="text/event-stream",
        background=BackgroundTask(upstream.aclose),
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
