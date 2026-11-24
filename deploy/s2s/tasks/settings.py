"""Réglages du service antares-tasks : tasks.yaml lu par yaml.safe_load, contrôlé par pydantic.

Variables d'environnement (toutes avec une valeur par défaut, posées par compose.yaml) :

- TASKS_CONFIG  : fichier de réglages (défaut /app/tasks.yaml) ;
- TASKS_DB      : base SQLite des passages (défaut /tasks-data/tasks.db, volume propre) ;
- SETTINGS_PATH : réglages du routeur, pour le modèle actif (défaut /data/settings.json) ;
- FEATURES_PATH : fonctionnalités d'Antares insérées dans le prompt
                  (défaut /features/FEATURES.md, absent ou vide toléré) ;
- VOTES_DB      : votes de la veille, base du routeur lue en lecture seule
                  (défaut /data/veille.db, absente tolérée : scores neutres) ;
- ROUTER_URL    : routeur, pour détecter un appel en cours (défaut http://llm-router:11434) ;
- PRESIDENTIELLE_DIR : base de la présidentielle, en lecture seule, pour la liste des
                  pages suivies (surveillance.yaml ; défaut /presidentielle, absente
                  tolérée : surveillance sans objet).

Une erreur de réglage donne un message d'une ligne (ConfigError), sans trace Python.
"""

import os
import re
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

TASKS_CONFIG = Path(os.environ.get("TASKS_CONFIG", "/app/tasks.yaml"))
TASKS_DB = Path(os.environ.get("TASKS_DB", "/tasks-data/tasks.db"))
SETTINGS_PATH = Path(os.environ.get("SETTINGS_PATH", "/data/settings.json"))
FEATURES_PATH = Path(os.environ.get("FEATURES_PATH", "/features/FEATURES.md"))
VOTES_DB = Path(os.environ.get("VOTES_DB", "/data/veille.db"))
ROUTER_URL = os.environ.get("ROUTER_URL", "http://llm-router:11434").rstrip("/")
PRESIDENTIELLE_DIR = Path(os.environ.get("PRESIDENTIELLE_DIR", "/presidentielle"))

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
HTTP_URL = re.compile(r"^https?://[^\s/]+", re.IGNORECASE)
SLUG = re.compile(r"^[a-z0-9-]{1,30}$")


class ConfigError(Exception):
    """Réglage invalide : message lisible d'une ligne."""


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _check_hhmm(value: str) -> str:
    if not HHMM.match(value):
        raise ValueError(f"horaire HH:MM attendu, reçu « {value} »")
    return value


class Feed(Strict):
    name: str = Field(min_length=1, max_length=60)
    url: str
    # Langue d'origine des articles
    lang: Literal["fr", "en"] = "en"
    # Catégorie par défaut (slug de `categories`) ; "" : la dernière catégorie
    category: str = ""
    # Seuls les titres qui contiennent un mot-clé d'une catégorie sont gardés
    filter_keywords: bool = False
    # Source ajoutée depuis l'interface : la première adresse est contrôlée comme une
    # redirection (https, nom public), pas seulement les suivantes
    user: bool = False

    @field_validator("url")
    @classmethod
    def http_only(cls, value: str) -> str:
        value = value.strip()
        if not HTTP_URL.match(value):
            raise ValueError("adresse http(s) attendue")
        return value


class Category(Strict):
    slug: str
    label: str = Field(min_length=1, max_length=40)
    # Mots-clés de la pré-catégorie (mot entier, casse et accents ignorés)
    keywords: list[str] = []

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value: str) -> str:
        if not SLUG.match(value):
            raise ValueError(f"slug en minuscules, chiffres et tirets : « {value} »")
        return value


class Weather(Strict):
    label: str = Field(min_length=1, max_length=60)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    # Météo relevée à chaque passage (sinon au premier créneau du jour seulement)
    every_run: bool = True
    # Heures pleines montrées dans la frise, à partir de l'heure du passage
    hours: int = Field(12, ge=0, le=24)


class Digest(Strict):
    items_target: int = Field(30, ge=1, le=60)
    max_per_source: int = Field(4, ge=1, le=60)
    sentence_chars: int = Field(220, ge=60, le=600)
    ideas_requested: int = Field(8, ge=1, le=20)
    ideas_kept: int = Field(6, ge=0, le=20)
    # Résumé écarté s'il cite un nom absent de l'article ou n'en partage aucun mot
    check_summaries: bool = True


class LearningWeights(Strict):
    source: float = Field(1.0, ge=0, le=10)
    category: float = Field(1.0, ge=0, le=10)
    words: float = Field(0.8, ge=0, le=10)
    recency: float = Field(0.5, ge=0, le=10)


class Learning(Strict):
    window_days: int = Field(180, ge=1, le=3650)
    max_votes: int = Field(500, ge=0, le=10000)
    half_life_days: float = Field(30, gt=0, le=3650)
    prior: float = Field(2, gt=0, le=100)
    prior_words: float = Field(3, gt=0, le=100)
    examples: int = Field(10, ge=0, le=50)
    explore_ratio: float = Field(0.1, ge=0, le=1)
    explore_min_votes: int = Field(3, ge=0, le=100)
    weights: LearningWeights = LearningWeights()


class Ideas(Strict):
    # Part des mots d'une idée présents dans une ligne de FEATURES.md : déjà réalisée
    features_overlap: float = Field(0.6, gt=0, le=1)
    # Recouvrement des mots avec une idée « Pas intéressé » : écartée
    rejected_overlap: float = Field(0.5, gt=0, le=1)
    # Idées « Intéressé » et rejetées rappelées au modèle
    liked_examples: int = Field(10, ge=0, le=100)
    rejected_examples: int = Field(40, ge=0, le=200)


class IdeaPrompt(Strict):
    """Prompt d'une idée « Intéressé », fabriqué par le routeur (cf. veille_prompt.py)."""

    model: str = ""
    timeout_s: float = Field(120, gt=0, le=600)
    max_tokens: int = Field(1500, ge=100, le=8000)
    features_chars: int = Field(2500, ge=0, le=20000)
    max_chars: int = Field(6000, ge=500, le=20000)
    constraints: list[str] = []
    project_map: list[str] = []


class Limits(Strict):
    # Candidats envoyés au modèle, au total et par source
    candidates: int = Field(60, ge=1, le=200)
    candidates_per_source: int = Field(8, ge=1, le=200)
    # Places réservées à chaque catégorie (les votes classent à l'intérieur)
    candidates_per_category: int = Field(5, ge=0, le=200)
    # Places réservées à chaque source privilégiée (étoile dans l'interface)
    candidates_per_favorite: int = Field(3, ge=0, le=20)
    summary_chars: int = Field(200, ge=50, le=2000)
    # Extrait gardé pour la fiche d'un article dans l'interface (le prompt en prend
    # `summary_chars`)
    extract_chars: int = Field(600, ge=50, le=4000)
    # Articles non retenus enregistrés par passage (onglet « Tous les articles »)
    others_max: int = Field(600, ge=0, le=2000)
    past_ideas: int = Field(60, ge=0, le=600)
    features_chars: int = Field(4000, ge=0, le=20000)
    max_age_hours: int = Field(48, ge=1, le=24 * 30)
    feed_timeout_s: float = Field(10, gt=0, le=120)
    feed_max_bytes: int = Field(2_000_000, ge=1000, le=50_000_000)


class Call(Strict):
    idle_seconds: int = Field(120, ge=0)
    wait_step_s: int = Field(60, ge=1)
    max_wait_min: int = Field(15, ge=0)


class PresidentielleWatch(Strict):
    """Surveillance des pages des candidats (cf. watch.py) : un passage par jour."""

    enabled: bool = True
    # Heure locale du passage quotidien (rattrapé dans la journée si le service était
    # arrêté à cette heure)
    time: str = "07:30"
    timeout_s: float = Field(15, gt=0, le=120)
    max_bytes: int = Field(5_000_000, ge=1000, le=50_000_000)
    # Pause entre deux pages (politesse envers les sites)
    gap_s: float = Field(2, ge=0, le=60)

    @field_validator("time")
    @classmethod
    def valid_time(cls, value: str) -> str:
        return _check_hhmm(value)


class Config(Strict):
    timezone: str = "Europe/Paris"
    slots: list[str] = Field(min_length=1)
    late_tolerance_min: int = Field(15, ge=1, le=180)
    retention_days: int = Field(30, ge=1)
    weather: Weather
    model: str = ""
    max_tokens: int = Field(4000, ge=100, le=32000)
    idea_similarity: float = Field(0.8, gt=0, le=1)
    categories: list[Category] = Field(min_length=1)
    digest: Digest = Digest()
    learning: Learning = Learning()
    ideas: Ideas = Ideas()
    idea_prompt: IdeaPrompt = IdeaPrompt()
    limits: Limits = Limits()
    call: Call = Call()
    presidentielle_watch: PresidentielleWatch = PresidentielleWatch()
    feeds: list[Feed] = Field(min_length=1)

    @field_validator("timezone")
    @classmethod
    def known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"fuseau inconnu : {value}") from None
        return value

    @field_validator("slots")
    @classmethod
    def valid_slots(cls, value: list[str]) -> list[str]:
        for slot in value:
            _check_hhmm(slot)
        return sorted(set(value))

    @field_validator("model")
    @classmethod
    def no_claude(cls, value: str) -> str:
        return _no_claude(value)

    @model_validator(mode="after")
    def known_categories(self) -> "Config":
        slugs = [c.slug for c in self.categories]
        if len(set(slugs)) != len(slugs):
            raise ValueError("categories : slug en double")
        for feed in self.feeds:
            if feed.category and feed.category not in slugs:
                raise ValueError(
                    f"flux {feed.name} : catégorie inconnue « {feed.category} »"
                )
        _no_claude(self.idea_prompt.model)
        return self

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def category_slugs(self) -> list[str]:
        return [c.slug for c in self.categories]


def _no_claude(value: str) -> str:
    value = value.strip()
    if value.startswith("claude:"):
        raise ValueError(
            "les modèles Claude passent par le pont du routeur : choisir un modèle "
            "des Connexions, ou laisser vide (modèle actif des Réglages)"
        )
    return value


def _first_error(exc: ValidationError) -> str:
    error = exc.errors()[0]
    where = ".".join(str(part) for part in error["loc"]) or "racine"
    message = str(error["msg"]).removeprefix("Value error, ")
    more = f" (+{exc.error_count() - 1} autre(s))" if exc.error_count() > 1 else ""
    return f"{where} : {message}{more}"


def load_config(path: Path | None = None) -> Config:
    path = path or TASKS_CONFIG
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError(f"{path} illisible : {exc.strerror or exc}") from None
    except yaml.YAMLError as exc:
        line = getattr(getattr(exc, "problem_mark", None), "line", None)
        where = f" (ligne {line + 1})" if line is not None else ""
        raise ConfigError(f"{path} : YAML invalide{where}") from None
    if not isinstance(raw, dict):
        raise ConfigError(f"{path} : dictionnaire de réglages attendu")
    try:
        config = Config.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(f"{path} : {_first_error(exc)}") from None
    return config
