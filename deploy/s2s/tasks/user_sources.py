"""Sources de l'interface : ajoutées, désactivées ou privilégiées dans la base du routeur
(VOTES_DB, tables `sources`, `disabled_sources` et `favorite_sources`, cf.
router/veille_sources.py), lues ici en lecture seule à chaque passage. Base absente,
illisible ou source invalide : ignorée et signalée dans le journal, la veille continue
avec les flux de tasks.yaml.
"""

import logging
import sqlite3
from pathlib import Path

from pydantic import ValidationError

from settings import Config, Feed

logger = logging.getLogger("tasks.sources")


def _rows(path: Path, sql: str) -> list[sqlite3.Row]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def merged_feeds(config: Config, path: Path) -> list[Feed]:
    """Flux de tasks.yaml moins les désactivés, plus les sources ajoutées (marquées
    `user` : première adresse contrôlée) ; jamais d'exception."""
    if not path.exists():
        return list(config.feeds)
    try:
        disabled = {r["name"] for r in _rows(path, "SELECT name FROM disabled_sources")}
        rows = _rows(
            path,
            "SELECT name, url, lang, category, filter_keywords FROM sources ORDER BY id",
        )
    except sqlite3.Error as exc:
        if "no such table" not in str(exc):
            logger.warning("Sources de l'interface illisibles (%s) : ignorées", exc)
        return list(config.feeds)
    feeds = [f for f in config.feeds if f.name not in disabled]
    names = {f.name for f in config.feeds}
    slugs = set(config.category_slugs)
    for row in rows:
        try:
            feed = Feed(
                name=row["name"],
                url=row["url"],
                lang=row["lang"],
                category=row["category"] if row["category"] in slugs else "",
                filter_keywords=bool(row["filter_keywords"]),
                user=True,
            )
        except ValidationError:
            logger.warning("Source « %s » invalide : ignorée", row["name"])
            continue
        if feed.name not in names:
            names.add(feed.name)
            feeds.append(feed)
    if disabled or rows:
        logger.info(
            "Sources : %d flux (%d désactivés, %d ajoutés depuis l'interface)",
            len(feeds),
            len(disabled & {f.name for f in config.feeds}),
            len(rows),
        )
    return feeds


def favorites(path: Path) -> set[str]:
    """Noms des sources privilégiées (table `favorite_sources`) ; vide si la base ou la
    table manque, jamais d'exception."""
    if not path.exists():
        return set()
    try:
        return {r["name"] for r in _rows(path, "SELECT name FROM favorite_sources")}
    except sqlite3.Error as exc:
        if "no such table" not in str(exc):
            logger.warning("Sources privilégiées illisibles (%s) : ignorées", exc)
        return set()
