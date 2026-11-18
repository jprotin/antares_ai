"""Collecte (feeds.py) : normalisation des adresses, analyse RSS/Atom, flux en panne,
filtres. Aucun accès réseau : httpx.MockTransport."""

import asyncio
import hashlib
import unittest
from datetime import timedelta

import httpx

import feeds
from settings import Feed
from tasks_testing import Web, config, fixture, utc, xml

NOW = utc(2026, 11, 16, 12, 0)
FEED = Feed(name="OpenAI", url="https://openai.com/news/rss.xml")
norm = feeds.normalize_url


def parse(name: str, feed: Feed = FEED, chars: int = 300):
    return feeds.parse_feed(fixture(name), feed, NOW, chars)


class NormalizeUrl(unittest.TestCase):
    def test_utm_retires(self):
        self.assertEqual(
            norm("https://ex.com/a?utm_source=x&utm_medium=y"), "https://ex.com/a"
        )

    def test_slash_final(self):
        self.assertEqual(norm("https://ex.com/a/"), norm("https://ex.com/a"))

    def test_autres_parametres_gardes(self):
        self.assertEqual(
            norm("https://ex.com/a?utm_source=x&id=3"), "https://ex.com/a?id=3"
        )

    def test_schema_et_hote_en_minuscules_chemin_inchange(self):
        self.assertEqual(norm("HTTPS://EX.COM/A"), "https://ex.com/A")

    def test_fragment_retire(self):
        self.assertEqual(norm("https://ex.com/a#section"), "https://ex.com/a")

    def test_adresses_refusees(self):
        for url in (
            "javascript:alert(1)",
            "ftp://ex.com/a",
            "data:text/html,x",
            "",
            None,
            "/relative/a",
            "https://",
            "mailto:a@ex.com",
        ):
            self.assertIsNone(norm(url), url)

    def test_racine(self):
        self.assertEqual(norm("https://ex.com/"), "https://ex.com")
        self.assertEqual(norm("https://ex.com"), "https://ex.com")

    def test_utm_casse_ignoree(self):
        self.assertEqual(
            norm("https://ex.com/a?UTM_Source=x&utm_=1&utm_content="),
            "https://ex.com/a",
        )

    def test_ordre_des_parametres_conserve(self):
        self.assertEqual(norm("https://ex.com/a?b=2&a=1"), "https://ex.com/a?b=2&a=1")
        self.assertEqual(
            norm("https://ex.com/a?b=2&utm_x=1&a=1"), "https://ex.com/a?b=2&a=1"
        )

    def test_idempotence(self):
        for name in ("rss_openai.xml", "atom_github_releases.xml", "rss_hn.xml"):
            for article in parse(name):
                once = norm(article.url)
                self.assertEqual(norm(once), once)


class Parse(unittest.TestCase):
    def test_rss_nominal(self):
        articles = parse("rss_openai.xml")
        self.assertEqual(len(articles), 5)
        first = articles[0]
        self.assertEqual(first.title, "Introducing GPT-6 mini")
        self.assertEqual(first.summary, "A smaller, faster model for agents.")
        self.assertEqual(first.published, utc(2026, 11, 16, 9, 0))
        self.assertEqual(articles[2].published, utc(2026, 11, 15, 17, 30))

    def test_atom_nominal(self):
        articles = parse("atom_github_releases.xml")
        self.assertEqual([a.title for a in articles], ["v0.20.0", "v0.19.9", "v0.19.8"])
        self.assertEqual(
            articles[0].url, "https://github.com/ollama/ollama/releases/tag/v0.20.0"
        )
        self.assertEqual(articles[0].published, utc(2026, 11, 16, 10, 0))
        self.assertEqual(articles[0].summary, "New engine for Gemma 4.")

    def test_date_sans_fuseau_en_utc(self):
        article = parse("atom_github_releases.xml")[2]
        self.assertEqual(article.published, utc(2026, 11, 15, 6, 0))
        self.assertLess(article.published, NOW)  # aucune TypeError aware/naive

    def test_article_sans_date_date_de_la_collecte(self):
        self.assertEqual(parse("rss_openai.xml")[4].published, NOW)

    def test_agregateur_source_editeur(self):
        body = (
            b'<?xml version="1.0"?><rss version="2.0"><channel><title>GN</title>'
            b"<item><title>Anthropic fixe le prix de son IPO - Le Monde</title>"
            b"<link>https://news.google.com/rss/articles/abc</link>"
            b"<pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>"
            b"<description>Anthropic fixe le prix</description>"
            b'<source url="https://www.lemonde.fr">Le Monde</source></item>'
            b"<item><title>Sans source - Tiret gard\xc3\xa9</title>"
            b"<link>https://example.com/b</link></item>"
            b"<item><title> - Korben</title>"
            b"<link>https://news.google.com/rss/articles/def</link>"
            b'<source url="https://korben.info">Korben</source></item>'
            b"</channel></rss>"
        )
        first, second, untitled = feeds.parse_feed(body, FEED, NOW, 300)
        self.assertEqual(untitled.title, "")
        self.assertEqual(first.title, "Anthropic fixe le prix de son IPO")
        self.assertEqual(first.summary, "Le Monde : Anthropic fixe le prix")
        self.assertEqual(second.title, "Sans source - Tiret gardé")

    def test_xml_invalide(self):
        with self.assertRaises(Exception):
            parse("invalid.xml")

    def test_entites_malveillantes_refusees(self):
        with self.assertRaises(Exception) as caught:
            parse("billion_laughs.xml")
        self.assertIn(
            "Entities", type(caught.exception).__name__ + str(caught.exception)
        )

    def test_resume_html_nettoye_et_tronque(self):
        article = parse("rss_html_summary.xml")[0]
        self.assertEqual(article.title, "Tom & Jerry release")
        self.assertTrue(article.summary.startswith("Fast & small Lorem ipsum"))
        self.assertNotIn("alert", article.summary)
        self.assertNotIn("<", article.summary)
        self.assertLessEqual(len(article.summary), 300)
        self.assertTrue(article.summary.endswith("…"))

    def test_encodage_latin1(self):
        self.assertEqual(parse("rss_latin1.xml")[0].title, "Modèle français")

    def test_flux_vide(self):
        body = b'<rss version="2.0"><channel><title>x</title></channel></rss>'
        self.assertEqual(feeds.parse_feed(body, FEED, NOW, 300), [])


def collect(web: Web, cfg=None, seen=frozenset()):
    cfg = cfg or config()

    async def go():
        async with web.client() as client:
            return await feeds.collect(
                client, cfg, NOW, lambda urls: set(seen) & set(urls)
            )

    return asyncio.run(go())


class Collect(unittest.TestCase):
    def cfg(self, n: int, **limits):
        base = config()
        feeds_list = [
            Feed(name=f"F{i}", url=f"https://f{i}.example.com/rss") for i in range(n)
        ]
        return base.model_copy(
            update={
                "feeds": feeds_list,
                "limits": base.limits.model_copy(update=limits),
            }
        )

    def test_huit_flux_dont_un_injoignable(self):
        cfg = self.cfg(8)
        web = Web()
        for feed in cfg.feeds[:7]:
            web.add(feed.url, xml("atom_github_releases.xml"))
        articles, errors, ok = collect(web, cfg)
        self.assertEqual(ok, 7)
        self.assertEqual(errors, ["Flux F7 indisponible"])
        self.assertEqual(len(articles), 3)  # mêmes adresses dans les 7 flux

    def test_pannes_http_delai_xml(self):
        cfg = self.cfg(5)
        web = Web()
        web.add(cfg.feeds[0].url, httpx.Response(404))
        web.add(cfg.feeds[1].url, httpx.Response(500))
        web.add(cfg.feeds[2].url, httpx.ReadTimeout("délai dépassé"))
        web.add(cfg.feeds[3].url, xml("invalid.xml"))
        web.add(cfg.feeds[4].url, xml("billion_laughs.xml"))
        articles, errors, ok = collect(web, cfg)
        self.assertEqual((articles, ok), ([], 0))
        self.assertEqual(errors, [f"Flux F{i} indisponible" for i in range(5)])

    def test_flux_trop_gros_interrompu(self):
        cfg = self.cfg(2, feed_max_bytes=2000)
        web = Web()
        big = b"<rss>" + b"x" * 5000 + b"</rss>"
        web.add(cfg.feeds[0].url, httpx.Response(200, content=big))
        web.add(cfg.feeds[1].url, xml("rss_openai.xml"))
        _, errors, ok = collect(web, cfg)
        self.assertEqual((errors, ok), (["Flux F0 indisponible"], 1))

    def test_identifiants_langue_et_ordre(self):
        cfg = self.cfg(2)
        cfg.feeds[1] = Feed(name="F1", url=cfg.feeds[1].url, lang="fr")
        web = (
            Web()
            .add(cfg.feeds[0].url, xml("rss_openai.xml"))
            .add(cfg.feeds[1].url, xml("atom_github_releases.xml"))
        )
        articles, _, _ = collect(web, cfg)
        for article in articles:
            self.assertEqual(
                article.id,
                hashlib.sha256(article.url.encode()).hexdigest()[:16],
            )
            self.assertRegex(article.id, r"^[0-9a-f]{16}$")
            self.assertEqual(article.lang, "fr" if article.feed == "F1" else "en")
            self.assertEqual(article.ref, "")  # numéroté après le score des votes
        # Tri par date décroissante
        dates = [a.published for a in articles]
        self.assertEqual(dates, sorted(dates, reverse=True))

    def test_doublon_utm_un_seul_article_et_age(self):
        cfg = self.cfg(1)
        articles, _, _ = collect(
            Web().add(cfg.feeds[0].url, xml("rss_openai.xml")), cfg
        )
        urls = [a.url for a in articles]
        self.assertEqual(urls.count("https://openai.com/index/gpt-6-mini"), 1)
        self.assertNotIn("https://openai.com/index/old", urls)  # plus de 48 h
        self.assertIn("https://openai.com/index/undated", urls)

    def test_deja_vu_ecarte(self):
        cfg = self.cfg(1)
        web = Web().add(cfg.feeds[0].url, xml("rss_openai.xml"))
        articles, _, _ = collect(
            web, cfg, seen={"https://openai.com/index/realtime-voices"}
        )
        self.assertNotIn(
            "https://openai.com/index/realtime-voices", [a.url for a in articles]
        )

    def test_aucune_limite_avant_le_score(self):
        cfg = self.cfg(1, candidates=2)
        articles, _, _ = collect(
            Web().add(cfg.feeds[0].url, xml("rss_openai.xml")), cfg
        )
        self.assertGreater(len(articles), 2)

    def test_lien_javascript_ecarte(self):
        cfg = self.cfg(1)
        articles, _, _ = collect(
            Web().add(cfg.feeds[0].url, xml("rss_injection.xml")), cfg
        )
        self.assertEqual([a.url for a in articles], ["https://hostile.example.com/a"])


def moved(location: str, status: int = 302) -> httpx.Response:
    return httpx.Response(status, headers={"Location": location})


class Redirections(unittest.TestCase):
    """Redirections d'un flux : suivies seulement vers une adresse https publique."""

    FEED_URL = "https://f0.example.com/rss"
    DNS = {
        "public.example.com": ["93.184.216.34"],
        "interne.example.com": ["10.0.0.5"],
        "boucle.example.com": ["127.0.0.1"],
        "mixte.example.com": ["93.184.216.34", "172.17.0.2"],
        "v6.example.com": ["::ffff:192.168.1.1"],
    }

    def setUp(self):
        original = feeds.resolve_host

        async def fake(host: str) -> list[str]:
            return self.DNS.get(host, [])

        feeds.resolve_host = fake
        self.addCleanup(setattr, feeds, "resolve_host", original)
        base = config()
        self.cfg = base.model_copy(
            update={"feeds": [Feed(name="F0", url=self.FEED_URL)]}
        )

    def run_with(self, web: Web):
        return collect(web, self.cfg)

    def assert_refused(self, location: str, *forbidden: str):
        web = Web().add(self.FEED_URL, moved(location))
        for prefix in forbidden:
            web.add(prefix, xml("rss_openai.xml"))
        articles, errors, ok = self.run_with(web)
        self.assertEqual((articles, errors, ok), ([], ["Flux F0 indisponible"], 0))
        for prefix in forbidden:
            self.assertEqual(web.hits(prefix), 0, prefix)

    def test_redirection_publique_suivie(self):
        web = (
            Web()
            .add(self.FEED_URL, moved("https://public.example.com/rss", 301))
            .add("https://public.example.com/rss", xml("rss_openai.xml"))
        )
        articles, errors, ok = self.run_with(web)
        self.assertEqual((errors, ok), ([], 1))
        self.assertTrue(articles)

    def test_redirection_relative_suivie(self):
        web = (
            Web()
            .add(self.FEED_URL, moved("/nouveau"))
            .add("https://f0.example.com/nouveau", xml("rss_openai.xml"))
        )
        self.DNS = {**self.DNS, "f0.example.com": ["93.184.216.34"]}
        _, errors, ok = self.run_with(web)
        self.assertEqual((errors, ok), ([], 1))

    def test_service_docker_sans_point_refuse(self):
        self.assert_refused("https://qdrant:6333/collections", "https://qdrant")

    def test_http_en_clair_refuse(self):
        self.assert_refused("http://public.example.com/rss", "http://public")

    def test_ip_privee_litterale_refusee(self):
        self.assert_refused("https://10.0.0.5/admin", "https://10.0.0.5")
        self.assert_refused("https://169.254.169.254/latest", "https://169.254")
        self.assert_refused("https://[::1]/", "https://[::1]")

    def test_nom_resolu_en_adresse_interne_refuse(self):
        for host in (
            "interne.example.com",
            "boucle.example.com",
            "mixte.example.com",
            "v6.example.com",
            "inconnu.example.com",
        ):
            self.assert_refused(f"https://{host}/rss", f"https://{host}")

    def test_trop_de_redirections(self):
        web = Web().add(self.FEED_URL, moved("https://public.example.com/r1"))
        for i in range(1, 6):
            web.add(
                f"https://public.example.com/r{i}",
                moved(f"https://public.example.com/r{i + 1}"),
            )
        _, errors, ok = self.run_with(web)
        self.assertEqual((errors, ok), (["Flux F0 indisponible"], 0))
        self.assertEqual(web.hits("https://public.example.com/"), feeds.MAX_REDIRECTS)

    def test_client_ne_suit_pas_seul(self):
        self.assertFalse(feeds.new_client().follow_redirects)


class KeywordFilter(unittest.TestCase):
    def test_hacker_news_mots_entiers(self):
        cfg = config()
        cfg = cfg.model_copy(
            update={
                "feeds": [
                    Feed(
                        name="HN",
                        url="https://hn.example.com/rss",
                        filter_keywords=True,
                    ),
                    Feed(name="Autre", url="https://autre.example.com/rss"),
                ]
            }
        )
        web = (
            Web()
            .add("https://hn.example.com/rss", xml("rss_hn.xml"))
            .add("https://autre.example.com/rss", xml("rss_hn.xml"))
        )
        articles, _, _ = collect(web, cfg)
        # « said », « Kaizen », « email », « Claudette » rejetés ; AI, LLM, Claude gardés
        titles = {a.title for a in articles}
        self.assertIn(
            "He said no to the merger", titles
        )  # gardé par le flux non filtré
        self.assertEqual(len(articles), 7)  # mêmes adresses : un seul exemplaire chacun

    def test_filtre_seul(self):
        cfg = config()
        hn = Feed(name="HN", url="https://hn.example.com/rss", filter_keywords=True)
        cfg = cfg.model_copy(update={"feeds": [hn]})
        articles, _, _ = collect(Web().add(hn.url, xml("rss_hn.xml")), cfg)
        self.assertEqual(
            sorted(a.title for a in articles),
            [
                "Running a local LLM on a laptop",
                "Show HN: an AI agent for my terminal",
                "What Claude Code changed for us",
            ],
        )

    def test_casse_et_accents_ignores(self):
        categorizer = feeds.Categorizer(config())
        self.assertTrue(categorizer.relevant("CLAUDE is here"))
        self.assertTrue(categorizer.relevant("new Ai model"))
        self.assertTrue(categorizer.relevant("Une faille critique"))
        self.assertTrue(categorizer.relevant("Nouvelle VULNÉRABILITÉ"))
        self.assertFalse(categorizer.relevant("claudette"))
        self.assertFalse(categorizer.relevant("said"))


class PreCategory(unittest.TestCase):
    def setUp(self):
        self.categorizer = feeds.Categorizer(config())

    def test_mot_cle_du_titre_dans_l_ordre_des_categories(self):
        cases = {
            "Nvidia GPU for AI training": "ia",  # ia avant materiel
            "AWS Lambda gains SnapStart storage": "cloud",
            "Python 3.14 is out": "dev",
            "Ransomware hits a hospital": "securite",
            "Une nouvelle carte graphique": "materiel",
            "Intelligence artificielle : un rapport": "ia",
        }
        for title, slug in cases.items():
            self.assertEqual(self.categorizer.category(title, "Inconnu"), slug, title)

    def test_categorie_du_flux_puis_derniere(self):
        self.assertEqual(
            self.categorizer.category("Un titre", "AWS News Blog"), "cloud"
        )
        self.assertEqual(
            self.categorizer.category("Un titre", "Inconnu"), "informatique"
        )


class Dates(unittest.TestCase):
    def test_parse_date(self):
        self.assertEqual(
            feeds.parse_date("Mon, 16 Nov 2026 09:00:00 GMT"), utc(2026, 11, 16, 9)
        )
        self.assertEqual(feeds.parse_date("2026-11-16T09:00:00Z"), utc(2026, 11, 16, 9))
        self.assertIsNone(feeds.parse_date("hier"))
        self.assertIsNone(feeds.parse_date(""))
        self.assertEqual(
            feeds.parse_date("2026-11-16T10:00:00+01:00") - utc(2026, 11, 16, 9),
            timedelta(0),
        )


class TitleDedupe(unittest.TestCase):
    """Même article par son flux et par Google News (autre adresse)."""

    def article(self, feed: str, url: str, title: str, hours_old: float = 1):
        return feeds.Article(
            feed=feed,
            title=title,
            url=url,
            summary="",
            published=NOW - timedelta(hours=hours_old),
        )

    def test_marqueur(self):
        self.assertEqual(
            feeds.title_marker("Les lunettes connectées d'Apple arriveraient en 2027"),
            "titre:lunettes connectees apple arriveraient 2027",
        )
        self.assertIsNone(feeds.title_marker("v1.2.0"))
        self.assertIsNone(feeds.title_marker("Ollama v0.5"))

    def test_meme_titre_autre_adresse_ecarte(self):
        title = "Les lunettes connectées d'Apple arriveraient en 2027"
        kept = feeds.select(
            [
                self.article("Korben", "https://korben.info/lunettes.html", title),
                self.article(
                    "Korben (Google News)", "https://news.google.com/x", title
                ),
                self.article("A", "https://a.example.com/1", "v1.2.0"),
                self.article("B", "https://b.example.com/1", "v1.2.0"),
            ],
            config(),
            NOW,
            set(),
        )
        self.assertEqual(
            sorted(a.url for a in kept),
            [
                "https://a.example.com/1",
                "https://b.example.com/1",
                "https://korben.info/lunettes.html",
            ],
        )

    def test_titre_deja_vu_ecarte(self):
        title = "Les lunettes connectées d'Apple arriveraient en 2027"
        kept = feeds.select(
            [self.article("Korben (Google News)", "https://news.google.com/x", title)],
            config(),
            NOW,
            {feeds.title_marker(title)},
        )
        self.assertEqual(kept, [])


if __name__ == "__main__":
    unittest.main()
