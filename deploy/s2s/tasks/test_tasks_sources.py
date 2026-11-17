"""Sources ajoutées depuis l'interface : fusion à la collecte, contrôle de la première
adresse, lecture d'essai du routeur (veille_sources.probe, code de collecte partagé)."""

import asyncio
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

import httpx

import feeds
import user_sources
import veille_sources
import veille_votes
from settings import Feed
from tasks_testing import Web, config, fixture, utc

NOW = utc(2026, 11, 16, 12, 0)
DNS = {
    "blog.example.com": ["93.184.216.34"],
    "interne.example.com": ["10.0.0.5"],
}


def fake_dns(test: unittest.TestCase) -> None:
    original = feeds.resolve_host

    async def fake(host: str) -> list[str]:
        return DNS.get(host, [])

    feeds.resolve_host = fake
    test.addCleanup(setattr, feeds, "resolve_host", original)


class Merge(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        self.path = self.dir / "veille.db"
        self.cfg = config()
        self.db = veille_votes.VotesDB(self.path)

    def add(self, name, url, category="ia"):
        self.db.add_source(
            {
                "kind": "feed",
                "name": name,
                "url": url,
                "lang": "fr",
                "category": category,
            },
            NOW,
        )

    def test_sans_base_flux_de_la_configuration(self):
        self.assertEqual(
            user_sources.merged_feeds(self.cfg, self.path), list(self.cfg.feeds)
        )

    def test_base_sans_table_des_sources(self):
        sqlite3.connect(self.path).execute("CREATE TABLE autre (x)").connection.close()
        self.assertEqual(len(user_sources.merged_feeds(self.cfg, self.path)), 65)

    def test_desactivees_retirees_ajoutees_marquees(self):
        first = self.cfg.feeds[0].name
        self.db.set_enabled(first, False, NOW)
        self.add("Mon blog", "https://blog.example.com/feed.xml")
        self.add("Catégorie perdue", "https://blog.example.com/b.xml", category="xx")
        self.add("Adresse invalide", "ftp://blog.example.com/c.xml")
        self.add(self.cfg.feeds[1].name, "https://blog.example.com/d.xml")
        merged = user_sources.merged_feeds(self.cfg, self.path)
        names = [f.name for f in merged]
        self.assertNotIn(first, names)
        self.assertEqual(names[-2:], ["Mon blog", "Catégorie perdue"])
        added = merged[-2:]
        self.assertTrue(all(f.user for f in added))
        self.assertEqual([f.category for f in added], ["ia", ""])
        self.assertFalse(any(f.user for f in merged[:-2]))
        # Nom déjà pris par une source fournie : ignorée
        self.assertEqual(len(merged), 65 - 1 + 2)


class FirstHop(unittest.TestCase):
    def setUp(self):
        fake_dns(self)

    def read(self, url: str, user: bool):
        web = Web().add(url, httpx.Response(200, content=fixture("rss_openai.xml")))
        feed = Feed(name="F", url=url, user=user)

        async def go():
            async with web.client() as client:
                return await feeds.read_feed(client, feed, config(), NOW)

        return asyncio.run(go()), web

    def test_source_de_l_interface_controlee(self):
        for url in ("https://interne.example.com/rss", "http://blog.example.com/rss"):
            (articles, error), web = self.read(url, user=True)
            self.assertEqual((articles, web.requests), ([], []), url)
            self.assertEqual(error, "Flux F indisponible")
        (articles, error), _ = self.read("https://blog.example.com/rss", user=True)
        self.assertTrue(articles)
        self.assertIsNone(error)

    def test_flux_de_la_configuration_inchange(self):
        (articles, error), _ = self.read("https://interne.example.com/rss", user=False)
        self.assertTrue(articles)


class SameHost(unittest.TestCase):
    def test_un_site_a_la_fois_espace(self):
        active = {"now": 0, "max": 0}

        def slow(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=fixture("rss_openai.xml"))

        web = Web()
        web.add("https://news.example.com/", slow).add(
            "https://other.example.com/", slow
        )
        original = feeds.read_feed

        async def counted(*args, **kwargs):
            if args[1].url.startswith("https://news."):
                active["now"] += 1
                active["max"] = max(active["max"], active["now"])
                await asyncio.sleep(0.01)
                active["now"] -= 1
            return await original(*args, **kwargs)

        feeds.read_feed = counted
        self.addCleanup(setattr, feeds, "read_feed", original)
        cfg = config().model_copy(
            update={
                "feeds": [
                    Feed(name=f"N{i}", url=f"https://news.example.com/{i}")
                    for i in range(3)
                ]
                + [Feed(name="O", url="https://other.example.com/rss")]
            }
        )

        async def go():
            async with web.client() as client:
                return await feeds.collect(client, cfg, NOW, lambda urls: set())

        _, errors, ok = asyncio.run(go())
        self.assertEqual((errors, ok), ([], 4))
        self.assertEqual(active["max"], 1)


class Probe(unittest.TestCase):
    def setUp(self):
        fake_dns(self)

    def probe(self, web: Web, url: str):
        async def go():
            async with web.client() as client:
                return await veille_sources.probe(url, "fr", NOW, client)

        return asyncio.run(go())

    def test_flux_direct(self):
        web = Web().add(
            "https://blog.example.com/feed",
            httpx.Response(200, content=fixture("rss_openai.xml")),
        )
        found = self.probe(web, "https://blog.example.com/feed")
        self.assertEqual(found["url"], "https://blog.example.com/feed")
        self.assertGreater(found["articles"], 0)
        self.assertLessEqual(len(found["latest"]), 3)

    def test_page_qui_declare_son_flux(self):
        page = (
            b'<html><head><link rel="alternate" type="application/rss+xml" '
            b'href="/rss.xml"></head></html>'
        )
        web = (
            Web()
            .add(
                "https://blog.example.com/rss.xml",
                httpx.Response(200, content=fixture("rss_openai.xml")),
            )
            .add("https://blog.example.com/", httpx.Response(200, content=page))
        )
        found = self.probe(web, "https://blog.example.com/")
        self.assertEqual(found["url"], "https://blog.example.com/rss.xml")

    def test_refus(self):
        cases = [
            ("https://interne.example.com/feed", Web(), "Adresse refusée"),
            (
                "https://blog.example.com/",
                Web().add(
                    "https://blog.example.com/",
                    httpx.Response(200, content=b"<html></html>"),
                ),
                "Ni flux",
            ),
            (
                "https://blog.example.com/",
                Web().add("https://blog.example.com/", httpx.Response(500)),
                "Lecture impossible",
            ),
        ]
        for url, web, reason in cases:
            with self.assertRaises(veille_sources.SourceError) as caught:
                self.probe(web, url)
            self.assertIn(reason, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
