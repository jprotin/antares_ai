"""Sources de la veille ajoutées depuis l'interface (cf. veille_votes.py pour la base).

- Sources fournies : `feeds` de tasks.yaml (lecture seule ici) ; chacune peut être
  désactivée, par son nom.
- Sources personnelles : un flux RSS ou Atom (adresse du flux, ou d'une page qui en
  déclare un : `<link rel="alternate" type="application/rss+xml">`), ou un sujet (mots-clés)
  transformé en recherche Google News des dernières 24 h.
- Avant tout enregistrement, la source est lue avec le code de collecte du service
  antares-tasks (tasks/feeds.py, monté en lecture seule) : adresse https publique
  seulement, taille et durée bornées, redirections contrôlées.
"""

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urljoin

import httpx
import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

MAX_CUSTOM = 50
# Sources privilégiées (3 places garanties chacune parmi les candidats)
MAX_FAVORITES = 10
RECENT_HOURS = 48
PROBE_TIMEOUT_S = 10
PROBE_MAX_BYTES = 2_000_000
NAME_RE = re.compile(r"^[^\x00-\x1f<>]{1,60}$")
# Lien d'une page vers son flux (attributs dans n'importe quel ordre)
LINK_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
ATTR_RE = re.compile(r"""(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
FEED_TYPES = ("application/rss+xml", "application/atom+xml")
GOOGLE_NEWS = {
    "fr": "hl=fr&gl=FR&ceid=FR:fr",
    "en": "hl=en-US&gl=US&ceid=US:en",
}


class SourceError(ValueError):
    """Source illisible ou refusée : message court, montré tel quel dans l'interface."""


class SourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["feed", "search"]
    name: str = ""
    url: str = ""
    query: str = Field("", max_length=120)
    lang: Literal["fr", "en"] = "fr"
    category: str = ""
    filter_keywords: bool = False

    @field_validator("name", "url", "query")
    @classmethod
    def stripped(cls, value: str) -> str:
        return " ".join(value.split())


class SourceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    lang: Literal["fr", "en"] | None = None
    category: str | None = None
    filter_keywords: bool | None = None


def google_news_url(query: str, lang: str) -> str:
    return (
        "https://news.google.com/rss/search?q="
        + quote(f"{query} when:1d", safe="")
        + "&"
        + GOOGLE_NEWS[lang]
    )


def check_name(name: str) -> str:
    if not NAME_RE.match(name):
        raise SourceError("Nom attendu : 1 à 60 caractères, sans < ni >")
    return name


def check_category(category: str, slugs: list[str]) -> str:
    if category and category not in slugs:
        raise SourceError(f"Catégorie inconnue : {category}")
    return category


# --- Sources fournies (tasks.yaml) --------------------------------------------------------


def builtin(path: Path) -> list[dict]:
    """Flux de tasks.yaml (nom, adresse, langue, catégorie, filtre) ; [] si illisible."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError):
        return []
    feeds = raw.get("feeds") if isinstance(raw, dict) else None
    found: list[dict] = []
    for feed in feeds if isinstance(feeds, list) else []:
        if isinstance(feed, dict) and feed.get("name") and feed.get("url"):
            found.append(
                {
                    "name": str(feed["name"]),
                    "url": str(feed["url"]),
                    "lang": str(feed.get("lang") or "en"),
                    "category": str(feed.get("category") or ""),
                    "filter_keywords": bool(feed.get("filter_keywords", False)),
                }
            )
    return found


# --- Lecture d'essai ----------------------------------------------------------------------


def _feed_link(page: str, base: str) -> str | None:
    for tag in LINK_RE.findall(page[:200_000]):
        attrs = {m[0].lower(): m[1] or m[2] for m in ATTR_RE.findall(tag)}
        if (
            "alternate" in attrs.get("rel", "").lower().split()
            and attrs.get("type", "").lower() in FEED_TYPES
            and attrs.get("href")
        ):
            return urljoin(base, attrs["href"])
    return None


async def probe(
    url: str, lang: str, now: datetime, client: httpx.AsyncClient | None = None
) -> dict:
    """Lit la source comme le fera la veille ; {url du flux, articles, récents, 3 derniers
    titres}. Lève SourceError avec une raison courte."""
    import feeds  # code de collecte d'antares-tasks (TASKS_CODE dans sys.path)
    from settings import Feed

    if client is None:
        async with feeds.new_client() as own:
            return await probe(url, lang, now, own)

    async def read(address: str) -> bytes:
        try:
            await feeds.check_redirect(address)
        except Exception:  # adresse privée, http, nom sans point…
            raise SourceError(
                "Adresse refusée : https et site public seulement"
            ) from None
        feed = Feed(name="essai", url=address, lang=lang, user=True)
        try:
            return await feeds.fetch_feed(
                client, feed, PROBE_TIMEOUT_S, PROBE_MAX_BYTES
            )
        except feeds.FeedTooLarge:
            raise SourceError("Réponse trop volumineuse (plus de 2 Mo)") from None
        except Exception as exc:
            reason = str(exc).splitlines()[0][:160] if str(exc) else type(exc).__name__
            raise SourceError(f"Lecture impossible : {reason}") from None

    def parse(body: bytes, address: str) -> list:
        feed = Feed(name="essai", url=address, lang=lang, user=True)
        return feeds.parse_feed(body, feed, now, 200)

    body = await read(url)
    try:
        articles = parse(body, url)
    except Exception:
        link = _feed_link(body.decode("utf-8", "replace"), url)
        if link is None:
            raise SourceError(
                "Ni flux RSS ou Atom, ni page qui en déclare un à cette adresse"
            ) from None
        url = link
        try:
            articles = parse(await read(url), url)
        except SourceError:
            raise
        except Exception:
            raise SourceError("Le flux déclaré par la page est illisible") from None
    if not articles:
        raise SourceError("Flux lisible mais vide")
    oldest = now - timedelta(hours=RECENT_HOURS)
    ordered = sorted(articles, key=lambda a: a.published, reverse=True)
    return {
        "url": url,
        "articles": len(articles),
        "recent": sum(1 for a in articles if a.published >= oldest),
        "latest": [
            {
                "title": a.title,
                "published_at": a.published.astimezone(timezone.utc).isoformat(
                    timespec="seconds"
                ),
            }
            for a in ordered[:3]
        ],
    }


def address(body: SourceIn) -> str:
    """Adresse à lire : flux saisi, ou recherche Google News du sujet."""
    if body.kind == "search":
        if not body.query:
            raise SourceError("Sujet attendu : quelques mots-clés")
        return google_news_url(body.query, body.lang)
    if not re.match(r"^https?://", body.url, re.IGNORECASE):
        raise SourceError("Adresse attendue : https://…")
    return body.url


def default_name(body: SourceIn, probed_url: str) -> str:
    if body.name:
        return body.name
    if body.kind == "search":
        return f"{body.query[:40]} (Google News)"
    host = re.sub(r"^www\.", "", probed_url.split("/")[2] if "//" in probed_url else "")
    return host[:60] or "Source"


def validation_message(exc: ValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else {}
    return f"{'.'.join(str(p) for p in first.get('loc', ()))} : {first.get('msg', '')}"
