"""Collecte des articles : flux RSS 2.0 et Atom, lus en parallèle, chacun borné en durée et
en taille. Un flux en panne devient une ligne d'erreur courte ; les autres continuent.

Règles fixées (et figées par les tests) :
- adresse normalisée : schéma et hôte en minuscules, paramètres `utm_*` retirés (casse
  ignorée, ordre des autres conservé), fragment retiré, « / » final retiré (la racine
  `https://ex.com/` devient `https://ex.com`) ; seules http et https sont acceptées ;
- article sans date lisible : gardé, daté de la collecte ; date sans fuseau : UTC ;
- résumé : scripts et styles retirés avec leur contenu, balises retirées, entités décodées,
  espaces resserrés, tronqué (« … » compris) à `summary_chars` ;
- identifiant d'article : `sha256(adresse normalisée)[:16]` (16 caractères hexadécimaux),
  stable d'un passage à l'autre (votes) ; langue = celle du flux ;
- pré-catégorie : premier mot-clé de `categories` trouvé dans le titre (mot entier, casse
  et accents ignorés, dans l'ordre des catégories), sinon la catégorie du flux, sinon la
  dernière catégorie ;
- redirections suivies à la main (au plus `MAX_REDIRECTS`), seulement vers une adresse
  https dont le nom contient un point et dont toutes les adresses IP sont publiques : un
  flux piégé ne peut pas renvoyer le service vers le réseau interne (qdrant, ollama…).
"""

import asyncio
import hashlib
import html
import ipaddress
import logging
import re
import socket
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from defusedxml import ElementTree

from settings import Config, Feed
from texts import strip_accents, title_key, title_words

logger = logging.getLogger("tasks.feeds")

ATOM = "{http://www.w3.org/2005/Atom}"
USER_AGENT = "antares-veille"
SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]*>")
SPACE_RE = re.compile(r"\s+")
MAX_REDIRECTS = 3
# Flux d'un même site lus l'un après l'autre, espacés (Google News répond 429 à des
# recherches simultanées)
SAME_HOST_GAP_S = 2.0


@dataclass
class Article:
    feed: str
    title: str
    url: str
    summary: str
    published: datetime
    # Identifiant stable (sha256 de l'adresse normalisée), posé par `select`
    id: str = ""
    lang: str = "en"
    # Pré-catégorie (slug), posée par `select`
    category: str = ""
    # Numéro dans le prompt (« c7 »), posé après le score (learning.pick)
    ref: str = ""
    # Score des votes (learning.score)
    score: float = 0.0

    def as_dict(self) -> dict:
        return {
            "ref": self.ref,
            "id": self.id,
            "feed": self.feed,
            "lang": self.lang,
            "category": self.category,
            "score": round(self.score, 3),
            "title": self.title,
            "url": self.url,
            "summary": self.summary,
            "published": self.published.isoformat(timespec="seconds"),
        }


def article_id(normalized_url: str) -> str:
    return hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()[:16]


class FeedTooLarge(Exception):
    pass


class UnsafeRedirect(Exception):
    pass


# --- Adresses ----------------------------------------------------------------------------


def normalize_url(url: str | None) -> str | None:
    """Adresse normalisée, ou None si elle n'est pas http(s) absolue."""
    if not url:
        return None
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        return None
    query = parts.query
    pairs = parse_qsl(query, keep_blank_values=True)
    if any(key.lower().startswith("utm_") for key, _ in pairs):
        query = urlencode(
            [(k, v) for k, v in pairs if not k.lower().startswith("utm_")]
        )
    path = parts.path.rstrip("/")
    return urlunsplit((scheme, parts.netloc.lower(), path, query, ""))


# --- Texte -------------------------------------------------------------------------------


def clean_text(raw: str | None, limit: int | None = None) -> str:
    text = SCRIPT_RE.sub(" ", raw or "")
    text = TAG_RE.sub(" ", text)
    text = SPACE_RE.sub(" ", html.unescape(text)).strip()
    if limit is not None and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def parse_date(raw: str | None) -> datetime | None:
    if not raw or not raw.strip():
        return None
    raw = raw.strip()
    try:
        return _aware(datetime.fromisoformat(raw))
    except ValueError:
        pass
    try:
        return _aware(parsedate_to_datetime(raw))
    except (TypeError, ValueError, IndexError):
        return None


# --- Analyse -----------------------------------------------------------------------------


def _text(element, tag: str) -> str | None:
    child = element.find(tag)
    return child.text if child is not None and child.text else None


def _atom_link(entry) -> str | None:
    links = entry.findall(f"{ATOM}link")
    for link in links:
        if link.get("rel", "alternate") == "alternate" and link.get("href"):
            return link.get("href")
    return links[0].get("href") if links else None


def parse_feed(
    body: bytes, feed: Feed, now: datetime, summary_chars: int
) -> list[Article]:
    """Articles d'un flux RSS 2.0 ou Atom ; lève une exception si le XML est illisible
    ou dangereux (entités, DTD externes : refusés par defusedxml)."""
    root = ElementTree.fromstring(body)
    articles: list[Article] = []
    if root.tag == f"{ATOM}feed":
        for entry in root.findall(f"{ATOM}entry"):
            date = parse_date(_text(entry, f"{ATOM}published")) or parse_date(
                _text(entry, f"{ATOM}updated")
            )
            summary = _text(entry, f"{ATOM}summary") or _text(entry, f"{ATOM}content")
            articles.append(
                Article(
                    feed=feed.name,
                    title=clean_text(_text(entry, f"{ATOM}title"), 300),
                    url=_atom_link(entry) or "",
                    summary=clean_text(summary, summary_chars),
                    published=date or now,
                    lang=feed.lang,
                )
            )
        return articles
    channel = root.find("channel")
    if root.tag != "rss" or channel is None:
        raise ValueError(f"format de flux inconnu : {root.tag}")
    for item in channel.findall("item"):
        date = parse_date(_text(item, "pubDate"))
        title = clean_text(_text(item, "title"), 300)
        summary = clean_text(_text(item, "description"), summary_chars)
        # Agrégateur (Google News…) : élément <source> = éditeur ; « Titre - Éditeur »
        # raccourci, l'éditeur passe en tête de l'extrait
        publisher = clean_text(_text(item, "source"), 80)
        if publisher:
            title = title.removesuffix(f" - {publisher}")
            # Titre absent (« - Korben ») : article écarté par `select`
            if title in (publisher, f"- {publisher}"):
                title = ""
            summary = clean_text(f"{publisher} : {summary}", summary_chars)
        articles.append(
            Article(
                feed=feed.name,
                title=title,
                url=(_text(item, "link") or "").strip(),
                summary=summary,
                published=date or now,
                lang=feed.lang,
            )
        )
    return articles


# --- Lecture -----------------------------------------------------------------------------


async def resolve_host(host: str) -> list[str]:
    """Adresses IP d'un nom (remplacé dans les tests)."""
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, 443, type=socket.SOCK_STREAM
    )
    return [str(info[4][0]) for info in infos]


def _public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def check_redirect(url: str) -> None:
    """Refuse une redirection hors https, vers un nom sans point (service Docker) ou vers
    une adresse privée, de bouclage, locale au lien ou réservée."""
    parts = urlsplit(url)
    host = (parts.hostname or "").rstrip(".")
    if parts.scheme.lower() != "https" or not host:
        raise UnsafeRedirect(f"redirection refusée : {parts.scheme}://{host}")
    try:
        addresses = [str(ipaddress.ip_address(host))]
    except ValueError:
        if "." not in host:
            raise UnsafeRedirect(f"redirection refusée : nom interne {host}") from None
        addresses = await resolve_host(host)
    if not addresses or not all(_public(a) for a in addresses):
        raise UnsafeRedirect(f"redirection refusée : {host} n'est pas public")


def _decoder(encoding: str):
    """Décompression bornée selon Content-Encoding : identité, gzip ou deflate (zlib,
    en-tête détecté) ; tout autre encodage (br, zstd, cumul) est refusé."""
    encoding = encoding.strip().lower()
    if encoding in ("", "identity"):
        return None
    if encoding not in ("gzip", "x-gzip", "deflate"):
        raise FeedTooLarge(f"encodage refusé : {encoding[:40]}")
    inflater = zlib.decompressobj(32 + zlib.MAX_WBITS)

    def decode(data: bytes, limit: int) -> bytes:
        out = inflater.decompress(data, max(1, limit))
        if inflater.unconsumed_tail:
            # Sortie tronquée à `limit` : la borne est dépassée
            return out + b"\0"
        return out

    return decode


async def fetch_feed(
    client: httpx.AsyncClient, feed: Feed, timeout: float, max_bytes: int
) -> bytes:
    async def read() -> bytes:
        url = feed.url
        for hop in range(MAX_REDIRECTS + 1):
            if hop or feed.user:
                await check_redirect(url)
            async with client.stream(
                "GET", url, timeout=timeout, follow_redirects=False
            ) as response:
                if response.is_redirect:
                    url = str(response.url.join(response.headers["location"]))
                    continue
                response.raise_for_status()
                decoder = _decoder(response.headers.get("content-encoding", ""))
                chunks: list[bytes] = []
                size = 0
                # Réponse compressée : octets bruts, décompressés ici avec une borne (une
                # petite réponse ne peut pas gonfler en mémoire au-delà de `max_bytes`)
                stream = (
                    response.aiter_bytes() if decoder is None else response.aiter_raw()
                )
                async for raw in stream:
                    chunk = (
                        raw if decoder is None else decoder(raw, max_bytes - size + 1)
                    )
                    size += len(chunk)
                    if size > max_bytes:
                        raise FeedTooLarge(f"plus de {max_bytes} octets")
                    chunks.append(chunk)
                return b"".join(chunks)
        raise UnsafeRedirect(f"plus de {MAX_REDIRECTS} redirections")

    # Délai global (un serveur qui envoie au compte-gouttes ne bloque pas la veille)
    return await asyncio.wait_for(read(), timeout=timeout * 2)


async def read_feed(
    client: httpx.AsyncClient, feed: Feed, config: Config, now: datetime
) -> tuple[list[Article], str | None]:
    limits = config.limits
    try:
        body = await fetch_feed(
            client, feed, limits.feed_timeout_s, limits.feed_max_bytes
        )
        return parse_feed(body, feed, now, limits.extract_chars), None
    except Exception as exc:  # flux en panne : ignoré, signalé, les autres continuent
        reason = str(exc).splitlines()[0][:200] if str(exc) else type(exc).__name__
        logger.warning("Flux %s indisponible : %s", feed.name, reason)
        return [], f"Flux {feed.name} indisponible"


# --- Filtres et pré-catégorie -----------------------------------------------------------


def _fold(text: str) -> str:
    return strip_accents(text.lower())


def keyword_pattern(keywords: list[str]) -> re.Pattern[str] | None:
    """Mots-clés en mots entiers, casse et accents ignorés (texte passé par `_fold`)."""
    words = [re.escape(_fold(k.strip())) for k in keywords if k.strip()]
    if not words:
        return None
    return re.compile(r"\b(?:" + "|".join(words) + r")\b")


class Categorizer:
    """Pré-catégorie d'un titre (cf. docstring du module)."""

    def __init__(self, config: Config):
        self.patterns = [
            (c.slug, keyword_pattern(c.keywords)) for c in config.categories
        ]
        self.default = config.categories[-1].slug
        self.by_feed = {f.name: f.category for f in config.feeds}
        self.any_keyword = keyword_pattern(
            [k for c in config.categories for k in c.keywords]
        )

    def category(self, title: str, feed: str) -> str:
        folded = _fold(title)
        for slug, pattern in self.patterns:
            if pattern and pattern.search(folded):
                return slug
        return self.by_feed.get(feed) or self.default

    def relevant(self, title: str) -> bool:
        return bool(self.any_keyword and self.any_keyword.search(_fold(title)))


def title_marker(title: str) -> str | None:
    """Clé « déjà vu » d'un titre, à côté de l'adresse : le même article lu dans son flux
    et par Google News (autre adresse). Titres de 4 mots ou plus seulement (« v1.2.0 »
    revient d'un dépôt à l'autre)."""
    if len(title_words(title)) < 4:
        return None
    return "titre:" + title_key(title)


def select(
    articles: list[Article],
    config: Config,
    now: datetime,
    seen: set[str],
) -> list[Article]:
    """Articles candidats : adresse http(s) normalisée, filtre mots-clés, âge maximal,
    déjà vus et doublons (adresse ou titre) écartés ; identifiant et pré-catégorie posés ; les plus récents
    d'abord. Le tri par les votes et la limite viennent ensuite (learning.pick)."""
    categorizer = Categorizer(config)
    filtered = {f.name for f in config.feeds if f.filter_keywords}
    oldest = now - timedelta(hours=config.limits.max_age_hours)
    kept: dict[str, Article] = {}
    titles: set[str] = set()
    for article in articles:
        url = normalize_url(article.url)
        if not url or not article.title:
            continue
        if article.feed in filtered and not categorizer.relevant(article.title):
            continue
        if article.published < oldest or url in seen or url in kept:
            continue
        marker = title_marker(article.title)
        if marker and (marker in seen or marker in titles):
            continue
        if marker:
            titles.add(marker)
        article.url = url
        article.id = article_id(url)
        article.category = categorizer.category(article.title, article.feed)
        kept[url] = article
    return sorted(kept.values(), key=lambda a: (-a.published.timestamp(), a.id))


async def collect(
    client: httpx.AsyncClient,
    config: Config,
    now: datetime,
    seen_lookup,
) -> tuple[list[Article], list[str], int]:
    """(articles retenus, erreurs, nombre de flux lus). `seen_lookup(clés)` renvoie les
    clés déjà vues parmi celles données (adresses et `title_marker`)."""
    hosts = [urlsplit(feed.url).hostname or "" for feed in config.feeds]
    shared = {host for host in hosts if hosts.count(host) > 1}
    locks = {host: asyncio.Lock() for host in shared}

    async def one(feed: Feed, host: str) -> tuple[list[Article], str | None]:
        if host not in locks:
            return await read_feed(client, feed, config, now)
        async with locks[host]:
            found = await read_feed(client, feed, config, now)
            await asyncio.sleep(SAME_HOST_GAP_S)
            return found

    results = await asyncio.gather(
        *(one(feed, host) for feed, host in zip(config.feeds, hosts))
    )
    articles = [a for found, _ in results for a in found]
    errors = [error for _, error in results if error]
    ok = sum(1 for _, error in results if not error)
    keys = {u for a in articles if (u := normalize_url(a.url))}
    keys |= {m for a in articles if (m := title_marker(a.title))}
    seen = seen_lookup(keys)
    return select(articles, config, now, seen), errors, ok


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        # Pas de brotli (décompression non bornable ici, cf. _decoder)
        headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"},
        # Aucun mandataire lu dans l'environnement : les contrôles d'adresse visent
        # bien le serveur contacté
        trust_env=False,
        # Redirections des flux suivies et contrôlées par fetch_feed
        follow_redirects=False,
        timeout=httpx.Timeout(10),
    )
