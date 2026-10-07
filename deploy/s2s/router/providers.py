"""Fournisseurs de modèles : découverte dynamique, appels et flux, quel que soit le type.

- `ollama` : API native (liste avec taille et capacités, modèles chargés, `think`,
  `keep_alive`, `num_ctx` pour les documents longs) et API OpenAI `/v1` pour le flux.
- `openai` : toute API compatible OpenAI (LiteLLM, vLLM, OpenAI, Mistral, Groq…) :
  `GET {url}/models`, `POST {url}/chat/completions` ; l'adresse inclut le `/v1`.

Nom d'un modèle : `<fournisseur>/<modèle>` (ex. `ollama/gemma4:e4b`,
`litellm/gpt-4o`). Un nom sans fournisseur connu désigne le fournisseur `ollama`
(réglages et agents enregistrés avant l'arrivée des fournisseurs).
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator

import httpx

import connections
from connections import Provider

LIST_TTL_S = 30
DISCOVERY_TIMEOUT = httpx.Timeout(5)
# Paramètres propres à Ollama, refusés par certaines API OpenAI-compatibles
OLLAMA_ONLY = ("reasoning_effort", "keep_alive", "think", "options")
# Raisonnement coupé sur une API OpenAI-compatible (option du fournisseur). LiteLLM,
# avec drop_params, retire reasoning_effort sauf s'il est explicitement autorisé :
# sans cela, gemma4 réfléchit 3 à 30 s avant le premier mot (mesuré, cf. ADR 0009).
NO_REASONING = {
    "reasoning_effort": "none",
    "allowed_openai_params": ["reasoning_effort"],
}

logger = logging.getLogger("router.providers")
_clients: dict[tuple[str, str], httpx.AsyncClient] = {}
_cache: tuple[float, list[dict], dict] = (0.0, [], {})


def client(provider: Provider) -> httpx.AsyncClient:
    key = (provider.url, provider.api_key)
    if key not in _clients:
        headers = (
            {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        )
        _clients[key] = httpx.AsyncClient(
            base_url=provider.url,
            headers=headers,
            timeout=httpx.Timeout(10, read=None),
        )
    return _clients[key]


def split(name: str) -> tuple[str, str]:
    """(identifiant du fournisseur, modèle) ; nom ancien sans fournisseur -> ollama.

    « ollama/ » est toujours un préfixe, même fournisseur supprimé : sans cela, chaque
    passage rajouterait « ollama/ » (« ollama/ollama/… »).
    """
    head, sep, rest = name.partition("/")
    if sep and (head == "ollama" or head in {p.id for p in connections.providers()}):
        return head, rest
    return "ollama", name


def normalize(name: str) -> str:
    """Nom complet `<fournisseur>/<modèle>` (sauf Claude, servi à part)."""
    if not name or name.startswith("claude:"):
        return name
    provider_id, model = split(name)
    return f"{provider_id}/{model}"


def resolve(name: str) -> tuple[Provider, str]:
    provider_id, model = split(name)
    for provider in connections.providers():
        if provider.id == provider_id and provider.enabled:
            return provider, model
    raise LookupError(f"fournisseur indisponible pour {name}")


# --- Découverte ------------------------------------------------------------------------


async def _ollama_models(provider: Provider) -> list[dict]:
    http = client(provider)
    tags = (await http.get("/api/tags", timeout=DISCOVERY_TIMEOUT)).json()["models"]
    loaded = {
        m["name"]
        for m in (await http.get("/api/ps", timeout=DISCOVERY_TIMEOUT))
        .json()
        .get("models", [])
    }

    async def describe(tag: dict) -> dict | None:
        show = (
            await http.post(
                "/api/show", json={"model": tag["name"]}, timeout=DISCOVERY_TIMEOUT
            )
        ).json()
        if "completion" not in show.get("capabilities", []):
            return None  # modèle d'embeddings, etc.
        return {
            "model": tag["name"],
            "sizeGb": round(tag["size"] / 1e9, 1),
            "parameterSize": tag.get("details", {}).get("parameter_size"),
            "loaded": tag["name"] in loaded,
        }

    found = await asyncio.gather(*(describe(t) for t in tags))
    return sorted((m for m in found if m), key=lambda m: m["sizeGb"])


async def _openai_models(provider: Provider) -> list[dict]:
    response = await client(provider).get("/models", timeout=DISCOVERY_TIMEOUT)
    response.raise_for_status()
    ids = sorted(m["id"] for m in response.json().get("data", []) if m.get("id"))
    # Les API externes listent aussi embeddings, images, audio : on les écarte au nom
    skip = ("embed", "whisper", "tts", "dall-e", "moderation", "image", "rerank")
    return [
        {"model": i, "loaded": True}
        for i in ids
        if not any(word in i.lower() for word in skip)
    ]


async def probe(provider: Provider) -> tuple[list[dict], str | None, float]:
    """Modèles du fournisseur, erreur éventuelle, durée (pour le bouton « Tester »)."""
    start = time.monotonic()
    try:
        if provider.type == "ollama":
            models = await _ollama_models(provider)
        else:
            models = await _openai_models(provider)
        return models, None, time.monotonic() - start
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        # Première ligne seulement (httpx ajoute un lien d'aide)
        reason = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        return [], reason[:300], time.monotonic() - start


async def list_models(allow_external: bool, force: bool = False) -> list[dict]:
    """Modèles de tous les fournisseurs actifs (cache court), noms complets."""
    global _cache
    fetched_at, cached, _ = _cache
    if not force and time.monotonic() - fetched_at < LIST_TTL_S:
        models = cached
    else:
        active = [p for p in connections.providers() if p.enabled]
        results = await asyncio.gather(*(probe(p) for p in active))
        models, status = [], {}
        for provider, (found, error, seconds) in zip(active, results):
            status[provider.id] = {"error": error, "count": len(found)}
            if error:
                logger.warning("Fournisseur %s injoignable : %s", provider.id, error)
            for model in found:
                models.append(
                    {
                        **model,
                        "name": f"{provider.id}/{model['model']}",
                        "label": model["model"],
                        "provider": provider.type,
                        "providerId": provider.id,
                        "providerName": provider.name,
                        "local": provider.local,
                    }
                )
        _cache = (time.monotonic(), models, status)
    return [{**m, "available": m["local"] or allow_external} for m in models]


def status() -> dict:
    return _cache[2]


def invalidate() -> None:
    global _cache
    _cache = (0.0, [], {})


# --- Appels ------------------------------------------------------------------------------


async def complete(
    name: str,
    messages: list[dict],
    json_mode: bool = False,
    max_tokens: int | None = None,
    temperature: float | None = None,
    timeout: float = 300,
) -> str:
    """Réponse complète (non diffusée)."""
    provider, model = resolve(name)
    http = client(provider)
    if provider.type == "ollama":
        options: dict[str, float] = {}
        if max_tokens:
            options["num_predict"] = max_tokens
        if temperature is not None:
            options["temperature"] = temperature
        body: dict = {
            "model": model,
            "messages": messages,
            "stream": False,
            "think": False,
            "keep_alive": "30m",
            "options": options,
        }
        if json_mode:
            body["format"] = "json"
        response = await http.post(
            "/api/chat", json=body, timeout=httpx.Timeout(10, read=timeout)
        )
        return response.json().get("message", {}).get("content", "")
    body = {"model": model, "messages": messages, "stream": False}
    if provider.cut_reasoning:
        body.update(NO_REASONING)
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if max_tokens:
        body["max_tokens"] = max_tokens
    if temperature is not None:
        body["temperature"] = temperature
    response = await http.post(
        "/chat/completions", json=body, timeout=httpx.Timeout(10, read=timeout)
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"].get("content") or ""


async def open_stream(
    name: str, payload: dict, native_ctx: int | None = None
) -> httpx.Response:
    """Flux `chat.completion.chunk` (réponse httpx à fermer par l'appelant).

    `payload` : corps OpenAI (messages, paramètres) ; le modèle est remplacé. Pour un
    fournisseur Ollama, `native_ctx` passe par l'API native (seule à accepter num_ctx) :
    le flux est alors au format natif (cf. native_stream).
    """
    provider, model = resolve(name)
    http = client(provider)
    if provider.type == "ollama":
        if native_ctx:
            body = {
                "model": model,
                "messages": payload["messages"],
                "stream": True,
                "think": False,
                "keep_alive": "30m",
                "options": {"num_ctx": native_ctx},
            }
            return await http.send(
                http.build_request("POST", "/api/chat", json=body), stream=True
            )
        body = {**payload, "model": model, "stream": True}
        # Pas de raisonnement à l'oral ni à l'écrit (gemma4 réfléchit par défaut)
        body.setdefault("reasoning_effort", "none")
        return await http.send(
            http.build_request("POST", "/v1/chat/completions", json=body), stream=True
        )
    body = {k: v for k, v in payload.items() if k not in OLLAMA_ONLY and k != "model"}
    body.update(model=model, stream=True)
    if provider.cut_reasoning:
        body.update(NO_REASONING)
    return await http.send(
        http.build_request("POST", "/chat/completions", json=body), stream=True
    )


async def native_stream(model: str, response: httpx.Response) -> AsyncIterator[bytes]:
    """Flux natif d'Ollama (JSON par ligne) -> SSE `chat.completion.chunk`."""
    async for line in response.aiter_lines():
        if not line.strip():
            continue
        data = json.loads(line)
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


async def preload(name: str) -> None:
    """Charge et préchauffe un modèle Ollama : sans cela, la 1re réponse prend ~10 s."""
    try:
        provider, model = resolve(name)
    except LookupError:
        return
    if provider.type != "ollama":
        return
    try:
        await client(provider).post(
            "/api/generate",
            json={
                "model": model,
                "prompt": "Bonjour",
                "keep_alive": "30m",
                "think": False,
                "options": {"num_predict": 1},
            },
        )
        logger.info("Modèle préchargé : %s", name)
    except httpx.HTTPError as exc:
        logger.warning("Préchargement de %s impossible : %s", name, exc)


async def first_token(provider: Provider, model: str) -> dict:
    """Temps jusqu'au premier mot sur une petite question, et raisonnement éventuel."""
    http = client(provider)
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Réponds seulement : OK."}],
        "stream": True,
        "max_tokens": 400,
    }
    path = "/v1/chat/completions" if provider.type == "ollama" else "/chat/completions"
    if provider.type == "ollama" or provider.cut_reasoning:
        payload.update(
            NO_REASONING if provider.type != "ollama" else {"reasoning_effort": "none"}
        )
    start = time.monotonic()
    reasoning = 0
    try:
        async with http.stream(
            "POST", path, json=payload, timeout=httpx.Timeout(10, read=90)
        ) as response:
            if response.status_code != 200:
                return {"error": f"HTTP {response.status_code}"}
            async for line in response.aiter_lines():
                if not line.startswith("data: {"):
                    continue
                choices = json.loads(line[6:]).get("choices") or [{}]
                delta = choices[0].get("delta", {})
                if delta.get("reasoning_content") or delta.get("reasoning"):
                    reasoning += 1
                if delta.get("content"):
                    return {
                        "seconds": round(time.monotonic() - start, 2),
                        "reasoning": reasoning,
                    }
    except (httpx.HTTPError, ValueError) as exc:
        return {"error": str(exc).splitlines()[0][:200] if str(exc) else "erreur"}
    return {"error": "pas de réponse", "reasoning": reasoning}
