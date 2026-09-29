"""Claude Code comme LLM de conversation, via le claude-bridge d'ai-to-boost.

Le bridge (service systemd de l'hôte) exécute `claude -p` sur l'abonnement de
l'utilisateur, sans outils ni accès web, et renvoie la réponse d'un bloc (~7 s,
surtout le démarrage de Claude Code). Ce module :
- expose des modèles virtuels `claude:<modèle>` ;
- convertit l'historique de conversation OpenAI en prompt texte ;
- diffuse la réponse, phrase par phrase, au format SSE `chat.completion.chunk`
  attendu par le moteur s2s (pendant l'attente, l'orbe reste sur « réflexion »).

Le texte de la conversation part chez Anthropic : exception explicite au 100 % local,
signalée dans l'interface.
"""

import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator

import httpx

import voicecode

BRIDGE_URL = os.environ.get("CLAUDE_BRIDGE_URL", "http://host.docker.internal:8088")
BRIDGE_TOKEN = os.environ.get("CLAUDE_BRIDGE_TOKEN", "")
MODELS = [m for m in os.environ.get("CLAUDE_MODELS", "opus,sonnet").split(",") if m]
PREFIX = "claude:"
BRIDGE_TIMEOUT_S = 120

VOICE_RULES = (
    "Tu participes à une conversation vocale : ta réponse sera lue à voix haute. "
    "Règle prioritaire : dès que ta réponse contient du code, même une seule ligne "
    "(script, commande, requête SQL, fichier de configuration), écris ce code entre "
    "trois accents graves avec le langage (```sql, puis le code, puis ```) ; ce bloc "
    "s'affiche à l'écran et n'est jamais lu. Autour, en phrases parlées, annonce que tu "
    "l'affiches puis explique ce qu'il fait étape par étape, sans lire le code. "
    "Pour tout le reste, écris un texte parlé, sans markdown, sans listes, sans titres "
    "ni emojis."
)

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


def build_prompt(messages: list[dict], spoken: bool = True) -> str:
    system = "\n".join(
        _text(m["content"]) for m in messages if m.get("role") == "system"
    )
    names = {"user": "Utilisateur", "assistant": "Assistant"}
    history = "\n".join(
        f"{names[m['role']]} : {_text(m['content']).strip()}"
        for m in messages
        if m.get("role") in names and _text(m.get("content")).strip()
    )
    rules = VOICE_RULES if spoken else ""
    return (
        f"{system}\n\n{rules}\n\n"
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


async def ask(model: str, messages: list[dict], spoken: bool = True) -> str:
    response = await bridge.post(
        "/run",
        headers={"Authorization": f"Bearer {BRIDGE_TOKEN}"},
        json={
            "model": model.removeprefix(PREFIX),
            "prompt": build_prompt(messages, spoken),
        },
    )
    response.raise_for_status()
    return response.json()["result"].strip()


async def stream_reply(
    model: str, messages: list[dict], on_done, spoken: bool = True, on_blocks=None
) -> AsyncIterator[bytes]:
    """Réponse de Claude découpée en phrases, pour que la synthèse démarre au plus tôt.

    À l'écrit (`spoken=False`), la réponse part d'un bloc : le découpage écraserait les
    retours à la ligne du Markdown.
    """
    start = time.monotonic()
    try:
        answer = await ask(model, messages, spoken)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.error("Échec de l'appel Claude : %s", exc)
        answer = "Désolée, je n'arrive pas à joindre Claude pour le moment."
    on_done(time.monotonic() - start)
    if not spoken:
        yield _chunk(model, answer)
        yield _chunk(model, finish="stop")
        yield b"data: [DONE]\n\n"
        return
    # Voix : les blocs de code sont affichés, pas lus (cf. voicecode)
    fences = voicecode.FenceFilter()
    full, answer = answer, fences.feed(answer) + fences.flush()
    voicecode.remember(answer, full)
    if on_blocks:
        on_blocks(fences.blocks)
    for sentence in re.split(r"(?<=[.!?…])\s+", answer):
        if sentence:
            yield _chunk(model, sentence + " ")
    yield _chunk(model, finish="stop")
    yield b"data: [DONE]\n\n"
