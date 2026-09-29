"""Agents « consignes » : fiches réutilisables qui spécialisent le LLM pour une tâche.

Une fiche porte un nom, un domaine et une utilité (pour les regrouper), des instructions
(rôle, méthode, format de réponse) et, en option, un projet RAG et un modèle. L'agent
s'applique à tout l'appel s'il est choisi dans les Réglages, ou à une seule question
s'il y est cité par son nom (« demande au relecteur ADR… »).

Un agent d'**action** (`kind="action"`) ne répond pas : il confie une tâche au worker
d'ai-to-boost, qui modifie les fichiers d'un dépôt sur une branche dédiée (cf.
actions.py). Ses instructions deviennent le cadre de la tâche.
"""

import json
import os
import re
import unicodedata
from pathlib import Path

from typing import Literal

from pydantic import BaseModel, Field

AGENTS_PATH = Path(os.environ.get("AGENTS_PATH", "/data/agents.json"))

# Listes proposées dans l'interface ; d'autres valeurs restent possibles
DOMAINS = [
    "Infra & DevOps",
    "Développement",
    "Sécurité",
    "Exploitation / SRE",
    "Données",
    "Gestion de projet",
    "Rédaction",
    "Perso",
]
USAGES = [
    "Diagnostic",
    "Rédaction",
    "Revue",
    "Synthèse",
    "Apprentissage",
    "Planification",
]


class AgentDraft(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    domain: str = Field(min_length=1, max_length=40)
    usage: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=200)
    instructions: str = Field(min_length=10, max_length=4000)
    project: str = ""
    model: str = ""
    kind: Literal["consigne", "action"] = "consigne"
    # Agent d'action : projet du worker ai-to-boost (vide : projet actif de l'interface)
    repo: str = Field(default="", max_length=64)


class Agent(AgentDraft):
    id: str


# Catalogue de départ, créé au premier lancement (et ajoutable ensuite : cf. seed_catalogue)
CATALOGUE_PATH = Path(__file__).with_name("catalogue.json")


def catalogue() -> list[AgentDraft]:
    return [
        AgentDraft(**entry)
        for entry in json.loads(CATALOGUE_PATH.read_text(encoding="utf-8"))
    ]


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " " + re.sub(r"[^a-z0-9]+", " ", text).strip() + " "


def slug(name: str) -> str:
    return _normalize(name).strip().replace(" ", "-")


def load() -> list[Agent]:
    if not AGENTS_PATH.exists():
        save([Agent(id=slug(a.name), **a.model_dump()) for a in catalogue()])
    stored = json.loads(AGENTS_PATH.read_text(encoding="utf-8"))
    return [Agent(**agent) for agent in stored]


def save(agents: list[Agent]) -> None:
    AGENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = AGENTS_PATH.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(
            [a.model_dump() for a in sorted(agents, key=lambda a: a.name.lower())],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    tmp.replace(AGENTS_PATH)


def find(agent_id: str) -> Agent | None:
    return next((a for a in load() if a.id == agent_id), None)


def normalize(text: str) -> str:
    return _normalize(text)


def cited(question: str, kind: str = "consigne") -> Agent | None:
    """Agent nommé dans la question ; le nom le plus long l'emporte (« Relecteur ADR »)."""
    text = _normalize(question)
    matches = [a for a in load() if a.kind == kind and _normalize(a.name) in text]
    if not matches:
        return None
    return max(matches, key=lambda a: len(a.name))


def instructions(agent: Agent) -> str:
    return (
        f"Tu interviens comme l'agent « {agent.name} » ({agent.domain}, "
        f"{agent.usage.lower()}). Consignes de cet agent :\n{agent.instructions}"
    )


def seed_catalogue() -> list[str]:
    """Ajoute les agents du catalogue absents (par identifiant) ; renvoie leurs noms."""
    known = load()
    ids = {a.id for a in known}
    added = [
        Agent(id=slug(d.name), **d.model_dump())
        for d in catalogue()
        if slug(d.name) not in ids
    ]
    if added:
        save([*known, *added])
    return [a.name for a in added]
