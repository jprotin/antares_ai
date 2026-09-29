"""Claude Code comme LLM de conversation, via le claude-bridge d'ai-to-boost.

Le bridge (service systemd de l'hôte) exécute `claude -p` sur l'abonnement de
l'utilisateur, sans outils ni accès web, et renvoie la réponse d'un bloc (~7 s,
surtout le démarrage de Claude Code). Ce module :
- expose des modèles virtuels `claude:<modèle>` ;
- convertit l'historique de conversation OpenAI en prompt texte ;
- dit tout de suite une courte phrase d'attente, puis diffuse la réponse au format
  SSE `chat.completion.chunk` attendu par le moteur s2s.

Le texte de la conversation part chez Anthropic : exception explicite au 100 % local,
signalée dans l'interface.
"""

import json
import logging
import os
import random
import re
import time
from collections.abc import AsyncIterator

import httpx

BRIDGE_URL = os.environ.get("CLAUDE_BRIDGE_URL", "http://host.docker.internal:8088")
BRIDGE_TOKEN = os.environ.get("CLAUDE_BRIDGE_TOKEN", "")
MODELS = [m for m in os.environ.get("CLAUDE_MODELS", "opus,sonnet").split(",") if m]
PREFIX = "claude:"
BRIDGE_TIMEOUT_S = 120

VOICE_RULES = (
    "Tu participes à une conversation vocale : ta réponse sera lue à voix haute. "
    "Écris un texte parlé, sans markdown, sans listes, sans titres ni emojis."
)
# Deux phrases : le moteur s2s n'envoie une phrase à la synthèse que lorsque la suivante
# commence. La 1re est donc dite tout de suite, la 2e juste avant la réponse de Claude.
FILLERS = [
    "Un instant. Je réfléchis.",
    "D'accord. Laisse-moi réfléchir.",
    "Je vois. Je regarde ça.",
]

logger = logging.getLogger("router.claude")
bridge = httpx.AsyncClient(
    base_url=BRIDGE_URL, timeout=httpx.Timeout(5, read=BRIDGE_TIMEOUT_S)
)


def is_claude(model: str) -> bool:
    return model.startswith(PREFIX)


async def available_models() -> list[dict]:
    """Modèles Claude proposés, uniquement si le bridge est configuré et répond."""
    if not BRIDGE_TOKEN:
        return []
    try:
        (await bridge.get("/health")).raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("claude-bridge injoignable (%s) : modèles Claude masqués", exc)
        return []
    return [
        {
            "name": f"{PREFIX}{m}",
            "label": f"Claude {m.capitalize()}",
            "provider": "claude",
        }
        for m in MODELS
    ]


def _text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


def build_prompt(messages: list[dict]) -> str:
    system = "\n".join(
        _text(m["content"]) for m in messages if m.get("role") == "system"
    )
    names = {"user": "Utilisateur", "assistant": "Assistant"}
    history = "\n".join(
        f"{names[m['role']]} : {_text(m['content']).strip()}"
        for m in messages
        if m.get("role") in names and _text(m.get("content")).strip()
    )
    return (
        f"{system}\n\n{VOICE_RULES}\n\n"
        f"Conversation jusqu'ici :\n{history}\n\n"
        "Réponds maintenant au dernier message de l'utilisateur, directement, "
        "sans préfixe « Assistant : »."
    )


def _chunk(model: str, content: str | None = None, finish: str | None = None) -> bytes:
    delta = {"role": "assistant", "content": content} if content is not None else {}
    payload = {
        "id": "chatcmpl-claude",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()


async def ask(model: str, messages: list[dict]) -> str:
    response = await bridge.post(
        "/run",
        headers={"Authorization": f"Bearer {BRIDGE_TOKEN}"},
        json={"model": model.removeprefix(PREFIX), "prompt": build_prompt(messages)},
    )
    response.raise_for_status()
    return response.json()["result"].strip()


async def stream_reply(
    model: str, messages: list[dict], on_done
) -> AsyncIterator[bytes]:
    """Phrase d'attente immédiate, puis la réponse découpée en phrases."""
    yield _chunk(model, random.choice(FILLERS) + " ")
    start = time.monotonic()
    try:
        answer = await ask(model, messages)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.error("Échec de l'appel Claude : %s", exc)
        answer = "Désolée, je n'arrive pas à joindre Claude pour le moment."
    on_done(time.monotonic() - start)
    for sentence in re.split(r"(?<=[.!?…])\s+", answer):
        if sentence:
            yield _chunk(model, sentence + " ")
    yield _chunk(model, finish="stop")
    yield b"data: [DONE]\n\n"
