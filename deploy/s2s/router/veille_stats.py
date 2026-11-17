"""Statistiques de la veille (fenêtre « Statistiques ») : ce que l'utilisateur aime lire
(votes de veille.db) et ce que choisit l'IA (résumés quotidiens `daily_stats` de
tasks.db, gardés un an), sur 7 jours, 30 jours ou un an.

- Taux d'accord : part des « j'aime » parmi les votes sur les articles mis à la une.
- Articles ratés : « j'aime » sur des articles que le modèle avait écartés (onglet « Tous
  les articles »).
- Votes antérieurs à `votes.placement` : placés d'après les passages encore en base,
  sinon comptés dans les goûts seulement.

Jours en heure de Paris (comme `runs.day`). Bases absentes : chiffres à zéro.
"""

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from veille_votes import VotesDB

PERIODS = (7, 30, 365)
# Mots des titres trop généraux pour dire un goût (en plus des mots vides de texts.py)
COMMON_WORDS = {
    "arrive",
    "avec",
    "devient",
    "fait",
    "font",
    "lance",
    "ouvre",
    "veut",
    "comment",
    "cette",
    "donne",
    "dont",
    "elle",
    "être",
    "etre",
    "faire",
    "leur",
    "leurs",
    "nouveau",
    "nouvelle",
    "nouvelles",
    "nouveaux",
    "peut",
    "plus",
    "pourquoi",
    "quand",
    "sans",
    "sont",
    "tous",
    "tout",
    "toute",
    "vous",
    "nous",
    "after",
    "about",
    "from",
    "have",
    "into",
    "just",
    "more",
    "most",
    "over",
    "says",
    "than",
    "that",
    "their",
    "this",
    "what",
    "when",
    "will",
    "with",
    "your",
}
TOP_SOURCES = 10
TOP_WORDS = 12
TZ = ZoneInfo("Europe/Paris")


def _ro(path: Path) -> sqlite3.Connection | None:
    if not path.exists():
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _rows(path: Path, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    conn = _ro(path)
    if conn is None:
        return []
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc) or "no such column" in str(exc):
            return []
        raise
    finally:
        conn.close()


def _json(raw: str | None) -> dict:
    try:
        value = json.loads(raw or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _local_day(raw: str) -> str | None:
    try:
        return datetime.fromisoformat(raw).astimezone(TZ).date().isoformat()
    except (TypeError, ValueError):
        return None


def _placements(tasks_db: Path) -> dict[str, str]:
    """{identifiant d'article: featured|other} d'après les passages encore en base."""
    found: dict[str, str] = {}
    for row in _rows(tasks_db, "SELECT items_json, others_json FROM runs"):
        for column, place in (("others_json", "other"), ("items_json", "featured")):
            try:
                values = json.loads(row[column] or "[]")
            except ValueError:
                continue
            for item in values if isinstance(values, list) else []:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    found[item["id"]] = place
    return found


def _pct(part: int, total: int) -> float | None:
    return round(100 * part / total, 1) if total else None


def stats(
    tasks_db: Path,
    votes: VotesDB,
    days: int,
    now: datetime,
    categories: list[dict],
) -> dict:
    today = now.astimezone(TZ).date()
    since = (today - timedelta(days=days - 1)).isoformat()
    labels = {c["slug"]: c["label"] for c in categories}

    # --- Votes ----------------------------------------------------------------------
    rows = _rows(
        votes.path,
        "SELECT kind, target_id, value, title, source, category, voted_at, placement "
        "FROM votes",
    ) or _rows(
        votes.path,
        "SELECT kind, target_id, value, title, source, category, voted_at, "
        "'' AS placement FROM votes",
    )
    known = None
    likes = dislikes = interested = not_interested = 0
    by_category: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_source: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    words: Counter[str] = Counter()
    timeline: dict[str, dict] = defaultdict(
        lambda: {"agree_likes": 0, "agree_dislikes": 0, "missed_likes": 0}
    )
    import texts  # code d'antares-tasks (TASKS_CODE dans sys.path) : mots des titres

    for row in rows:
        day = _local_day(row["voted_at"])
        if day is None or day < since:
            continue
        liked = row["value"] > 0
        if row["kind"] == "idea":
            interested += liked
            not_interested += not liked
            continue
        likes += liked
        dislikes += not liked
        by_category[row["category"] or ""][0 if liked else 1] += 1
        if row["source"]:
            by_source[row["source"]][0 if liked else 1] += 1
        if liked:
            words.update(
                w
                for w in texts.title_words(row["title"])
                if len(w) >= 4 and w not in COMMON_WORDS
            )
        placement = row["placement"]
        if not placement:
            if known is None:
                known = _placements(tasks_db)
            placement = known.get(row["target_id"], "")
        if placement == "featured":
            timeline[day]["agree_likes" if liked else "agree_dislikes"] += 1
        elif placement == "other" and liked:
            timeline[day]["missed_likes"] += 1

    # --- Choix de l'IA (résumés quotidiens) ------------------------------------------
    featured_cat: Counter[str] = Counter()
    featured_src: Counter[str] = Counter()
    collected_src: Counter[str] = Counter()
    collected_total = 0
    days_featured: dict[str, Counter[str]] = {}
    for row in _rows(
        tasks_db,
        "SELECT day, featured_json, collected_json FROM daily_stats WHERE day >= ? "
        "ORDER BY day",
        (since,),
    ):
        featured = _json(row["featured_json"])
        collected = _json(row["collected_json"])
        cats = Counter(
            {str(k): int(v) for k, v in (featured.get("categories") or {}).items()}
        )
        days_featured[row["day"]] = cats
        featured_cat.update(cats)
        featured_src.update(
            {str(k): int(v) for k, v in (featured.get("sources") or {}).items()}
        )
        collected_src.update(
            {str(k): int(v) for k, v in (collected.get("sources") or {}).items()}
        )
        collected_total += sum(
            int(v) for v in (collected.get("categories") or {}).values()
        )

    featured_total = sum(featured_cat.values())
    agree_likes = sum(d["agree_likes"] for d in timeline.values())
    agree_votes = agree_likes + sum(d["agree_dislikes"] for d in timeline.values())
    order = [c["slug"] for c in categories]

    def category_rows(counts: dict[str, int]) -> list[dict]:
        slugs = order + sorted(k for k in counts if k not in order)
        total = sum(counts.values())
        return [
            {
                "slug": slug,
                "label": labels.get(slug, slug or "Autre"),
                "count": counts.get(slug, 0),
                "share": _pct(counts.get(slug, 0), total),
            }
            for slug in slugs
            if counts.get(slug, 0)
        ]

    sources_liked = sorted(
        by_source.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0])
    )
    sources_featured = sorted(featured_src.items(), key=lambda kv: (-kv[1], kv[0]))[
        :TOP_SOURCES
    ]
    return {
        "days": days,
        "since": since,
        "until": today.isoformat(),
        "summary": {
            "likes": likes,
            "dislikes": dislikes,
            "agreement": _pct(agree_likes, agree_votes),
            "agreement_votes": agree_votes,
            "missed_likes": sum(d["missed_likes"] for d in timeline.values()),
            "featured": featured_total,
            "collected": collected_total,
            "ideas_interested": interested,
            "ideas_rejected": not_interested,
        },
        "tastes": {
            "categories": [
                {**c, "dislikes": by_category.get(c["slug"], [0, 0])[1]}
                for c in category_rows({k: v[0] for k, v in by_category.items()})
            ],
            "sources": [
                {
                    "name": name,
                    "likes": counts[0],
                    "dislikes": counts[1],
                    "like_rate": _pct(counts[0], counts[0] + counts[1]),
                }
                for name, counts in sources_liked[:TOP_SOURCES]
            ],
            "words": [
                {"word": word, "count": count}
                for word, count in words.most_common(TOP_WORDS)
            ],
        },
        "ai": {
            "categories": category_rows(dict(featured_cat)),
            "sources": [
                {
                    "name": name,
                    "featured": count,
                    "share": _pct(count, featured_total),
                    "collected": collected_src.get(name, 0),
                    "selection_rate": _pct(count, collected_src.get(name, 0)),
                }
                for name, count in sources_featured
            ],
        },
        "timeline": [
            {
                "day": day,
                "featured": dict(days_featured.get(day, Counter())),
                "agree_likes": timeline[day]["agree_likes"] if day in timeline else 0,
                "agree_dislikes": timeline[day]["agree_dislikes"]
                if day in timeline
                else 0,
                "missed_likes": timeline[day]["missed_likes"] if day in timeline else 0,
            }
            for day in sorted(set(days_featured) | set(timeline))
        ],
    }
