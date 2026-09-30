"""Interconnexions d'antares : fournisseurs de modèles (et, à venir, RAG, recherche, MCP).

La configuration vit dans CONNECTIONS_PATH (volume du routeur, lisible par lui seul) ;
au premier lancement, elle est initialisée depuis les variables d'environnement de
compose.yaml, pour qu'une installation reste sans configuration.

Les clés d'API ne sortent jamais du routeur : l'interface ne reçoit qu'un indicateur
« clé définie ». Pour garder une clé en modifiant un fournisseur, on renvoie une clé
vide ; KEEP_KEY la conserve.
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


def _defaults() -> dict:
    return {
        "providers": [
            Provider(
                id="ollama",
                name="Ollama",
                type="ollama",
                url=os.environ.get("OLLAMA_URL", "http://ollama:11434"),
                local=True,
            ).model_dump()
        ]
    }


def load() -> dict:
    if not CONNECTIONS_PATH.exists():
        save(_defaults())
    return json.loads(CONNECTIONS_PATH.read_text(encoding="utf-8"))


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
