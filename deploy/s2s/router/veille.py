"""Lecture des veilles (base /tasks-data/tasks.db, volume tasks-data, écrite par le
service antares-tasks) et jointure avec les votes (veille_votes.py).

Connexion en lecture seule à chaque requête ; base absente = réponse vide, sans erreur.
Le mode WAL a besoin des fichiers -shm et -wal : le volume reste monté en écriture pour
le routeur, qui n'écrit pourtant jamais dans cette base.

Formes renvoyées (heures en ISO 8601 avec fuseau ; contrat : spec de la refonte, B4) :
- latest : {run, weather, categories[], last_success_at, missed[], days[]}
- day    : {weather, runs[], missed[], categories[]}
- run    : {id, schema, day, slot_at, started_at, finished_at, status, model,
            items[{id, title, url, source, lang, category, sentence, summary,
                   published_at, vote}],
            ideas[{id, title, benefit, effort, first_step, inspired_by, vote,
                   has_prompt}], errors[], manual}
- others : {day, items[{id, title, url, source, lang, category, summary, published_at,
            score, vote}]} : articles non retenus du jour (onglet « Tous les articles »)
- weather: {day, label, text, fetched_at, condition, current, today, hours[]}
- missed : {slot_at, status} (créneau manqué, ou interrompu sans passage)

Les passages anciens (schéma 1, sans identifiants) sont rendus avec des valeurs neutres :
`id: null`, `lang: ""`, `category: ""`, `vote: null`… `vote` et `has_prompt` viennent de
la base des votes, jamais de tasks.db.
"""

import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from veille_votes import VotesDB

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE = re.compile(r"^[0-9a-f]{16}$")
MAX_DAYS = 30
WEATHER_KEYS = {
    "clear",
    "partly-cloudy",
    "cloudy",
    "fog",
    "drizzle",
    "rain",
    "snow",
    "storm",
    "unknown",
}


def valid_date(value: str) -> bool:
    if not DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def valid_id(value: str) -> bool:
    return bool(ID_RE.match(value or ""))


def _connect(path: Path) -> sqlite3.Connection | None:
    if not path.exists():
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _json_list(raw: str | None) -> list:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    return value if isinstance(value, list) else []


def _str(value) -> str:
    return value if isinstance(value, str) else ""


def _int(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _id(value) -> str | None:
    return value if isinstance(value, str) and valid_id(value) else None


# --- Mise en forme ------------------------------------------------------------------------


def _item(raw: dict) -> dict:
    lang = _str(raw.get("lang"))
    return {
        "id": _id(raw.get("id")),
        "title": _str(raw.get("title")),
        "url": _str(raw.get("url")),
        "source": _str(raw.get("source")),
        "lang": lang if lang in ("fr", "en") else "",
        "category": _str(raw.get("category")),
        "sentence": _str(raw.get("sentence")),
        "summary": _str(raw.get("summary")),
        "published_at": raw.get("published_at")
        if isinstance(raw.get("published_at"), str)
        else None,
        "vote": None,
    }


def _idea(raw: dict) -> dict:
    effort = raw.get("effort")
    source = raw.get("inspired_by")
    inspired = None
    if isinstance(source, dict) and _id(source.get("id")) and source.get("title"):
        inspired = {
            "id": source["id"],
            "title": _str(source.get("title")),
            "url": _str(source.get("url")),
        }
    return {
        "id": _id(raw.get("id")),
        "title": _str(raw.get("title")),
        "benefit": _str(raw.get("benefit")),
        "effort": effort if effort in ("S", "M", "L") else "M",
        "first_step": _str(raw.get("first_step")),
        "inspired_by": inspired,
        "vote": None,
        "has_prompt": False,
    }


def _run(row: sqlite3.Row) -> dict:
    raw_items = [i for i in _json_list(row["items_json"]) if isinstance(i, dict)]
    raw_ideas = [i for i in _json_list(row["ideas_json"]) if isinstance(i, dict)]
    schema = 1 if any("id" not in i for i in [*raw_items, *raw_ideas]) else 2
    return {
        "id": row["id"],
        "schema": schema,
        "day": row["day"],
        "slot_at": row["slot_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "status": row["status"],
        "model": row["model"],
        "items": [_item(i) for i in raw_items if i.get("title")],
        "ideas": [_idea(i) for i in raw_ideas if i.get("title")],
        "errors": [e for e in _json_list(row["errors_json"]) if isinstance(e, str)],
        "manual": "request_id" in row.keys() and row["request_id"] is not None,
    }


def _condition(raw) -> dict | None:
    if not isinstance(raw, dict) or _int(raw.get("code")) is None:
        return None
    key = raw.get("key")
    return {
        "code": _int(raw.get("code")),
        "key": key if key in WEATHER_KEYS else "unknown",
        "label": _str(raw.get("label")),
        "is_day": raw.get("is_day") is not False,
    }


def _numbers(raw, keys: tuple[str, ...]) -> dict | None:
    if not isinstance(raw, dict):
        return None
    return {k: _int(raw.get(k)) for k in keys}


def _hours(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    hours = []
    for hour in raw:
        if not isinstance(hour, dict) or not isinstance(hour.get("at"), str):
            continue
        key = hour.get("key")
        hours.append(
            {
                "at": hour["at"],
                "temperature": _int(hour.get("temperature")),
                "code": _int(hour.get("code")),
                "key": key if key in WEATHER_KEYS else "unknown",
                "rain": _int(hour.get("rain")),
                "is_day": hour.get("is_day") is not False,
            }
        )
    return hours


def _weather(conn: sqlite3.Connection, day: str) -> dict | None:
    row = conn.execute(
        "SELECT day, data_json, fetched_at FROM weather WHERE day = ?", (day,)
    ).fetchone()
    if row is None:
        return None
    try:
        data = json.loads(row["data_json"])
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    return {
        "day": row["day"],
        "label": _str(data.get("label")),
        "text": _str(data.get("text")),
        "fetched_at": row["fetched_at"],
        "condition": _condition(data.get("condition")),
        "current": _numbers(data.get("current"), ("temperature", "wind")),
        "today": _numbers(data.get("today"), ("min", "max", "rain", "wind")),
        "hours": _hours(data.get("hours")),
    }


def _missed(rows: list[sqlite3.Row]) -> list[dict]:
    return [{"slot_at": r["slot_at"], "status": r["status"]} for r in rows]


MISSED_SQL = (
    "SELECT slot_at, status FROM slots WHERE status IN ('missed', 'failed') "
    "AND run_id IS NULL AND {where} ORDER BY slot_at"
)


def _safe(fn):
    """Base en cours de création (schéma absent) : réponse vide plutôt qu'une erreur 500."""

    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except sqlite3.OperationalError as exc:
            # Base en création, ou pas encore migrée par antares-tasks (colonne absente)
            if "no such table" in str(exc) or "no such column" in str(exc):
                return None
            raise

    return wrapper


# --- Votes --------------------------------------------------------------------------------


def with_votes(runs: list[dict], votes: VotesDB | None) -> None:
    """Ajoute `vote` (articles, idées) et `has_prompt` (idées) depuis la base des votes ;
    base absente ou illisible : valeurs neutres."""
    if votes is None:
        return
    items = [i for run in runs for i in run["items"] if i["id"]]
    ideas = [i for run in runs for i in run["ideas"] if i["id"]]
    try:
        item_votes = votes.votes("article", [i["id"] for i in items])
        idea_votes = votes.votes("idea", [i["id"] for i in ideas])
        prompts = votes.prompt_ids([i["id"] for i in ideas])
    except sqlite3.Error:
        return
    for item in items:
        item["vote"] = item_votes.get(item["id"])
    for idea in ideas:
        idea["vote"] = idea_votes.get(idea["id"])
        idea["has_prompt"] = idea["id"] in prompts


# --- Lectures -----------------------------------------------------------------------------


def empty_latest(categories: list[dict] | None = None) -> dict:
    return {
        "run": None,
        "weather": None,
        "categories": categories or [],
        "last_success_at": None,
        "missed": [],
        "days": [],
    }


@_safe
def _latest(conn: sqlite3.Connection, now: datetime) -> dict:
    row = conn.execute(
        "SELECT * FROM runs ORDER BY finished_at DESC, id DESC LIMIT 1"
    ).fetchone()
    run = _run(row) if row else None
    success = conn.execute(
        "SELECT finished_at FROM runs WHERE status = 'done' "
        "ORDER BY finished_at DESC LIMIT 1"
    ).fetchone()
    since = (
        (now - timedelta(hours=24))
        .astimezone(timezone.utc)
        .isoformat(timespec="seconds")
    )
    missed = conn.execute(MISSED_SQL.format(where="slot_at >= ?"), (since,)).fetchall()
    days = conn.execute(
        "SELECT day FROM runs UNION SELECT day FROM slots ORDER BY day DESC LIMIT ?",
        (MAX_DAYS,),
    ).fetchall()
    return {
        "run": run,
        "weather": _weather(conn, run["day"]) if run else None,
        "last_success_at": success["finished_at"] if success else None,
        "missed": _missed(missed),
        "days": [d["day"] for d in days],
    }


def latest(
    path: Path,
    now: datetime | None = None,
    votes: VotesDB | None = None,
    categories: list[dict] | None = None,
) -> dict:
    conn = _connect(path)
    if conn is None:
        return empty_latest(categories)
    try:
        found = _latest(conn, now or datetime.now(timezone.utc))
    finally:
        conn.close()
    if found is None:
        return empty_latest(categories)
    if found["run"]:
        with_votes([found["run"]], votes)
    return {
        "run": found["run"],
        "weather": found["weather"],
        "categories": categories or [],
        "last_success_at": found["last_success_at"],
        "missed": found["missed"],
        "days": found["days"],
    }


@_safe
def _day(conn: sqlite3.Connection, day: str) -> dict:
    runs = conn.execute(
        "SELECT * FROM runs WHERE day = ? ORDER BY finished_at, id", (day,)
    ).fetchall()
    missed = conn.execute(MISSED_SQL.format(where="day = ?"), (day,)).fetchall()
    return {
        "weather": _weather(conn, day),
        "runs": [_run(r) for r in runs],
        "missed": _missed(missed),
    }


def day(
    path: Path,
    value: str,
    votes: VotesDB | None = None,
    categories: list[dict] | None = None,
) -> dict:
    empty: dict = {"weather": None, "runs": [], "missed": []}
    conn = _connect(path)
    if conn is None:
        found = empty
    else:
        try:
            found = _day(conn, value) or empty
        finally:
            conn.close()
    with_votes(found["runs"], votes)
    return {**found, "categories": categories or []}


# --- Articles non retenus (onglet « Tous les articles ») -----------------------------------


def _other(raw: dict) -> dict:
    lang = _str(raw.get("lang"))
    score = raw.get("score")
    return {
        "id": raw["id"],
        "title": _str(raw.get("title")),
        "url": _str(raw.get("url")),
        "source": _str(raw.get("source")),
        "lang": lang if lang in ("fr", "en") else "",
        "category": _str(raw.get("category")),
        "summary": _str(raw.get("summary")),
        "published_at": raw.get("published_at")
        if isinstance(raw.get("published_at"), str)
        else None,
        "score": float(score)
        if isinstance(score, (int, float)) and not isinstance(score, bool)
        else 0.0,
        "vote": None,
    }


@_safe
def _others(conn: sqlite3.Connection, value: str) -> list[dict]:
    rows = conn.execute(
        "SELECT items_json, others_json FROM runs WHERE day = ? AND status = 'done' "
        "ORDER BY finished_at DESC, id DESC",
        (value,),
    ).fetchall()
    featured = {
        i.get("id")
        for row in rows
        for i in _json_list(row["items_json"])
        if isinstance(i, dict)
    }
    found: list[dict] = []
    known: set[str] = set()
    for row in rows:  # le passage le plus récent d'abord : sa version de l'article
        for raw in _json_list(row["others_json"]):
            if not isinstance(raw, dict) or not raw.get("title"):
                continue
            item_id = _id(raw.get("id"))
            if item_id is None or item_id in featured or item_id in known:
                continue
            known.add(item_id)
            found.append(_other(raw))
    return found


def others(path: Path, value: str, votes: VotesDB | None = None) -> dict:
    """{day, items[]} : articles non retenus des passages réussis du jour, sans ceux mis
    à la une ce jour-là ni doublon, avec le vote de chacun."""
    conn = _connect(path)
    items: list[dict] = []
    if conn is not None:
        try:
            items = _others(conn, value) or []
        finally:
            conn.close()
    if votes is not None and items:
        try:
            found = votes.votes("article", [i["id"] for i in items])
        except sqlite3.Error:
            found = {}
        for item in items:
            item["vote"] = found.get(item["id"])
    return {"day": value, "items": items}


# --- Recherche d'un article ou d'une idée -------------------------------------------------


@_safe
def _find(conn: sqlite3.Connection, column: str, target_id: str) -> dict | None:
    if column not in ("items_json", "ideas_json", "others_json"):
        raise ValueError(column)
    row = conn.execute(
        "SELECT r.id AS run_id, r.model AS model, j.value AS item "
        f"FROM runs r, json_each(r.{column}) j "
        f"WHERE json_valid(r.{column}) AND json_extract(j.value, '$.id') = ? "
        "ORDER BY r.id DESC LIMIT 1",
        (target_id,),
    ).fetchone()
    if row is None:
        return None
    try:
        item = json.loads(row["item"])
    except ValueError:
        return None
    if not isinstance(item, dict):
        return None
    return {
        "run_id": row["run_id"],
        "model": row["model"] or "",
        "item": item,
        "placement": "other" if column == "others_json" else "featured",
    }


def find(path: Path, kind: str, target_id: str) -> dict | None:
    """{run_id, model, item} : dernier passage qui contient l'article (`kind` article) ou
    l'idée (`idea`) ; None si absent ou base absente."""
    if not valid_id(target_id):
        return None
    conn = _connect(path)
    if conn is None:
        return None
    # Article : à la une d'abord, puis parmi les non retenus (« Tous les articles »)
    columns = ("items_json", "others_json") if kind == "article" else ("ideas_json",)
    try:
        for column in columns:
            found = _find(conn, column, target_id)
            if found:
                return found
        return None
    finally:
        conn.close()


def vote_fields(kind: str, found: dict) -> dict:
    """Champs copiés dans la base des votes (depuis tasks.db, jamais depuis la requête)."""
    item = found["item"]
    if kind == "article":
        return {
            "title": _str(item.get("title")),
            "source": _str(item.get("source")),
            "category": _str(item.get("category")),
            "lang": _str(item.get("lang")),
            "url": _str(item.get("url")),
            "run_id": found["run_id"],
            # À la une ou non retenu : taux d'accord et articles ratés (statistiques)
            "placement": found.get("placement", ""),
        }
    return {
        "title": _str(item.get("title")),
        "detail": _str(item.get("benefit")),
        "run_id": found["run_id"],
    }
