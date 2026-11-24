"""Base SQLite du service (/tasks-data/tasks.db, volume tasks-data) : passages, météo
du jour, adresses vues, idées, créneaux. Le service est le seul à écrire ; le routeur la
lit en lecture seule (veille.py).

- Mode WAL, busy_timeout 5 s, clés étrangères ; version du schéma dans PRAGMA user_version.
- Un créneau est pris AVANT le passage (ligne `running`, clé primaire) : deux processus ne
  font jamais le même créneau. Le passage, ses adresses vues, ses idées et l'état final du
  créneau sont écrits en une seule transaction.
- Essai à blanc : connexion en lecture seule ; base absente = rien vu, aucune idée passée.
- Heures enregistrées en ISO 8601 UTC avec décalage ; `day` = jour local (AAAA-MM-JJ).
- Schéma 5 : pages des candidats suivies par la surveillance de la présidentielle
  (`watched_pages`, cf. watch.py) : dernière empreinte, dernière visite, dernier
  changement ; table créée au démarrage dans une base de schéma 4, données gardées. Le
  routeur la lit en lecture seule (GET /api/presidentielle/nouveautes).
- Schéma 4 : résumé chiffré de chaque jour (`daily_stats` : articles mis à la une et
  lus, par catégorie et par source), gardé `DAILY_STATS_DAYS` jours pour les
  statistiques de l'interface ; recalculé après chaque passage, rempli au démarrage pour
  les jours qui n'en ont pas.
- Schéma 3 : articles non retenus (`runs.others_json`) et passages manuels demandés
  depuis l'interface (`manual_runs`, `runs.request_id`, cf. manual.py) ; colonnes
  ajoutées à une base de schéma 2 au démarrage.
- Schéma 2 (sans nouvelle table) : articles et idées avec identifiant, langue, catégorie
  (`runs.items_json`, `runs.ideas_json`), météo enrichie remplacée à chaque passage ;
  `meta.schema_items = 2`. Les passages de schéma 1 restent lisibles par le routeur.
"""

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA_VERSION = 5
# Forme des articles et idées écrits par ce code (cf. router/veille.py)
SCHEMA_ITEMS = 2
SLOT_STATUSES = ("running", "done", "missed", "failed")

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_at TEXT,
    day TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('done', 'failed')),
    items_json TEXT NOT NULL DEFAULT '[]',
    ideas_json TEXT NOT NULL DEFAULT '[]',
    errors_json TEXT NOT NULL DEFAULT '[]',
    model TEXT NOT NULL DEFAULT '',
    others_json TEXT NOT NULL DEFAULT '[]',
    request_id INTEGER
);
CREATE INDEX IF NOT EXISTS runs_day ON runs (day);
CREATE INDEX IF NOT EXISTS runs_finished ON runs (finished_at);
CREATE TABLE IF NOT EXISTS weather (
    day TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seen_urls (
    url TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
    slot_key TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    day TEXT NOT NULL,
    slot_at TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('running', 'done', 'missed', 'failed')),
    run_id INTEGER REFERENCES runs (id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_runs (
    request_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    run_id INTEGER REFERENCES runs (id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS daily_stats (
    day TEXT PRIMARY KEY,
    runs INTEGER NOT NULL,
    featured_json TEXT NOT NULL,
    collected_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watched_pages (
    url TEXT PRIMARY KEY,
    candidat TEXT NOT NULL,
    sha256 TEXT,
    first_seen TEXT,
    checked_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error TEXT NOT NULL DEFAULT '',
    changed_at TEXT,
    changes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# Résumés quotidiens gardés au-delà des passages (statistiques sur un an)
DAILY_STATS_DAYS = 365

# Colonnes ajoutées à une base existante (schéma 2 → 3)
ADDED_COLUMNS = (
    ("others_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("request_id", "INTEGER"),
)


def iso(moment: datetime) -> str:
    """Heure UTC ISO 8601 à la seconde, avec décalage (+00:00)."""
    if moment.tzinfo is None:
        raise ValueError("heure sans fuseau")
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


@dataclass
class RunRecord:
    """Passage à enregistrer (statut final)."""

    day: str
    started_at: datetime
    finished_at: datetime
    status: str
    slot_at: datetime | None = None
    slot_key: str | None = None
    items: list[dict] = field(default_factory=list)
    ideas: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    model: str = ""
    # Adresses normalisées montrées au modèle (notées vues si le passage réussit)
    shown_urls: list[str] = field(default_factory=list)
    # Clés de titre des idées retenues
    idea_keys: list[str] = field(default_factory=list)
    # Articles non retenus (onglet « Tous les articles »), jamais notés vus
    others: list[dict] = field(default_factory=list)
    # Demande de passage manuel (bouton « Nouveau passage », cf. manual.py)
    request_id: int | None = None


def _counts(items: Iterable[dict]) -> dict:
    categories: dict[str, int] = {}
    sources: dict[str, int] = {}
    for item in items:
        category = str(item.get("category") or "")
        source = str(item.get("source") or "")
        categories[category] = categories.get(category, 0) + 1
        if source:
            sources[source] = sources.get(source, 0) + 1
    return {"categories": categories, "sources": sources}


def _update_daily(conn: sqlite3.Connection, day: str, now: datetime) -> None:
    """Résumé du jour depuis ses passages réussis : articles à la une, et articles lus
    (à la une ou non), chacun compté une fois."""
    rows = conn.execute(
        "SELECT items_json, others_json FROM runs WHERE day = ? AND status = 'done'",
        (day,),
    ).fetchall()
    featured: dict[str, dict] = {}
    collected: dict[str, dict] = {}
    for row in rows:
        for column, target in (("items_json", featured), ("others_json", collected)):
            try:
                values = json.loads(row[column] or "[]")
            except ValueError:
                continue
            for item in values if isinstance(values, list) else []:
                if isinstance(item, dict):
                    key = str(item.get("id") or item.get("url") or "")
                    if key:
                        target.setdefault(key, item)
    collected.update(featured)
    conn.execute(
        "INSERT OR REPLACE INTO daily_stats "
        "(day, runs, featured_json, collected_json, updated_at) VALUES (?, ?, ?, ?, ?)",
        (
            day,
            len(rows),
            json.dumps(_counts(featured.values()), ensure_ascii=False),
            json.dumps(_counts(collected.values()), ensure_ascii=False),
            iso(now),
        ),
    )


class Store:
    """Accès à la base ; une connexion courte par opération (plusieurs processus)."""

    def __init__(self, path: Path, readonly: bool = False):
        self.path = path
        self.readonly = readonly

    # --- Connexion --------------------------------------------------------------------

    def connect(self) -> sqlite3.Connection | None:
        """Connexion ouverte, ou None en lecture seule si la base n'existe pas."""
        if self.readonly:
            if not self.path.exists():
                return None
            try:
                conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
                conn.execute("SELECT 1 FROM sqlite_master LIMIT 1")
            except sqlite3.OperationalError:
                # Volume monté en lecture seule (fichier -shm impossible à créer)
                conn = sqlite3.connect(
                    f"file:{self.path}?mode=ro&immutable=1", uri=True
                )
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self.path)
            conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _write(self) -> sqlite3.Connection:
        if self.readonly:
            raise PermissionError("base ouverte en lecture seule (essai à blanc)")
        conn = self.connect()
        assert conn is not None
        return conn

    def init(self, now: datetime) -> None:
        """Schéma (idempotent), premier démarrage noté, créneaux `running` orphelins
        (arrêt brutal) passés en `failed` : jamais relancés."""
        conn = self._write()
        try:
            with conn:
                conn.executescript(SCHEMA)
                columns = {r["name"] for r in conn.execute("PRAGMA table_info(runs)")}
                for column, kind in ADDED_COLUMNS:
                    if column not in columns:
                        conn.execute(f"ALTER TABLE runs ADD COLUMN {column} {kind}")
                conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                conn.execute(
                    "INSERT OR IGNORE INTO meta (key, value) VALUES ('first_start', ?)",
                    (iso(now),),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_items', ?)",
                    (str(SCHEMA_ITEMS),),
                )
                conn.execute(
                    "UPDATE slots SET status = 'failed', updated_at = ? "
                    "WHERE status = 'running'",
                    (iso(now),),
                )
                conn.execute(
                    "UPDATE manual_runs SET status = 'failed', finished_at = ? "
                    "WHERE status = 'running'",
                    (iso(now),),
                )
                missing = conn.execute(
                    "SELECT DISTINCT day FROM runs WHERE day NOT IN "
                    "(SELECT day FROM daily_stats)"
                ).fetchall()
                for row in missing:
                    _update_daily(conn, row["day"], now)
        finally:
            conn.close()

    def _read(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        conn = self.connect()
        if conn is None:
            return []
        try:
            return conn.execute(sql, tuple(params)).fetchall()
        except sqlite3.OperationalError as exc:
            # Base créée mais schéma absent (lecture seule avant le premier démarrage)
            if "no such table" in str(exc):
                return []
            raise
        finally:
            conn.close()

    # --- Lecture ----------------------------------------------------------------------

    def first_start(self) -> datetime | None:
        rows = self._read("SELECT value FROM meta WHERE key = 'first_start'")
        return datetime.fromisoformat(rows[0]["value"]) if rows else None

    def seen(self, urls: Iterable[str]) -> set[str]:
        urls = list(urls)
        if not urls:
            return set()
        found: set[str] = set()
        for start in range(0, len(urls), 500):
            chunk = urls[start : start + 500]
            marks = ",".join("?" * len(chunk))
            rows = self._read(
                f"SELECT url FROM seen_urls WHERE url IN ({marks})", chunk
            )
            found.update(row["url"] for row in rows)
        return found

    def past_ideas(self, limit: int) -> list[dict]:
        rows = self._read(
            "SELECT title, title_key FROM ideas ORDER BY id DESC LIMIT ?", (limit,)
        )
        return [{"title": r["title"], "title_key": r["title_key"]} for r in rows]

    def idea_keys(self) -> list[str]:
        """Clés de titre de toutes les idées gardées (30 derniers jours)."""
        return [r["title_key"] for r in self._read("SELECT title_key FROM ideas")]

    def weather(self, day: str) -> dict | None:
        rows = self._read(
            "SELECT data_json, fetched_at FROM weather WHERE day = ?", (day,)
        )
        if not rows:
            return None
        return {**json.loads(rows[0]["data_json"]), "fetched_at": rows[0]["fetched_at"]}

    def slot_keys_since(self, start: datetime) -> dict[str, str]:
        rows = self._read(
            "SELECT slot_key, status FROM slots WHERE slot_at >= ?", (iso(start),)
        )
        return {r["slot_key"]: r["status"] for r in rows}

    def slots_since(self, start: datetime) -> list[dict]:
        rows = self._read(
            "SELECT slot_key, task, day, slot_at, status, run_id FROM slots "
            "WHERE slot_at >= ? ORDER BY slot_at",
            (iso(start),),
        )
        return [dict(r) for r in rows]

    def last_success(self) -> dict | None:
        rows = self._read(
            "SELECT id, slot_at, finished_at, model FROM runs WHERE status = 'done' "
            "ORDER BY finished_at DESC, id DESC LIMIT 1"
        )
        return dict(rows[0]) if rows else None

    def runs(self) -> list[dict]:
        rows = self._read("SELECT * FROM runs ORDER BY id")
        return [dict(r) for r in rows]

    def count(self, table: str) -> int:
        if table not in (
            "runs",
            "weather",
            "seen_urls",
            "ideas",
            "slots",
            "meta",
            "manual_runs",
            "daily_stats",
            "watched_pages",
        ):
            raise ValueError(table)
        rows = self._read(f"SELECT COUNT(*) AS n FROM {table}")
        return int(rows[0]["n"]) if rows else 0

    def daily_stats(self) -> dict[str, dict]:
        rows = self._read("SELECT * FROM daily_stats ORDER BY day")
        return {
            r["day"]: {
                "runs": r["runs"],
                "featured": json.loads(r["featured_json"]),
                "collected": json.loads(r["collected_json"]),
            }
            for r in rows
        }

    def last_request_id(self) -> int:
        """Plus grand numéro de demande manuelle déjà prise (0 si aucune) ; gardé dans
        `meta`, que la purge ne touche pas."""
        rows = self._read("SELECT value FROM meta WHERE key = 'last_request_id'")
        return int(rows[0]["value"]) if rows else 0

    def manual_run(self, request_id: int) -> dict | None:
        rows = self._read(
            "SELECT request_id, status, started_at, finished_at, run_id "
            "FROM manual_runs WHERE request_id = ?",
            (request_id,),
        )
        return dict(rows[0]) if rows else None

    def watched_pages(self) -> dict[str, dict]:
        """Pages suivies par la surveillance de la présidentielle, par adresse."""
        rows = self._read("SELECT * FROM watched_pages ORDER BY url")
        return {r["url"]: dict(r) for r in rows}

    # --- Écriture ---------------------------------------------------------------------

    def take_request(self, request_id: int, now: datetime) -> bool:
        """Prend une demande de passage manuel (ligne `running`) ; False si déjà prise."""
        conn = self._write()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO manual_runs (request_id, status, started_at) "
                    "VALUES (?, 'running', ?)",
                    (request_id, iso(now)),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta (key, value) "
                    "VALUES ('last_request_id', ?)",
                    (str(request_id),),
                )
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()

    def take_slot(
        self, slot_key: str, task: str, day: str, slot_at: datetime, now: datetime
    ) -> bool:
        """Prend le créneau (ligne `running`) ; False s'il existe déjà (fait, manqué,
        en échec ou pris par un autre processus)."""
        conn = self._write()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO slots (slot_key, task, day, slot_at, status, updated_at) "
                    "VALUES (?, ?, ?, ?, 'running', ?)",
                    (slot_key, task, day, iso(slot_at), iso(now)),
                )
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()

    def mark_missed(
        self, slot_key: str, task: str, day: str, slot_at: datetime, now: datetime
    ) -> bool:
        conn = self._write()
        try:
            with conn:
                cursor = conn.execute(
                    "INSERT OR IGNORE INTO slots "
                    "(slot_key, task, day, slot_at, status, updated_at) "
                    "VALUES (?, ?, ?, ?, 'missed', ?)",
                    (slot_key, task, day, iso(slot_at), iso(now)),
                )
            return cursor.rowcount == 1
        finally:
            conn.close()

    def finish_slot(self, slot_key: str, status: str, now: datetime) -> None:
        """État final d'un créneau pris sans passage de veille (surveillance)."""
        if status not in ("done", "failed"):
            raise ValueError(f"statut de créneau inconnu : {status}")
        conn = self._write()
        try:
            with conn:
                conn.execute(
                    "UPDATE slots SET status = ?, updated_at = ? WHERE slot_key = ?",
                    (status, iso(now), slot_key),
                )
        finally:
            conn.close()

    def record_watch(
        self,
        url: str,
        candidat: str,
        sha256: str | None,
        error: str,
        now: datetime,
    ) -> bool:
        """Visite d'une page suivie ; True si son empreinte a changé depuis la dernière
        visite réussie. Première visite réussie : empreinte notée, aucun changement.
        Échec (`sha256` None) : erreur notée, empreinte gardée, aucun changement."""
        conn = self._write()
        try:
            with conn:
                row = conn.execute(
                    "SELECT sha256 FROM watched_pages WHERE url = ?", (url,)
                ).fetchone()
                if row is None:
                    conn.execute(
                        "INSERT INTO watched_pages (url, candidat, sha256, first_seen, "
                        "checked_at, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            url,
                            candidat,
                            sha256,
                            iso(now) if sha256 else None,
                            iso(now),
                            "ok" if sha256 else "error",
                            "" if sha256 else error,
                        ),
                    )
                    return False
                if sha256 is None:
                    conn.execute(
                        "UPDATE watched_pages SET candidat = ?, checked_at = ?, "
                        "status = 'error', error = ? WHERE url = ?",
                        (candidat, iso(now), error, url),
                    )
                    return False
                known = row["sha256"]
                changed = known is not None and known != sha256
                conn.execute(
                    "UPDATE watched_pages SET candidat = ?, sha256 = ?, "
                    "first_seen = COALESCE(first_seen, ?), checked_at = ?, "
                    "status = 'ok', error = '', "
                    "changed_at = CASE WHEN ? THEN ? ELSE changed_at END, "
                    "changes = changes + ? WHERE url = ?",
                    (
                        candidat,
                        sha256,
                        iso(now),
                        iso(now),
                        changed,
                        iso(now),
                        int(changed),
                        url,
                    ),
                )
                return changed
        finally:
            conn.close()

    def forget_watched(self, keep: Iterable[str]) -> int:
        """Retire les pages qui ne sont plus suivies ; nombre de lignes retirées."""
        keep = set(keep)
        conn = self._write()
        try:
            with conn:
                urls = [r["url"] for r in conn.execute("SELECT url FROM watched_pages")]
                gone = [url for url in urls if url not in keep]
                conn.executemany(
                    "DELETE FROM watched_pages WHERE url = ?", [(u,) for u in gone]
                )
            return len(gone)
        finally:
            conn.close()

    def save_weather(self, day: str, data: dict, now: datetime) -> None:
        conn = self._write()
        try:
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO weather (day, data_json, fetched_at) "
                    "VALUES (?, ?, ?)",
                    (day, json.dumps(data, ensure_ascii=False), iso(now)),
                )
        finally:
            conn.close()

    def record_run(self, run: RunRecord) -> int:
        """Passage, adresses vues et idées (si réussi), état du créneau : tout ou rien."""
        if run.status not in ("done", "failed"):
            raise ValueError(f"statut de passage inconnu : {run.status}")
        conn = self._write()
        try:
            with conn:
                cursor = conn.execute(
                    "INSERT INTO runs (slot_at, day, started_at, finished_at, status, "
                    "items_json, ideas_json, errors_json, model, others_json, "
                    "request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        iso(run.slot_at) if run.slot_at else None,
                        run.day,
                        iso(run.started_at),
                        iso(run.finished_at),
                        run.status,
                        json.dumps(run.items, ensure_ascii=False),
                        json.dumps(run.ideas, ensure_ascii=False),
                        json.dumps(run.errors, ensure_ascii=False),
                        run.model,
                        json.dumps(run.others, ensure_ascii=False),
                        run.request_id,
                    ),
                )
                run_id = int(cursor.lastrowid or 0)
                if run.status == "done":
                    conn.executemany(
                        "INSERT OR IGNORE INTO seen_urls (url, first_seen) VALUES (?, ?)",
                        [(url, iso(run.finished_at)) for url in run.shown_urls],
                    )
                    conn.executemany(
                        "INSERT INTO ideas (run_id, title, title_key, created_at) "
                        "VALUES (?, ?, ?, ?)",
                        [
                            (run_id, idea["title"], key, iso(run.finished_at))
                            for idea, key in zip(run.ideas, run.idea_keys, strict=True)
                        ],
                    )
                _update_daily(conn, run.day, run.finished_at)
                if run.request_id is not None:
                    conn.execute(
                        "UPDATE manual_runs SET status = ?, finished_at = ?, run_id = ? "
                        "WHERE request_id = ?",
                        (run.status, iso(run.finished_at), run_id, run.request_id),
                    )
                if run.slot_key:
                    updated = conn.execute(
                        "UPDATE slots SET status = ?, run_id = ?, updated_at = ? "
                        "WHERE slot_key = ?",
                        (run.status, run_id, iso(run.finished_at), run.slot_key),
                    )
                    if updated.rowcount != 1:
                        raise sqlite3.IntegrityError(
                            f"créneau non pris : {run.slot_key}"
                        )
            return run_id
        finally:
            conn.close()

    def purge(self, now: datetime, retention_days: int) -> None:
        """Passages, météo, créneaux et idées de plus de `retention_days` ; jamais
        les adresses vues (arbitrage du 2026-11-16)."""
        limit = now - timedelta(days=retention_days)
        conn = self._write()
        try:
            with conn:
                conn.execute("DELETE FROM ideas WHERE created_at < ?", (iso(limit),))
                conn.execute("DELETE FROM slots WHERE slot_at < ?", (iso(limit),))
                conn.execute(
                    "DELETE FROM manual_runs WHERE started_at < ?", (iso(limit),)
                )
                conn.execute("DELETE FROM runs WHERE finished_at < ?", (iso(limit),))
                conn.execute(
                    "DELETE FROM weather WHERE day < ?",
                    (limit.date().isoformat(),),
                )
                conn.execute(
                    "DELETE FROM daily_stats WHERE day < ?",
                    ((now - timedelta(days=DAILY_STATS_DAYS)).date().isoformat(),),
                )
        finally:
            conn.close()
