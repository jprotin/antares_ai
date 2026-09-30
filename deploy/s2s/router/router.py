"""Routeur LLM d'antares : relaie le moteur s2s vers Ollama avec le modèle choisi dans l'interface.

- /v1/*          : relais OpenAI-compatible vers Ollama ; le champ `model` est réécrit
                   avec le modèle actif (le moteur s2s fixe le sien au démarrage).
- /api/models    : modèles de chat installés dans Ollama, avec la vitesse mesurée sur les
                   conversations relayées (la part VRAM rapportée par Ollama est fausse
                   pour les modèles à experts comme gemma4:26b).
                   S'y ajoutent les modèles Claude (`claude:*`) servis par le claude-bridge
                   d'ai-to-boost (cf. claude.py) : texte envoyé chez Anthropic.
- /api/settings  : réglages actifs {model, voice, project, agent, mode}, persistés dans
                   SETTINGS_PATH.
- /api/modes     : modes de conversation (cf. modes.py).
- /api/projects  : projets indexés dans le RAG d'ai-to-boost (cf. rag.py).
- /api/agents    : agents « consignes » (cf. agents.py) : liste, création, modification,
                   suppression ; /api/agents/meta : domaines et utilités proposés.
- /api/turn/last : agent, modèle, projets et sources de la dernière réponse.
- /api/chat      : conversation écrite hors appel (réponse texte en flux SSE, sans voix),
                   avec le même mode, agent et documentation que la voix.
- /api/documents : documents joints à la conversation (cf. documents.py) : envoi (corps
                   brut + en-tête X-Filename), liste, retrait.
- /api/net       : connexion Internet et recherche web en cours (cf. web.py). Hors
                   ligne, les modèles Claude sont indisponibles.
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
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

import agents
import claude
import documents
import knowledge
import modes
import rag
import voicecode
import web

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
DEFAULT_MODEL = os.environ["DEFAULT_MODEL"]
SETTINGS_PATH = Path(os.environ.get("SETTINGS_PATH", "/data/settings.json"))
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
client = httpx.AsyncClient(base_url=OLLAMA_URL, timeout=httpx.Timeout(10, read=None))


class Settings(BaseModel):
    model: str
    voice: str
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
    voice: str | None = None
    project: str | None = None
    agent: str | None = None
    mode: str | None = None


def voice_catalog() -> dict:
    return json.loads(VOICES_CATALOG.read_text(encoding="utf-8"))


def load_settings() -> Settings:
    defaults = Settings(model=DEFAULT_MODEL, voice=voice_catalog()["default"])
    if not SETTINGS_PATH.exists():
        return defaults
    stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    return defaults.model_copy(
        update={k: v for k, v in stored.items() if k in Settings.model_fields}
    )


def save_settings(settings: Settings) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
    tmp.replace(SETTINGS_PATH)


def load_observed() -> dict:
    return json.loads(OBSERVED_PATH.read_text()) if OBSERVED_PATH.exists() else {}


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


async def chat_models() -> list[dict]:
    tags = (await client.get("/api/tags")).json().get("models", [])
    loaded = {m["name"] for m in (await client.get("/api/ps")).json().get("models", [])}
    observed = load_observed()
    models = []
    for tag in tags:
        show = (await client.post("/api/show", json={"model": tag["name"]})).json()
        if "completion" not in show.get("capabilities", []):
            continue
        models.append(
            {
                "name": tag["name"],
                "label": tag["name"],
                "provider": "ollama",
                "sizeGb": round(tag["size"] / 1e9, 1),
                "parameterSize": tag.get("details", {}).get("parameter_size"),
                "loaded": tag["name"] in loaded,
                "observed": observed.get(tag["name"]),
            }
        )
    models.sort(key=lambda m: m["sizeGb"])
    for model in await claude.available_models():
        models.append(
            {
                **model,
                "loaded": True,
                "observed": observed.get(model["name"]),
                # Claude passe par Internet : indisponible hors ligne
                "available": web.online(),
            }
        )
    return models


async def preload(model: str) -> None:
    """Charge et préchauffe le modèle : sans génération réelle, la 1re réponse prend ~10 s."""
    try:
        await client.post(
            "/api/generate",
            json={
                "model": model,
                "prompt": "Bonjour",
                "keep_alive": "30m",
                "think": False,
                "options": {"num_predict": 1},
            },
        )
        logger.info("Modèle préchargé : %s", model)
    except httpx.HTTPError as exc:
        logger.warning("Préchargement de %s impossible : %s", model, exc)


@app.on_event("startup")
async def start_watch() -> None:
    app.state.web_watch = asyncio.create_task(web.watch())


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/net")
async def net_state() -> dict:
    return web.state


class TagsRequest(BaseModel):
    question: str = Field(max_length=4000)
    answer: str = Field(max_length=20000)


@app.post("/api/web/tags")
async def web_tags(request: TagsRequest) -> dict:
    """Mots-clés d'une réponse issue d'une recherche web (modèle local, après coup)."""
    model = load_settings().model
    if claude.is_claude(model):
        model = DEFAULT_MODEL
    try:
        response = await client.post(
            "/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": web.TAGS_PROMPT},
                    {
                        "role": "user",
                        "content": f"Question : {request.question}\n\n"
                        f"Réponse : {request.answer[:6000]}",
                    },
                ],
                "stream": False,
                "think": False,
                "format": "json",
                "keep_alive": "30m",
                "options": {"temperature": 0.2, "num_predict": 80},
            },
            timeout=httpx.Timeout(30),
        )
        return {"tags": web.parse_tags(response.json()["message"]["content"])}
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("Mots-clés indisponibles : %s", exc)
        return {"tags": []}


@app.get("/api/models")
async def list_models() -> list[dict]:
    return await chat_models()


@app.get("/api/settings")
async def get_settings() -> Settings:
    return load_settings()


@app.put("/api/settings")
async def update_settings(update: SettingsUpdate) -> Settings:
    settings = load_settings()
    if update.model is not None and update.model != settings.model:
        if update.model not in {m["name"] for m in await chat_models()}:
            raise HTTPException(422, f"Modèle inconnu : {update.model}")
        if claude.is_claude(update.model) and not web.online():
            raise HTTPException(
                422, "Hors ligne : les modèles Claude sont indisponibles"
            )
        settings.model = update.model
        if not claude.is_claude(update.model):
            asyncio.create_task(preload(update.model))
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
        "Réglages : modèle=%s voix=%s projet=%s agent=%s mode=%s",
        settings.model,
        settings.voice,
        settings.project or "aucun",
        settings.agent or "aucun",
        settings.mode,
    )
    return settings


@app.get("/api/projects")
async def list_projects() -> list[dict]:
    return await rag.projects()


@app.get("/api/turn/last")
async def turn_last() -> dict:
    return last_turn


async def check_agent(draft: agents.AgentDraft) -> None:
    if draft.project and draft.project not in {p["id"] for p in await rag.projects()}:
        raise HTTPException(422, f"Projet inconnu : {draft.project}")
    if draft.model and draft.model not in {m["name"] for m in await chat_models()}:
        raise HTTPException(422, f"Modèle inconnu : {draft.model}")


@app.get("/api/modes")
async def list_modes() -> list[modes.Mode]:
    return modes.MODES


@app.get("/api/agents")
async def list_agents() -> list[agents.Agent]:
    return agents.load()


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
    model = (agent.model if agent and agent.model else "") or settings.model
    notice = None
    if claude.is_claude(model) and not web.online():
        notice = f"hors ligne : {model} remplacé par le modèle local {DEFAULT_MODEL}"
        model = DEFAULT_MODEL

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
    model = load_settings().model
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    if claude.is_claude(model):
        return await claude.ask(model, messages, spoken=False)
    response = await client.post(
        "/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "think": False,
            "format": "json",
            "keep_alive": "30m",
        },
        timeout=httpx.Timeout(10, read=300),
    )
    return response.json().get("message", {}).get("content", "")


@app.post("/api/knowledge/draft")
async def knowledge_draft(request: DraftRequest) -> dict:
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
    try:
        return await knowledge.save(request.card, request.replaces)
    except knowledge.KnowledgeError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/knowledge/{card_id}/obsolete")
async def knowledge_obsolete(card_id: str) -> dict:
    try:
        return await knowledge.obsolete(card_id)
    except knowledge.KnowledgeError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/knowledge/{card_id}", status_code=204)
async def knowledge_delete(card_id: str) -> Response:
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


async def native_stream(model: str, response: httpx.Response) -> AsyncIterator[bytes]:
    """Flux NDJSON natif d'Ollama -> flux SSE `chat.completion.chunk` (même format)."""
    async for line in response.aiter_lines():
        if not line.strip():
            continue
        data = json.loads(line)
        if data.get("error"):
            logger.error("Ollama (contexte long) : %s", data["error"])
            break
        content = data.get("message", {}).get("content")
        finish = "stop" if data.get("done") else None
        if content or finish:
            payload = {
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": content or ""},
                        "finish_reason": finish,
                    }
                ],
            }
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()
    yield b"data: [DONE]\n\n"


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
    if usage["tokens"] > documents.LONG_CONTEXT_FROM:
        # Contexte long : l'API /v1 ne transmet pas num_ctx, seule l'API native le fait
        upstream = await client.send(
            client.build_request(
                "POST",
                "/api/chat",
                json={
                    "model": model,
                    "messages": to_native(messages),
                    "stream": True,
                    "think": False,
                    "keep_alive": "30m",
                    "options": {"num_ctx": documents.LONG_CONTEXT},
                },
            ),
            stream=True,
        )
        logger.info("Contexte long : ~%d tokens de documents", usage["tokens"])
        return StreamingResponse(
            with_prefix(
                model,
                usage["prefix"],
                measure(model, start, native_stream(model, upstream)),
            ),
            status_code=upstream.status_code,
            media_type="text/event-stream",
            background=BackgroundTask(upstream.aclose),
        )
    upstream = await client.send(
        client.build_request(
            "POST",
            "/v1/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "stream": True,
                # Comme pour la voix : pas de raisonnement (gemma4 réfléchit par défaut)
                "reasoning_effort": "none",
            },
        ),
        stream=True,
    )
    return StreamingResponse(
        with_prefix(
            model, usage["prefix"], measure(model, start, upstream.aiter_raw())
        ),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
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
    if "model" in payload:
        payload["model"] = model
        body = json.dumps(payload).encode()
    upstream = await client.send(
        client.build_request(
            request.method,
            f"/v1/{path}",
            content=body,
            headers={
                "content-type": request.headers.get("content-type", "application/json")
            },
        ),
        stream=True,
    )
    chunks = upstream.aiter_raw()
    if chat:
        chunks = voicecode.filter_sse(chunks, keep_code)
    return StreamingResponse(
        with_prefix(model, prefix, measure(model, start, chunks)),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
        background=BackgroundTask(upstream.aclose),
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
