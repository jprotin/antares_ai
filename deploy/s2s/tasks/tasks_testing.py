"""Aides des tests du service (pas de préfixe test_ : jamais lancé comme test).

Horloge avançable, transport HTTP simulé par adresse, appel au modèle factice qui note ses
arguments, base temporaire, contexte complet sans réseau ni vrai modèle.
"""

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

import feeds
import jobs
import weather
from settings import Config, load_config
from store import Store

# Pas d'attente entre deux flux d'un même site pendant les tests (cf. test dédié)
feeds.SAME_HOST_GAP_S = 0.0

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"
DEFAULT_CONFIG = HERE / "tasks.yaml"
CONNECTIONS = {
    "providers": [
        {
            "id": "ollama",
            "name": "Ollama",
            "type": "ollama",
            "url": "http://ollama:11434",
        }
    ],
    "rag": {},
    "search": {},
    "claude": {},
    "mcp": [],
}
REQUIRED = {"providers", "rag", "search", "claude", "mcp"}


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


class Clock:
    """Horloge simulée : `sleep` avance le temps sans attendre."""

    def __init__(self, start: datetime):
        self.current = start
        self.slept: list[float] = []

    def now(self) -> datetime:
        return self.current

    def advance(self, **delta: float) -> None:
        self.current += timedelta(**delta)

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.current += timedelta(seconds=seconds)


class Web:
    """Réponses HTTP par adresse (préfixe) ; adresse inconnue = erreur de connexion."""

    def __init__(self) -> None:
        self.routes: dict[str, object] = {}
        self.requests: list[str] = []

    def add(self, url_prefix: str, response) -> "Web":
        self.routes[url_prefix] = response
        return self

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        for prefix, response in self.routes.items():
            if url.startswith(prefix):
                if callable(response):
                    return response(request)
                if isinstance(response, Exception):
                    raise response
                return response  # type: ignore[return-value]
        raise httpx.ConnectError("injoignable", request=request)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))

    def hits(self, prefix: str) -> int:
        return sum(1 for url in self.requests if url.startswith(prefix))


def xml(name: str) -> httpx.Response:
    return httpx.Response(200, content=fixture(name))


class FakeModel:
    """Remplace providers.complete : réponses données à l'avance, appels notés."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.calls: list[dict] = []

    async def __call__(self, name: str, messages: list[dict], **kwargs) -> str:
        self.calls.append({"name": name, "messages": messages, **kwargs})
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, BaseException):
            raise answer
        if callable(answer):
            return answer(messages)
        return answer if isinstance(answer, str) else json.dumps(answer)


def refs_in(messages: list[dict]) -> list[str]:
    """Numéros des candidats du prompt « articles » (« c1 », « c2 »…)."""
    return [
        line.split("]")[0][1:]
        for line in messages[1]["content"].splitlines()
        if line.startswith("[c")
    ]


def is_ideas_call(messages: list[dict]) -> bool:
    return "## Actualités du jour" in messages[1]["content"]


IDEAS = [
    {
        "title": "Sous-titres exportables",
        "benefit": "Relire un appel",
        "effort": "S",
        "first_step": "Ajouter un bouton",
        "inspired_by": "c1",
    },
    {
        "title": "Mesure de latence par modèle",
        "benefit": "Choisir le modèle",
        "effort": "M",
        "first_step": "Journaliser le temps",
        "inspired_by": None,
    },
]


def answer_for(messages: list[dict], count: int = 6) -> str:
    """Réponse valide aux deux appels : articles (les premiers candidats du prompt) ou
    idées (deux idées, la première inspirée de c1)."""
    if is_ideas_call(messages):
        return json.dumps({"ideas": IDEAS})
    return json.dumps(
        {
            "items": [
                {"ref": ref, "category": "ia", "sentence": f"Nouveauté utile {ref}."}
                for ref in refs_in(messages)[:count]
            ]
        }
    )


def write_votes(path: Path, rows: list[dict]) -> None:
    """Base de votes du routeur (même schéma que router/veille_votes.py)."""
    import sqlite3

    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.executescript(VOTES_SCHEMA)
    for row in rows:
        values = {
            "kind": "article",
            "target_id": "0" * 16,
            "value": 1,
            "title": "",
            "source": "",
            "category": "",
            "lang": "",
            "url": "",
            "detail": "",
            "run_id": None,
            **row,
        }
        conn.execute(
            "INSERT OR REPLACE INTO votes VALUES (:kind, :target_id, :value, :title, "
            ":source, :category, :lang, :url, :detail, :run_id, :voted_at)",
            values,
        )
    conn.commit()
    conn.close()


VOTES_SCHEMA = """
CREATE TABLE IF NOT EXISTS votes (
    kind TEXT NOT NULL, target_id TEXT NOT NULL, value INTEGER NOT NULL,
    title TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '', run_id INTEGER, voted_at TEXT NOT NULL,
    PRIMARY KEY (kind, target_id)
);
"""


def resolve_ok(name: str) -> object:
    if name.startswith("absent/"):
        raise LookupError(name)
    return object()


def config(**overrides) -> Config:
    """Configuration réelle ; contrôle des résumés coupé (articles et résumés de test
    synthétiques, sans mot commun), réactivé par les tests qui le visent."""
    base = load_config(DEFAULT_CONFIG)
    base = base.model_copy(
        update={"digest": base.digest.model_copy(update={"check_summaries": False})}
    )
    return base.model_copy(update=overrides)


class Env:
    """Dossier temporaire avec base, settings.json, connections.json, FEATURES.md."""

    def __init__(
        self,
        settings: dict | None = None,
        connections: dict | None = CONNECTIONS,
        features: str = "# Antares\n- Appel vocal local\n",
    ) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.db = self.dir / "tasks.db"
        self.settings = self.dir / "settings.json"
        self.connections = self.dir / "connections.json"
        self.features = self.dir / "FEATURES.md"
        self.votes = self.dir / "veille.db"
        self.settings.write_text(
            json.dumps(
                settings
                if settings is not None
                else {"model": "ollama/gemma4:e4b", "fallback": ""}
            )
        )
        if connections is not None:
            self.connections.write_text(json.dumps(connections))
        self.features.write_text(features)

    def store(self, readonly: bool = False) -> Store:
        return Store(self.db, readonly=readonly)

    def context(
        self,
        web: Web,
        model: FakeModel,
        clock: Clock,
        cfg: Config | None = None,
        readonly: bool = False,
        last_turn=None,
    ) -> jobs.Context:
        async def no_call() -> float | None:
            return 0.0

        return jobs.Context(
            config=cfg or config(),
            store=self.store(readonly),
            http=web.client(),
            complete=model,
            resolve=resolve_ok,
            connections_path=self.connections,
            connections_required=REQUIRED,
            settings_path=self.settings,
            features_path=self.features,
            votes_path=self.votes,
            read_last_turn=last_turn or no_call,
            now=clock.now,
            sleep=clock.sleep,
        )


def all_feeds(web: Web, cfg: Config, name: str = "rss_openai.xml") -> Web:
    """Tous les flux de la configuration répondent par la même fixture, sauf Hacker News."""
    web.add(weather.API, httpx.Response(200, content=fixture("open_meteo.json")))
    for feed in cfg.feeds:
        web.add(feed.url, xml("rss_hn.xml" if feed.filter_keywords else name))
    return web
