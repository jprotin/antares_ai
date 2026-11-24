"""Passages de la veille et de la météo, boucle planifiée, rapport `schedule`.

Tout ce qui dépend du temps, du réseau ou du modèle est injecté par `Context` (horloge,
sommeil, client HTTP, appel au modèle, lecture du dernier tour) : les tests n'attendent
jamais et n'appellent ni Internet ni un vrai modèle.

- Une seule boucle d'événements par processus (`asyncio.run` dans __main__.py).
- Aucune exception ne fait tomber la boucle : passage et créneau notés `failed`.
- Un créneau est pris (ligne `running`) avant la collecte : un seul passage par créneau,
  même avec deux processus. Un lancement manuel ne prend pas de créneau.
- Créneaux passés de plus de `late_tolerance_min` sans ligne : `missed`, jamais rattrapés,
  dans la fenêtre [max(premier démarrage − tolérance, maintenant − 24 h), maintenant].
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

import calls
import digest
import feeds
import learning
import manual
import schedule
import user_sources
import watch
import weather
from settings import Config
from store import RunRecord, Store

logger = logging.getLogger("tasks")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Context:
    config: Config
    store: Store
    http: httpx.AsyncClient
    complete: digest.Complete
    resolve: Callable[[str], object]
    connections_path: Path
    connections_required: set[str]
    settings_path: Path
    features_path: Path
    read_last_turn: calls.ReadAt
    # Votes de la veille (base du routeur, lecture seule ; absente = scores neutres)
    votes_path: Path = Path("/nonexistent/veille.db")
    now: Callable[[], datetime] = utcnow
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    # Fichier touché à chaque tour de la boucle (sonde de santé du conteneur)
    heartbeat: Path | None = None
    # Base de la présidentielle (lecture seule) : surveillance des pages des candidats
    # (watch.py) ; None : surveillance sans objet
    presidentielle_dir: Path | None = None


@dataclass
class Result:
    record: RunRecord
    weather: dict | None = None
    prompt_chars: int = 0
    # Candidats envoyés au modèle (après le score des votes)
    articles: list[dict] = field(default_factory=list)


# --- Météo -------------------------------------------------------------------------------


async def run_meteo(ctx: Context, dry_run: bool) -> tuple[dict | None, str | None]:
    cfg = ctx.config
    now = ctx.now()
    data, error = await weather.fetch_weather(ctx.http, cfg.weather, cfg.timezone, now)
    if data and not dry_run:
        ctx.store.save_weather(schedule.local_day(now, cfg.tz), data, now)
    if data:
        logger.info("Météo : %s", data["text"])
    return data, error


# --- Veille ------------------------------------------------------------------------------


def others(articles: list[feeds.Article], kept: set[str], limit: int) -> list[dict]:
    """Articles non retenus (onglet « Tous les articles »), les mieux notés d'abord."""
    rest = sorted((a for a in articles if a.id not in kept), key=learning.order_key)[
        :limit
    ]
    return [
        {
            "id": a.id,
            "title": a.title,
            "url": a.url,
            "source": a.feed,
            "lang": a.lang,
            "category": a.category,
            "summary": a.summary,
            "published_at": a.published.isoformat(timespec="seconds"),
            "score": round(a.score, 3),
        }
        for a in rest
    ]


async def _digest(
    ctx: Context, articles: list[feeds.Article], record: RunRecord, result: Result
) -> None:
    """Score des votes, appel « articles » puis appel « idées » (un échec des idées
    laisse le passage réussi, avec une ligne d'erreur)."""
    cfg = ctx.config
    digest.check_connections(ctx.connections_path, ctx.connections_required)
    model = digest.choose_model(cfg.model, ctx.settings_path, ctx.resolve)
    record.model = model
    now = record.started_at
    votes = learning.read_votes(ctx.votes_path, now, cfg.learning)
    if votes.warning:
        logger.warning(votes.warning)
    weights = learning.compute_weights(votes.articles, now, cfg.learning)
    favorites = user_sources.favorites(ctx.votes_path)
    candidates = learning.pick(articles, weights, cfg, now, favorites)
    result.articles = [a.as_dict() for a in candidates]
    count = cfg.learning.examples
    messages = digest.build_articles_messages(
        candidates,
        cfg,
        learning.examples(votes.articles, 1, count),
        learning.examples(votes.articles, -1, count),
        sorted(favorites),
    )
    result.prompt_chars = sum(len(m["content"]) for m in messages)
    logger.info(
        "Modèle %s : %d candidats sur %d articles (%d votes), prompt de %d caractères",
        model,
        len(candidates),
        len(articles),
        len(votes.articles),
        result.prompt_chars,
    )
    text = await digest.ask_model(ctx.complete, model, messages, cfg.max_tokens)
    items = digest.select_items(digest.parse_articles(text), candidates, cfg, favorites)
    # Seuls les articles affichés deviennent « déjà vus » : un candidat non retenu peut
    # revenir au passage suivant tant qu'il a moins de `max_age_hours`
    record.shown_urls = [i["url"] for i in items] + [
        m for i in items if (m := feeds.title_marker(i["title"]))
    ]
    record.items = [{k: v for k, v in i.items() if k != "ref"} for i in items]
    record.others = others(articles, {i["id"] for i in items}, cfg.limits.others_max)
    if not items or cfg.digest.ideas_kept == 0:
        return
    try:
        record.ideas, record.idea_keys = await _ideas(ctx, model, items, votes, now)
    except digest.DigestError as exc:
        record.errors.append(str(exc))


async def _ideas(
    ctx: Context,
    model: str,
    items: list[dict],
    votes: learning.Votes,
    started_at: datetime,
) -> tuple[list[dict], list[str]]:
    cfg = ctx.config
    past = ctx.store.past_ideas(cfg.limits.past_ideas)
    features = digest.read_features(ctx.features_path)
    rejected = learning.rejected_idea_keys(votes)
    liked = [
        v.title for v in learning.examples(votes.ideas, 1, cfg.ideas.liked_examples)
    ]
    messages = digest.build_ideas_messages(
        items,
        features[: cfg.limits.features_chars],
        [p["title"] for p in past],
        liked,
        [title for title, _ in rejected[: cfg.ideas.rejected_examples]],
        cfg,
    )
    text = await digest.ask_model(
        ctx.complete, model, messages, cfg.max_tokens, prefix=digest.IDEAS
    )
    checks = digest.IdeaChecks(
        past_keys=ctx.store.idea_keys(),
        rejected=rejected,
        features=digest.feature_lines(features),
    )
    return digest.select_ideas(digest.parse_ideas(text), items, checks, cfg, started_at)


async def run_veille(
    ctx: Context,
    dry_run: bool = False,
    slot: datetime | None = None,
    with_weather: bool = False,
    request_id: int | None = None,
) -> Result:
    """Un passage complet ; enregistré (sauf essai à blanc), jamais d'exception sauf
    erreur d'enregistrement."""
    cfg = ctx.config
    started = ctx.now()
    day = schedule.local_day(slot or started, cfg.tz)
    record = RunRecord(
        day=day,
        started_at=started,
        finished_at=started,
        status="done",
        slot_at=slot,
        slot_key=schedule.slot_key(slot) if slot else None,
        request_id=request_id,
    )
    result = Result(record=record)
    try:
        if with_weather:
            data, error = await run_meteo(ctx, dry_run)
            if error:
                record.errors.append(error)
            result.weather = data
        if result.weather is None:
            result.weather = ctx.store.weather(day)
        sources = user_sources.merged_feeds(cfg, ctx.votes_path)
        articles, feed_errors, readable = await feeds.collect(
            ctx.http, cfg.model_copy(update={"feeds": sources}), started, ctx.store.seen
        )
        record.errors.extend(feed_errors)
        if readable == 0:
            raise digest.DigestError("aucun flux lisible")
        if articles:
            await _digest(ctx, articles, record, result)
        else:
            logger.info("Aucun article nouveau : rien de notable, modèle non appelé")
    except digest.DigestError as exc:
        record.status = "failed"
        record.errors.append(str(exc))
    except Exception as exc:  # jamais d'exception hors du passage
        logger.exception("Passage en échec")
        record.status = "failed"
        record.errors.append(
            f"Veille indisponible : erreur interne ({type(exc).__name__})"
        )
    if record.status == "failed":
        record.items, record.ideas, record.idea_keys, record.shown_urls = [], [], [], []
        record.others = []
    record.finished_at = ctx.now()
    if not dry_run:
        ctx.store.record_run(record)
        ctx.store.purge(record.finished_at, cfg.retention_days)
    logger.info(
        "Veille %s%s : %d articles, %d idées, %d erreur(s)",
        record.status,
        " (essai à blanc)" if dry_run else "",
        len(record.items),
        len(record.ideas),
        len(record.errors),
    )
    return result


# --- Planification -----------------------------------------------------------------------


async def run_slot(ctx: Context, slot: datetime) -> Result | None:
    """Prend le créneau, attend la fin d'un appel (borné), puis fait le passage."""
    cfg = ctx.config
    key = schedule.slot_key(slot)
    day = schedule.local_day(slot, cfg.tz)
    if not ctx.store.take_slot(key, schedule.TASK, day, slot, ctx.now()):
        return None
    logger.info("Créneau %s", key)
    try:
        await calls.wait_quiet(
            ctx.read_last_turn,
            lambda: ctx.now().timestamp(),
            ctx.sleep,
            cfg.call,
        )
        return await run_veille(ctx, slot=slot, with_weather=weather_due(cfg, slot))
    except Exception as exc:
        logger.exception("Créneau %s en échec", key)
        now = ctx.now()
        ctx.store.record_run(
            RunRecord(
                day=day,
                started_at=now,
                finished_at=now,
                status="failed",
                slot_at=slot,
                slot_key=key,
                errors=[f"Veille indisponible : erreur interne ({type(exc).__name__})"],
            )
        )
        return None


async def run_requested(ctx: Context) -> Result | None:
    """Passage manuel demandé depuis l'interface (cf. manual.py), météo comprise ;
    None s'il n'y a rien à faire."""
    request_id = manual.pending(ctx.votes_path, ctx.store.last_request_id(), ctx.now())
    if request_id is None or not ctx.store.take_request(request_id, ctx.now()):
        return None
    logger.info("Passage manuel demandé (n° %d)", request_id)
    return await run_veille(ctx, with_weather=True, request_id=request_id)


def weather_due(cfg: Config, slot: datetime) -> bool:
    """Météo relevée à chaque passage, ou seulement au premier créneau du jour."""
    return (
        cfg.weather.every_run
        or slot.astimezone(cfg.tz).strftime("%H:%M") == (cfg.slots[0])
    )


def window_start(ctx: Context, now: datetime) -> datetime:
    tolerance = timedelta(minutes=ctx.config.late_tolerance_min)
    first = ctx.store.first_start() or now
    return max(first - tolerance, now - timedelta(hours=24))


async def tick(ctx: Context) -> int:
    """Un tour : créneaux dus exécutés, dépassés notés manqués ; nombre de passages."""
    cfg = ctx.config
    now = ctx.now()
    tolerance = timedelta(minutes=cfg.late_tolerance_min)
    start = window_start(ctx, now)
    known = ctx.store.slot_keys_since(start - timedelta(minutes=1))
    done = 0
    for slot in schedule.slots_between(start, now, cfg.slots, cfg.tz):
        key = schedule.slot_key(slot)
        if key in known:
            continue
        if now - slot > tolerance:
            if ctx.store.mark_missed(
                key, schedule.TASK, schedule.local_day(slot, cfg.tz), slot, now
            ):
                logger.warning(
                    "Créneau %s manqué (service arrêté ?) : non rattrapé", key
                )
            continue
        if await run_slot(ctx, slot):
            done += 1
        now = ctx.now()
    return done


async def serve(ctx: Context, stop: Callable[[], bool] = lambda: False) -> None:
    """Boucle planifiée : sommeil par tranches de 10 s au plus (une mise en veille du
    poste fausse un long sommeil ; demandes de passage manuel), puis comparaison avec
    l'heure réelle."""
    cfg = ctx.config
    ctx.store.init(ctx.now())
    nxt = schedule.next_slot(ctx.now(), cfg.slots, cfg.tz)
    logger.info("Service démarré ; prochain créneau : %s", schedule.describe(nxt))
    while not stop():
        try:
            await tick(ctx)
        except Exception:  # la boucle ne s'arrête jamais sur une erreur
            logger.exception("Tour de planification en échec")
        try:
            await run_requested(ctx)
        except Exception:
            logger.exception("Passage manuel en échec")
        try:
            await watch.run_due(ctx)
        except Exception:
            logger.exception("Surveillance de la présidentielle en échec")
        if ctx.heartbeat:
            ctx.heartbeat.touch()
        now = ctx.now()
        nxt = schedule.next_slot(now, cfg.slots, cfg.tz)
        delay = (nxt - now).total_seconds()
        # Tranches courtes : une demande de passage manuel est vue en 10 s au plus
        await ctx.sleep(min(manual.REQUEST_POLL_S, max(1.0, delay)))


# --- Rapports ----------------------------------------------------------------------------


def schedule_report(ctx: Context, count: int = 3) -> str:
    cfg = ctx.config
    now = ctx.now()
    lines = [f"Fuseau : {cfg.timezone} ; créneaux : {', '.join(cfg.slots)}"]
    lines.append("Prochains passages :")
    for slot in schedule.next_slots(now, cfg.slots, cfg.tz, count):
        extra = " (météo puis veille)" if weather_due(cfg, slot) else ""
        lines.append(f"  - {schedule.describe(slot)}{extra}")
    last = ctx.store.last_success()
    lines.append(
        "Dernier passage réussi : "
        + (
            f"{last['finished_at']} (modèle {last['model'] or '—'})"
            if last
            else "aucun"
        )
    )
    missed = [
        s
        for s in ctx.store.slots_since(now - timedelta(hours=24))
        if s["task"] == schedule.TASK
        and s["status"] in ("missed", "failed")
        and s["run_id"] is None
    ]
    lines.append(
        "Créneaux manqués (24 h) : "
        + (", ".join(f"{s['slot_key']} ({s['status']})" for s in missed) or "aucun")
    )
    return "\n".join(lines)


def run_report(result: Result) -> str:
    record = result.record
    lines = [
        f"Passage : {record.status} — {record.finished_at.isoformat(timespec='seconds')}"
        f" — modèle {record.model or '—'} — prompt {result.prompt_chars} caractères",
        f"Articles proposés au modèle : {len(result.articles)}",
    ]
    weather_data = result.weather or {}
    condition = weather_data.get("condition") or {}
    lines.append(
        "Météo : "
        + (
            weather_data["text"]
            + (f" ({condition['label']})" if condition.get("label") else "")
            if weather_data
            else "non relevée"
        )
    )
    lines.append(
        f"Articles ({len(record.items)}) :"
        if record.items
        else "Articles : rien de notable"
    )
    for item in record.items:
        lines.append(
            f"  - [{item['category']}] [{item['source']}, {item['lang']}] "
            f"{item['title']}\n    {item['url']}"
        )
        lines.append(f"    {item['sentence']}")
    lines.append(f"Idées ({len(record.ideas)}) :" if record.ideas else "Idées : aucune")
    for idea in record.ideas:
        lines.append(f"  - {idea['title']} (effort {idea['effort']})")
        lines.append(f"    Bénéfice : {idea['benefit']}")
        lines.append(f"    Première étape : {idea['first_step']}")
        if idea.get("inspired_by"):
            lines.append(f"    Inspirée de : {idea['inspired_by']['title']}")
    if record.errors:
        lines.append("Erreurs :")
        lines.extend(f"  - {e}" for e in record.errors)
    return "\n".join(lines)
