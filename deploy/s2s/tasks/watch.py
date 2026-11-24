"""Surveillance quotidienne des pages des candidats à la présidentielle (tâche
`presidentielle-watch`).

Chaque jour, à l'heure de `presidentielle_watch.time`, la tâche lit chaque page de
`surveillance.yaml` (base de la présidentielle, montée en lecture seule) et compare son
empreinte à celle de la visite précédente (table `watched_pages` de tasks.db). Une page
modifiée devient un signalement « nouvelle source à relire », lu par le routeur
(GET /api/presidentielle/nouveautes, propriétaire seulement). Rien n'est publié : la
relecture et la saisie restent à faire avec presidentielle.sh.

Règles fixées (et figées par les tests) :
- aucun modèle n'est appelé (ni Connexions, ni providers) ;
- première visite d'une page : empreinte notée, pas de signalement ;
- erreur réseau, délai dépassé, réponse 4xx/5xx, page trop grande : erreur notée,
  empreinte gardée, pas de signalement ;
- chaque adresse, la première comprise, et chaque redirection passent par
  `feeds.check_redirect` (https, nom public, adresses IP publiques) ; taille et durée
  bornées comme pour les flux de la veille (`feeds.fetch_feed`) ;
- empreinte d'une page HTML : SHA-256 du texte visible (scripts, styles et balises
  retirés par html.parser, en temps linéaire, hors de la boucle d'événements ; espaces
  resserrés), pour limiter les faux signalements ; autre document (PDF…) : SHA-256
  des octets. Les sites en JavaScript peuvent échapper à la détection ;
- la tâche ne fait rien (aucune requête) si la liste n'est pas gelée
  (`surveillance geler`), sur le jeu de démonstration, ou après `archive_apres` de
  base.yaml (archive) ;
- les pages retirées de la liste sont oubliées de la table.
"""

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

import feeds
import presidentielle_schema as schema
import schedule
from settings import Feed

if TYPE_CHECKING:  # import circulaire à l'exécution (jobs importe watch)
    from jobs import Context

logger = logging.getLogger("tasks.watch")

TASK = "presidentielle-watch"
HTML_MARKERS = (b"<!doctype html", b"<html")
HIDDEN_TAGS = ("script", "style", "noscript", "template")
# Texte d'une page HTML analysé au plus (au-delà : ignoré pour l'empreinte)
HTML_MAX_BYTES = 2_000_000
ERROR_CHARS = 200


@dataclass
class WatchResult:
    # Motif d'un passage sans requête (liste non gelée, archive…) ; "" sinon
    skipped: str = ""
    checked: int = 0
    changed: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    forgotten: int = 0


@dataclass
class Plan:
    pages: list[schema.PageSuivie] = field(default_factory=list)
    skipped: str = ""


def plan(folder: Path, today: date) -> Plan:
    """Pages à visiter aujourd'hui, ou motif de l'arrêt (aucune requête)."""
    base_path = folder / "base.yaml"
    if not base_path.is_file():
        return Plan(skipped="base de la présidentielle absente")
    try:
        base = schema.charger(schema.Base, base_path, "base.yaml")
    except schema.ErreurFichier as exc:
        return Plan(skipped=f"base.yaml en défaut : {exc}")
    if today > base.archive_apres:
        return Plan(skipped="archive : surveillance arrêtée")
    if base.jeu == "demonstration":
        return Plan(skipped="jeu de démonstration : aucune requête")
    path = folder / "surveillance.yaml"
    if not path.is_file():
        return Plan(skipped="aucune page suivie (surveillance.yaml absent)")
    try:
        suivi = schema.charger(schema.Surveillance, path, "surveillance.yaml")
    except schema.ErreurFichier as exc:
        return Plan(skipped=f"surveillance.yaml en défaut : {exc}")
    if suivi.gelee_le is None:
        return Plan(skipped="liste des pages non gelée (surveillance geler)")
    if not suivi.pages:
        return Plan(skipped="aucune page suivie")
    return Plan(pages=list(suivi.pages))


class _VisibleText(HTMLParser):
    """Texte hors scripts et styles. Analyseur de la bibliothèque standard, en temps
    linéaire (pas d'expression régulière qu'une page piégée ferait exploser)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in HIDDEN_TAGS:
            self.hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in HIDDEN_TAGS and self.hidden:
            self.hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def fingerprint(body: bytes) -> str:
    """SHA-256 du texte visible d'une page HTML (espaces resserrés), ou des octets d'un
    autre document. Fonction lente sur une grande page : appelée hors de la boucle."""
    head = body[:1024].lstrip().lower()
    if any(marker in head for marker in HTML_MARKERS):
        parser = _VisibleText()
        try:
            parser.feed(body[:HTML_MAX_BYTES].decode("utf-8", errors="replace"))
            parser.close()
            text = " ".join(" ".join(parser.parts).split())
        except Exception:  # HTML irrécupérable : empreinte des octets
            return hashlib.sha256(body).hexdigest()
        return hashlib.sha256(text.encode("utf-8")).hexdigest()
    return hashlib.sha256(body).hexdigest()


def _reason(exc: BaseException) -> str:
    text = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
    return text[:ERROR_CHARS]


async def visit(ctx: "Context", page: schema.PageSuivie) -> tuple[str | None, str]:
    """(empreinte, "") ou (None, motif de l'échec). Jamais d'exception."""
    cfg = ctx.config.presidentielle_watch
    # Adresse saisie par l'utilisateur : contrôlée dès la première requête (user=True)
    feed = Feed(name=urlsplit(page.url).hostname or "page", url=page.url, user=True)
    try:
        body = await feeds.fetch_feed(ctx.http, feed, cfg.timeout_s, cfg.max_bytes)
    except Exception as exc:  # page en panne : notée, les autres continuent
        return None, _reason(exc)
    return await asyncio.to_thread(fingerprint, body), ""


async def run_watch(ctx: "Context", dry_run: bool = False) -> WatchResult:
    """Un passage de surveillance ; jamais d'exception sauf erreur d'enregistrement."""
    cfg = ctx.config
    now = ctx.now()
    today = now.astimezone(cfg.tz).date()
    if ctx.presidentielle_dir is None:
        todo = Plan(skipped="base de la présidentielle non montée")
    else:
        todo = plan(ctx.presidentielle_dir, today)
    if todo.skipped:
        logger.info("Surveillance : %s", todo.skipped)
        return WatchResult(skipped=todo.skipped)
    result = WatchResult()
    known = ctx.store.watched_pages()
    for index, page in enumerate(todo.pages):
        if index:
            await ctx.sleep(cfg.presidentielle_watch.gap_s)
        sha256, error = await visit(ctx, page)
        result.checked += 1
        # Sonde de santé : un passage long (pages lentes) ne fait pas passer le
        # conteneur pour bloqué
        if ctx.heartbeat:
            ctx.heartbeat.touch()
        if error:
            logger.warning("Page suivie %s indisponible : %s", page.url, error)
            result.errors.append(f"{page.url} : {error}")
        if dry_run:
            previous = (known.get(page.url) or {}).get("sha256")
            changed = bool(sha256 and previous and previous != sha256)
        else:
            changed = ctx.store.record_watch(
                page.url, page.candidat, sha256, error, ctx.now()
            )
        if changed:
            result.changed.append(page.url)
    if not dry_run:
        result.forgotten = ctx.store.forget_watched(p.url for p in todo.pages)
    logger.info(
        "Surveillance%s : %d page(s) visitée(s), %d modifiée(s), %d en erreur",
        " (essai à blanc)" if dry_run else "",
        result.checked,
        len(result.changed),
        len(result.errors),
    )
    return result


def due_slot(ctx: "Context", now: datetime) -> datetime | None:
    """Heure du passage du jour si elle est atteinte, None sinon ou si désactivée."""
    cfg = ctx.config.presidentielle_watch
    if not cfg.enabled or ctx.presidentielle_dir is None:
        return None
    day = now.astimezone(ctx.config.tz).date()
    slot = schedule.day_slots(day, [cfg.time], ctx.config.tz)[0]
    return slot if now >= slot else None


async def run_due(ctx: "Context") -> WatchResult | None:
    """Passage du jour s'il est dû et pas encore pris (un seul par jour, même avec deux
    processus : créneau `<heure>/presidentielle-watch` de la table `slots`)."""
    now = ctx.now()
    slot = due_slot(ctx, now)
    if slot is None:
        return None
    key = schedule.slot_key(slot, TASK)
    day = schedule.local_day(slot, ctx.config.tz)
    if not ctx.store.take_slot(key, TASK, day, slot, now):
        return None
    status = "failed"
    try:
        result = await run_watch(ctx)
        status = "done"
        return result
    finally:
        ctx.store.finish_slot(key, status, ctx.now())


def report(result: WatchResult) -> str:
    if result.skipped:
        return f"Surveillance : {result.skipped}"
    lines = [
        f"Surveillance : {result.checked} page(s) visitée(s), "
        f"{len(result.changed)} modifiée(s), {len(result.errors)} en erreur"
    ]
    lines.extend(f"  - nouvelle source à relire : {url}" for url in result.changed)
    lines.extend(f"  - erreur : {error}" for error in result.errors)
    return "\n".join(lines)
