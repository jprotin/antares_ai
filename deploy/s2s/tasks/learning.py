"""Apprentissage par les votes : score déterministe des candidats avant le modèle, exemples
de goûts pour le prompt, idées aimées et rejetées (cf. spec, section C).

Les votes appartiennent au routeur (base VOTES_DB, journal DELETE) ; le service les lit
en lecture seule (`mode=ro`, volume monté `:ro`). Base absente, illisible ou occupée :
la veille continue avec des scores neutres et le journal le signale.

Poids d'un vote i (valeur v ∈ {−1, +1}, âge d jours) : w = v × 0.5 ^ (d / demi-vie).
Poids d'un trait f (source, catégorie, mot du titre) :
W(f) = Σ w / (prior + Σ |w|), toujours dans ]−1, 1[, 0 si jamais voté.
Score : a_src·W(source) + a_cat·W(catégorie) + a_mots·moyenne(W(mots votés)) + a_rec·r,
avec r = clamp(1 − âge / âge maximal, 0, 1) ; borné à [−3, 3].
"""

import logging
import sqlite3
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from feeds import Article
from settings import Config, Learning
from texts import title_key, title_words

logger = logging.getLogger("tasks.learning")

SCORE_BOUND = 3.0
# Votes d'idées lus au plus (exemples aimés, idées rejetées à éviter)
MAX_IDEA_VOTES = 1000


@dataclass
class Vote:
    kind: str
    value: int
    title: str
    voted_at: datetime
    source: str = ""
    category: str = ""
    detail: str = ""


@dataclass
class Votes:
    articles: list[Vote] = field(default_factory=list)
    ideas: list[Vote] = field(default_factory=list)
    # Signalé dans le journal (base absente ou illisible)
    warning: str | None = None


def _parse_time(raw: str) -> datetime | None:
    try:
        moment = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def read_votes(path: Path, now: datetime, cfg: Learning) -> Votes:
    """Votes récents (fenêtre et nombre bornés), les plus récents d'abord ; jamais
    d'exception."""
    if not path.exists():
        return Votes(warning=f"Aucune base de votes ({path}) : scores neutres")
    since = (now - timedelta(days=cfg.window_days)).astimezone(timezone.utc)
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA busy_timeout=5000")
            sql = (
                "SELECT kind, value, title, source, category, detail, voted_at "
                "FROM votes WHERE kind = ? AND voted_at >= ? "
                "ORDER BY voted_at DESC LIMIT ?"
            )
            start = since.isoformat(timespec="seconds")
            rows = conn.execute(sql, ("article", start, cfg.max_votes)).fetchall()
            rows += conn.execute(sql, ("idea", start, MAX_IDEA_VOTES)).fetchall()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return Votes(warning=f"Base de votes illisible ({exc}) : scores neutres")
    votes = Votes()
    for row in rows:
        moment = _parse_time(row["voted_at"])
        if moment is None or row["value"] not in (-1, 1):
            continue
        vote = Vote(
            kind=row["kind"],
            value=int(row["value"]),
            title=row["title"] or "",
            voted_at=moment,
            source=row["source"] or "",
            category=row["category"] or "",
            detail=row["detail"] or "",
        )
        (votes.articles if vote.kind == "article" else votes.ideas).append(vote)
    return votes


# --- Poids --------------------------------------------------------------------------------


def vote_weight(
    value: int, voted_at: datetime, now: datetime, half_life: float
) -> float:
    age_days = max(0.0, (now - voted_at).total_seconds() / 86400)
    return value * 0.5 ** (age_days / half_life)


def trait_weight(weights: list[float], prior: float) -> float:
    if not weights:
        return 0.0
    return sum(weights) / (prior + sum(abs(w) for w in weights))


@dataclass
class Weights:
    source: dict[str, float] = field(default_factory=dict)
    category: dict[str, float] = field(default_factory=dict)
    words: dict[str, float] = field(default_factory=dict)
    # Nombre de votes par source (exploration)
    source_votes: dict[str, int] = field(default_factory=dict)


def compute_weights(votes: list[Vote], now: datetime, cfg: Learning) -> Weights:
    by_source: dict[str, list[float]] = defaultdict(list)
    by_category: dict[str, list[float]] = defaultdict(list)
    by_word: dict[str, list[float]] = defaultdict(list)
    for vote in votes:
        w = vote_weight(vote.value, vote.voted_at, now, cfg.half_life_days)
        if vote.source:
            by_source[vote.source].append(w)
        if vote.category:
            by_category[vote.category].append(w)
        for word in title_words(vote.title):
            by_word[word].append(w)
    return Weights(
        source={k: trait_weight(v, cfg.prior) for k, v in by_source.items()},
        category={k: trait_weight(v, cfg.prior) for k, v in by_category.items()},
        words={k: trait_weight(v, cfg.prior_words) for k, v in by_word.items()},
        source_votes={k: len(v) for k, v in by_source.items()},
    )


def score(article: Article, weights: Weights, config: Config, now: datetime) -> float:
    a = config.learning.weights
    age_hours = max(0.0, (now - article.published).total_seconds() / 3600)
    recency = min(1.0, max(0.0, 1 - age_hours / config.limits.max_age_hours))
    voted = [weights.words[w] for w in title_words(article.title) if w in weights.words]
    words = sum(voted) / len(voted) if voted else 0.0
    value = (
        a.source * weights.source.get(article.feed, 0.0)
        + a.category * weights.category.get(article.category, 0.0)
        + a.words * words
        + a.recency * recency
    )
    return max(-SCORE_BOUND, min(SCORE_BOUND, value))


# --- Sélection ----------------------------------------------------------------------------


def order_key(article: Article) -> tuple:
    """Score décroissant, date décroissante, identifiant : ordre total."""
    return (-article.score, -article.published.timestamp(), article.id)


def pick(
    articles: list[Article],
    weights: Weights,
    config: Config,
    now: datetime,
    favorites: Collection[str] = (),
) -> list[Article]:
    """Candidats envoyés au modèle, numérotés c1…cN dans l'ordre du score :
    au plus `candidates_per_source` par source, `candidates` au total, dont
    `explore_ratio` réservés aux sources peu votées (prises par date décroissante) et
    `candidates_per_favorite` aux meilleurs de chaque source privilégiée et
    `candidates_per_category` aux meilleurs de chaque catégorie ; le reste au score.
    Les candidats des sources privilégiées sont numérotés en premier."""
    limits, cfg = config.limits, config.learning
    for article in articles:
        article.score = score(article, weights, config, now)
    ranked = sorted(articles, key=order_key)
    per_source: dict[str, int] = defaultdict(int)
    capped: list[Article] = []
    for article in ranked:
        if per_source[article.feed] < limits.candidates_per_source:
            per_source[article.feed] += 1
            capped.append(article)
    explore_slots = min(limits.candidates, round(cfg.explore_ratio * limits.candidates))
    newcomers = sorted(
        (
            a
            for a in capped
            if weights.source_votes.get(a.feed, 0) < cfg.explore_min_votes
        ),
        key=lambda a: (-a.published.timestamp(), a.id),
    )
    explored = {a.id for a in newcomers[:explore_slots]}
    favored: set[str] = set()
    for name in favorites:
        from_source = [a for a in capped if a.feed == name and a.id not in explored]
        favored |= {a.id for a in from_source[: limits.candidates_per_favorite]}
    reserved: set[str] = set()
    for slug in config.category_slugs:
        in_category = [a for a in capped if a.category == slug and a.id not in explored]
        reserved |= {a.id for a in in_category[: limits.candidates_per_category]}
    priority = [a.id for a in capped if a.id in explored]
    priority += [a.id for a in capped if a.id in favored]
    priority += [a.id for a in capped if a.id in reserved - favored]
    chosen_ids = set(priority[: limits.candidates])
    for article in capped:
        if len(chosen_ids) >= limits.candidates:
            break
        chosen_ids.add(article.id)
    # Sources privilégiées en tête de la liste : le modèle les voit d'abord
    first = favored & chosen_ids
    picked = [a for a in capped if a.id in first]
    picked += [a for a in capped if a.id in chosen_ids - first]
    for index, article in enumerate(picked, start=1):
        article.ref = f"c{index}"
    return picked


# --- Exemples pour les prompts ------------------------------------------------------------


def examples(votes: list[Vote], value: int, count: int) -> list[Vote]:
    """Les `count` derniers votes de valeur `value` (déjà triés du plus récent)."""
    return [v for v in votes if v.value == value][:count]


def rejected_idea_keys(votes: Votes) -> list[tuple[str, str]]:
    """(titre, clé de titre) des idées « Pas intéressé »."""
    return [(v.title, title_key(v.title)) for v in votes.ideas if v.value == -1]
