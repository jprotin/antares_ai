"""Routeur LLM d'antares : relaie le moteur s2s vers Ollama avec le modèle choisi dans l'interface.

- /v1/*          : relais OpenAI-compatible vers Ollama ; le champ `model` est réécrit
                   avec le modèle actif (le moteur s2s fixe le sien au démarrage).
- /api/models    : modèles de chat installés dans Ollama, avec la vitesse mesurée sur les
                   conversations relayées (la part VRAM rapportée par Ollama est fausse
                   pour les modèles à experts comme gemma4:26b).
                   S'y ajoutent les modèles Claude (`claude:*`) servis par le claude-bridge
                   d'ai-to-boost (cf. claude.py) : texte envoyé chez Anthropic.
- /api/settings  : réglages actifs {model, voice}, persistés dans SETTINGS_PATH.
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
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

import claude

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


class SettingsUpdate(BaseModel):
    model: str | None = None
    voice: str | None = None


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
            {**model, "loaded": True, "observed": observed.get(model["name"])}
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


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


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
        settings.model = update.model
        if not claude.is_claude(update.model):
            asyncio.create_task(preload(update.model))
    if update.voice is not None:
        if update.voice not in {v["id"] for v in voice_catalog()["voices"]}:
            raise HTTPException(422, f"Voix inconnue : {update.voice}")
        settings.voice = update.voice
    save_settings(settings)
    logger.info("Réglages : modèle=%s voix=%s", settings.model, settings.voice)
    return settings


@app.api_route("/v1/{path:path}", methods=["GET", "POST"])
async def relay(path: str, request: Request) -> StreamingResponse:
    start = time.monotonic()
    body = await request.body()
    model = load_settings().model
    if claude.is_claude(model):
        if path != "chat/completions" or request.method != "POST":
            raise HTTPException(501, f"/v1/{path} non disponible avec {model}")
        return StreamingResponse(
            claude.stream_reply(
                model,
                json.loads(body)["messages"],
                on_done=lambda seconds: record_observed(model, seconds, None),
            ),
            media_type="text/event-stream",
        )
    if body and request.headers.get("content-type", "").startswith("application/json"):
        payload = json.loads(body)
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
    return StreamingResponse(
        measure(model, start, upstream.aiter_raw()),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
        background=BackgroundTask(upstream.aclose),
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
