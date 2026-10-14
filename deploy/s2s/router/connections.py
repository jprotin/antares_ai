"""Interconnexions d'antares : fournisseurs de modèles, RAG, recherche web, Claude, MCP.

La configuration vit dans CONNECTIONS_PATH (volume du routeur, lisible par lui seul) ;
au premier lancement, elle est initialisée depuis les variables d'environnement de
compose.yaml, pour qu'une installation reste sans configuration.

Les clés d'API ne sortent jamais du routeur : l'interface ne reçoit qu'un indicateur
« clé définie ». Pour garder une clé en modifiant un fournisseur, on renvoie une clé
vide ; elle est alors conservée (même règle pour les jetons des services).
"""

import json
import os
import re
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

CONNECTIONS_PATH = Path(os.environ.get("CONNECTIONS_PATH", "/data/connections.json"))
PROVIDER_TYPES = ("ollama", "openai")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
# Préfixe réservé aux modèles Claude (bridge) : pas d'identifiant de fournisseur « claude »
RESERVED_IDS = {"claude"}


class Provider(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=60)
    type: str
    url: str = Field(min_length=8, max_length=300)
    api_key: str = Field(default="", max_length=400)
    # Déclaré par l'utilisateur : un fournisseur externe est coupé hors ligne et
    # pendant un partage, et signalé « hors local »
    local: bool = True
    enabled: bool = True
    # Couper le raisonnement des modèles qui « réfléchissent » (gemma4, qwen3) : sinon
    # des centaines de tokens silencieux avant le premier mot. None : selon `local`
    # (une API externe peut refuser le paramètre).
    no_reasoning: bool | None = None

    @property
    def cut_reasoning(self) -> bool:
        return self.local if self.no_reasoning is None else self.no_reasoning

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not ID_RE.match(value) or value in RESERVED_IDS:
            raise ValueError(
                "identifiant : minuscules, chiffres et tirets (pas « claude »)"
            )
        return value

    @field_validator("type")
    @classmethod
    def valid_type(cls, value: str) -> str:
        if value not in PROVIDER_TYPES:
            raise ValueError(f"type inconnu : {value}")
        return value

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not re.match(r"^https?://[^\s/]+", value):
            raise ValueError("adresse http(s) attendue")
        return value


class Rag(BaseModel):
    # existing : service compatible (POST /query, POST/DELETE /documents) ; none : pas
    # de RAG ; integrated : RAG livré avec antares (profil compose rag-integre), dont les
    # adresses et le jeton sont fixés par le déploiement (cf. resolved)
    mode: str = "existing"
    url: str = ""
    qdrant_url: str = ""
    write_token: str = ""

    @field_validator("mode")
    @classmethod
    def valid_mode(cls, value: str) -> str:
        if value not in ("existing", "none", "integrated"):
            raise ValueError(f"mode RAG inconnu : {value}")
        return value


class Search(BaseModel):
    enabled: bool = True
    url: str = ""


class Claude(BaseModel):
    enabled: bool = True
    url: str = ""
    token: str = ""
    models: list[str] = ["opus", "sonnet"]


class McpServer(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=60)
    url: str = Field(min_length=8, max_length=300)
    # http : « streamable HTTP » (spécification actuelle) ; sse : ancien transport
    transport: str = "http"
    token: str = Field(default="", max_length=400)
    enabled: bool = True

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not ID_RE.match(value):
            raise ValueError("identifiant : minuscules, chiffres et tirets")
        return value

    @field_validator("transport")
    @classmethod
    def valid_transport(cls, value: str) -> str:
        if value not in ("http", "sse"):
            raise ValueError("transport : http ou sse")
        return value

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        value = value.strip()
        if not re.match(r"^https?://[^\s/]+", value):
            raise ValueError("adresse http(s) attendue")
        return value


SECRETS = {"rag": "write_token", "claude": "token"}


def _services_defaults() -> dict:
    env = os.environ.get
    return {
        "rag": Rag(
            url=env("RAG_URL", "http://rag:8100"),
            qdrant_url=env("QDRANT_URL", "http://qdrant:6333"),
            write_token=env("RAG_WRITE_TOKEN", ""),
        ).model_dump(),
        "search": Search(url=env("SEARXNG_URL", "http://searxng:8080")).model_dump(),
        "claude": Claude(
            url=env("CLAUDE_BRIDGE_URL", "http://host.docker.internal:8088"),
            token=env("CLAUDE_BRIDGE_TOKEN", ""),
            models=[m for m in env("CLAUDE_MODELS", "opus,sonnet").split(",") if m],
        ).model_dump(),
        "mcp": [],
    }


def _defaults() -> dict:
    return {
        **_services_defaults(),
        "providers": [
            Provider(
                id="ollama",
                name="Ollama",
                type="ollama",
                url=os.environ.get("OLLAMA_URL", "http://ollama:11434"),
                local=True,
            ).model_dump()
        ],
    }


_cache: tuple[float, dict] = (-1.0, {})


def load() -> dict:
    """Configuration courante (relue si le fichier a changé) ; sections manquantes
    complétées depuis l'environnement (fichiers créés avant leur apparition)."""
    global _cache
    if not CONNECTIONS_PATH.exists():
        save(_defaults())
    mtime = CONNECTIONS_PATH.stat().st_mtime
    if mtime != _cache[0]:
        data = json.loads(CONNECTIONS_PATH.read_text(encoding="utf-8"))
        missing = {k: v for k, v in _services_defaults().items() if k not in data}
        if missing:
            data.update(missing)
            save(data)
            mtime = CONNECTIONS_PATH.stat().st_mtime
        _cache = (mtime, data)
    return json.loads(json.dumps(_cache[1]))


def save(data: dict) -> None:
    CONNECTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONNECTIONS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(CONNECTIONS_PATH)


def providers() -> list[Provider]:
    return [Provider(**p) for p in load()["providers"]]


def public(provider: Provider) -> dict:
    """Vue pour l'interface : jamais la clé, seulement si elle est définie."""
    data = provider.model_dump(exclude={"api_key"})
    data["has_key"] = bool(provider.api_key)
    data["no_reasoning"] = provider.cut_reasoning
    return data


def upsert(provider: Provider, keep_key: bool) -> Provider:
    data = load()
    existing = {p["id"]: p for p in data["providers"]}
    if keep_key and provider.id in existing and not provider.api_key:
        provider.api_key = existing[provider.id].get("api_key", "")
    existing[provider.id] = provider.model_dump()
    data["providers"] = list(existing.values())
    save(data)
    return provider


def remove(provider_id: str) -> None:
    data = load()
    kept = [p for p in data["providers"] if p["id"] != provider_id]
    if len(kept) == len(data["providers"]):
        raise KeyError(provider_id)
    data["providers"] = kept
    save(data)


# --- Services ----------------------------------------------------------------------------


def resolved(config: Rag) -> Rag:
    """Adresses effectives : en mode intégré, celles du déploiement ; les adresses saisies
    pour le RAG existant restent enregistrées pour y revenir."""
    if config.mode != "integrated":
        return config
    env = os.environ.get
    return config.model_copy(
        update={
            "url": env("RAG_INTEGRATED_URL", "http://antares-rag:8100"),
            "qdrant_url": env("QDRANT_INTEGRATED_URL", "http://antares-qdrant:6333"),
            "write_token": env("RAG_INTEGRATED_TOKEN", ""),
        }
    )


def rag() -> Rag:
    return resolved(Rag(**load()["rag"]))


def search() -> Search:
    return Search(**load()["search"])


def claude() -> Claude:
    return Claude(**load()["claude"])


def mcp_servers() -> list[McpServer]:
    return [McpServer(**m) for m in load()["mcp"]]


def public_services() -> dict:
    """Services pour l'interface : jetons remplacés par « défini ou non »."""
    data = load()
    out: dict = {}
    for name, secret in SECRETS.items():
        section = dict(data[name])
        section[f"has_{secret}"] = bool(section.pop(secret, ""))
        out[name] = section
    out["search"] = data["search"]
    out["mcp"] = [
        {
            **{k: v for k, v in m.items() if k != "token"},
            "has_token": bool(m.get("token")),
        }
        for m in data["mcp"]
    ]
    return out


def update_service(name: str, values: dict) -> None:
    """Remplace une section ; un jeton vide garde le jeton enregistré."""
    data = load()
    model: type[BaseModel] = {"rag": Rag, "search": Search, "claude": Claude}[name]
    secret = SECRETS.get(name)
    if secret and not values.get(secret):
        values[secret] = data[name].get(secret, "")
    data[name] = model(**values).model_dump()
    save(data)


def upsert_mcp(server: McpServer) -> None:
    data = load()
    existing = {m["id"]: m for m in data["mcp"]}
    if not server.token and server.id in existing:
        server.token = existing[server.id].get("token", "")
    existing[server.id] = server.model_dump()
    data["mcp"] = list(existing.values())
    save(data)


def remove_mcp(server_id: str) -> None:
    data = load()
    kept = [m for m in data["mcp"] if m["id"] != server_id]
    if len(kept) == len(data["mcp"]):
        raise KeyError(server_id)
    data["mcp"] = kept
    save(data)
