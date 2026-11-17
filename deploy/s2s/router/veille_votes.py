"""Votes de la veille et prompts des idées : base /data/veille.db (volume router-data),
écrite par le routeur seul, lue en lecture seule par antares-tasks (apprentissage).

- Journal en mode DELETE (pas WAL) : un lecteur sur un volume monté en lecture seule ne
  peut pas créer le fichier -shm du WAL ; en mode DELETE il lit le fichier principal
  sous verrou partagé.
- Base créée au premier vote (schéma idempotent) ; une connexion courte par opération.
- Schéma 5 : traductions en français des articles (`translations`, cf.
  veille_translate.py), faites une fois à la demande.
- Schéma 4 : `votes.placement` (featured : article à la une, other : non retenu), pour
  les statistiques ; colonne ajoutée à une base existante.
- Schéma 3 : sources privilégiées (`favorite_sources`) et demandes de passage manuel
  (`run_requests`), lues par antares-tasks.
- Un vote par objet (clé kind + identifiant) ; « none » supprime la ligne. Les champs
  utiles à l'apprentissage (titre, source, catégorie…) sont copiés depuis tasks.db par
  l'appelant, jamais depuis le corps de la requête.
"""

import sqlite3
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 5
KINDS = ("article", "idea")
VALUES = {"like": 1, "dislike": -1}
NAMES = {1: "like", -1: "dislike"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS votes (
    kind      TEXT    NOT NULL CHECK (kind IN ('article', 'idea')),
    target_id TEXT    NOT NULL CHECK (length(target_id) = 16),
    value     INTEGER NOT NULL CHECK (value IN (-1, 1)),
    title     TEXT    NOT NULL,
    source    TEXT    NOT NULL DEFAULT '',
    category  TEXT    NOT NULL DEFAULT '',
    lang      TEXT    NOT NULL DEFAULT '',
    url       TEXT    NOT NULL DEFAULT '',
    detail    TEXT    NOT NULL DEFAULT '',
    run_id    INTEGER,
    voted_at  TEXT    NOT NULL,
    placement TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (kind, target_id)
);
CREATE INDEX IF NOT EXISTS votes_kind_time ON votes (kind, voted_at);
CREATE TABLE IF NOT EXISTS idea_prompts (
    idea_id    TEXT PRIMARY KEY CHECK (length(idea_id) = 16),
    prompt     TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
    id              INTEGER PRIMARY KEY,
    kind            TEXT    NOT NULL CHECK (kind IN ('feed', 'search')),
    name            TEXT    NOT NULL UNIQUE,
    url             TEXT    NOT NULL UNIQUE,
    query           TEXT    NOT NULL DEFAULT '',
    lang            TEXT    NOT NULL CHECK (lang IN ('fr', 'en')),
    category        TEXT    NOT NULL DEFAULT '',
    filter_keywords INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS disabled_sources (
    name        TEXT PRIMARY KEY,
    disabled_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorite_sources (
    name       TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS translations (
    article_id TEXT PRIMARY KEY CHECK (length(article_id) = 16),
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_at TEXT NOT NULL
);
"""
SOURCE_FIELDS = ("name", "lang", "category", "filter_keywords")


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


class VotesDB:
    def __init__(self, path: Path):
        self.path = path

    def _write(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA journal_mode=DELETE")
        with conn:
            conn.executescript(SCHEMA)
            columns = {r["name"] for r in conn.execute("PRAGMA table_info(votes)")}
            if "placement" not in columns:
                conn.execute(
                    "ALTER TABLE votes ADD COLUMN placement TEXT NOT NULL DEFAULT ''"
                )
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        return conn

    def _read(self) -> sqlite3.Connection | None:
        if not self.path.exists():
            return None
        conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _select(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        conn = self._read()
        if conn is None:
            return []
        try:
            return conn.execute(sql, tuple(params)).fetchall()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc):
                return []
            raise
        finally:
            conn.close()

    # --- Votes ------------------------------------------------------------------------

    def set_vote(
        self,
        kind: str,
        target_id: str,
        value: str,
        fields: dict,
        now: datetime,
    ) -> str | None:
        """Enregistre, remplace (`like`, `dislike`) ou retire (`none`) un vote ; heure
        du vote, ou None s'il est retiré."""
        conn = self._write()
        try:
            with conn:
                if value == "none":
                    conn.execute(
                        "DELETE FROM votes WHERE kind = ? AND target_id = ?",
                        (kind, target_id),
                    )
                    return None
                voted_at = iso(now)
                conn.execute(
                    "INSERT OR REPLACE INTO votes (kind, target_id, value, title, "
                    "source, category, lang, url, detail, run_id, voted_at, "
                    "placement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        kind,
                        target_id,
                        VALUES[value],
                        str(fields.get("title") or ""),
                        str(fields.get("source") or ""),
                        str(fields.get("category") or ""),
                        str(fields.get("lang") or ""),
                        str(fields.get("url") or ""),
                        str(fields.get("detail") or ""),
                        fields.get("run_id"),
                        voted_at,
                        str(fields.get("placement") or ""),
                    ),
                )
                return voted_at
        finally:
            conn.close()

    def vote(self, kind: str, target_id: str) -> str | None:
        rows = self._select(
            "SELECT value FROM votes WHERE kind = ? AND target_id = ?",
            (kind, target_id),
        )
        return NAMES.get(rows[0]["value"]) if rows else None

    def votes(self, kind: str, ids: Iterable[str]) -> dict[str, str]:
        """{identifiant: like|dislike} pour les identifiants donnés."""
        ids = [i for i in ids if i]
        found: dict[str, str] = {}
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            marks = ",".join("?" * len(chunk))
            rows = self._select(
                f"SELECT target_id, value FROM votes WHERE kind = ? "
                f"AND target_id IN ({marks})",
                (kind, *chunk),
            )
            found.update({r["target_id"]: NAMES[r["value"]] for r in rows})
        return found

    # --- Prompts des idées ------------------------------------------------------------

    def prompt(self, idea_id: str) -> dict | None:
        rows = self._select(
            "SELECT idea_id, prompt, model, created_at FROM idea_prompts "
            "WHERE idea_id = ?",
            (idea_id,),
        )
        return dict(rows[0]) if rows else None

    def prompt_ids(self, ids: Iterable[str]) -> set[str]:
        ids = [i for i in ids if i]
        found: set[str] = set()
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            marks = ",".join("?" * len(chunk))
            rows = self._select(
                f"SELECT idea_id FROM idea_prompts WHERE idea_id IN ({marks})", chunk
            )
            found.update(r["idea_id"] for r in rows)
        return found

    def save_prompt(self, idea_id: str, prompt: str, model: str, now: datetime) -> dict:
        conn = self._write()
        try:
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO idea_prompts "
                    "(idea_id, prompt, model, created_at) VALUES (?, ?, ?, ?)",
                    (idea_id, prompt, model, iso(now)),
                )
        finally:
            conn.close()
        return {
            "idea_id": idea_id,
            "prompt": prompt,
            "model": model,
            "created_at": iso(now),
        }

    # --- Sources de l'interface (cf. veille_sources.py) -------------------------------

    def sources(self) -> list[dict]:
        rows = self._select(
            "SELECT id, kind, name, url, query, lang, category, filter_keywords, "
            "created_at FROM sources ORDER BY id"
        )
        return [
            {**dict(r), "filter_keywords": bool(r["filter_keywords"])} for r in rows
        ]

    def add_source(self, source: dict, now: datetime) -> dict:
        """Ajoute une source ; sqlite3.IntegrityError si le nom ou l'adresse existe."""
        conn = self._write()
        try:
            with conn:
                cursor = conn.execute(
                    "INSERT INTO sources (kind, name, url, query, lang, category, "
                    "filter_keywords, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        source["kind"],
                        source["name"],
                        source["url"],
                        source.get("query", ""),
                        source["lang"],
                        source.get("category", ""),
                        int(bool(source.get("filter_keywords"))),
                        iso(now),
                    ),
                )
                new_id = cursor.lastrowid
        finally:
            conn.close()
        return next(s for s in self.sources() if s["id"] == new_id)

    def update_source(self, source_id: int, changes: dict) -> dict | None:
        changes = {k: v for k, v in changes.items() if k in SOURCE_FIELDS}
        conn = self._write()
        try:
            with conn:
                if changes:
                    sets = ", ".join(f"{k} = ?" for k in changes)
                    conn.execute(
                        f"UPDATE sources SET {sets} WHERE id = ?",
                        (*changes.values(), source_id),
                    )
        finally:
            conn.close()
        return next((s for s in self.sources() if s["id"] == source_id), None)

    def delete_source(self, source_id: int) -> bool:
        conn = self._write()
        try:
            with conn:
                return (
                    conn.execute(
                        "DELETE FROM sources WHERE id = ?", (source_id,)
                    ).rowcount
                    > 0
                )
        finally:
            conn.close()

    def disabled(self) -> set[str]:
        return {r["name"] for r in self._select("SELECT name FROM disabled_sources")}

    def set_enabled(self, name: str, enabled: bool, now: datetime) -> None:
        conn = self._write()
        try:
            with conn:
                if enabled:
                    conn.execute("DELETE FROM disabled_sources WHERE name = ?", (name,))
                else:
                    conn.execute(
                        "INSERT OR REPLACE INTO disabled_sources (name, disabled_at) "
                        "VALUES (?, ?)",
                        (name, iso(now)),
                    )
        finally:
            conn.close()

    # --- Sources privilégiées (étoile ; lues par antares-tasks, cf. learning.pick) -----

    def favorites(self) -> set[str]:
        return {r["name"] for r in self._select("SELECT name FROM favorite_sources")}

    def set_favorite(self, name: str, favorite: bool, now: datetime) -> None:
        conn = self._write()
        try:
            with conn:
                if favorite:
                    conn.execute(
                        "INSERT OR IGNORE INTO favorite_sources (name, created_at) "
                        "VALUES (?, ?)",
                        (name, iso(now)),
                    )
                else:
                    conn.execute("DELETE FROM favorite_sources WHERE name = ?", (name,))
        finally:
            conn.close()

    # --- Demandes de passage manuel (lues par antares-tasks, cf. tasks/manual.py) -----

    def add_run_request(self, now: datetime) -> dict:
        conn = self._write()
        try:
            with conn:
                cursor = conn.execute(
                    "INSERT INTO run_requests (requested_at) VALUES (?)", (iso(now),)
                )
                return {"id": int(cursor.lastrowid or 0), "requested_at": iso(now)}
        finally:
            conn.close()

    def last_run_request(self) -> dict | None:
        rows = self._select(
            "SELECT id, requested_at FROM run_requests ORDER BY id DESC LIMIT 1"
        )
        return dict(rows[0]) if rows else None

    # --- Traductions des articles (cf. veille_translate.py) ---------------------------

    def translation(self, article_id: str) -> dict | None:
        rows = self._select(
            "SELECT article_id, title, summary, model, created_at FROM translations "
            "WHERE article_id = ?",
            (article_id,),
        )
        return dict(rows[0]) if rows else None

    def save_translation(
        self, article_id: str, title: str, summary: str, model: str, now: datetime
    ) -> dict:
        conn = self._write()
        try:
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO translations "
                    "(article_id, title, summary, model, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (article_id, title, summary, model, iso(now)),
                )
        finally:
            conn.close()
        return {
            "article_id": article_id,
            "title": title,
            "summary": summary,
            "model": model,
            "created_at": iso(now),
        }
