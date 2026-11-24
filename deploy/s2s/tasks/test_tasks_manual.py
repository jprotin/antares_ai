"""Lot A de la veille : passage manuel demandé depuis l'interface (manual.py,
jobs.run_requested), articles non retenus enregistrés (jobs.others), sources
privilégiées (user_sources.favorites, learning.pick, prompt), migration du schéma 2."""

import asyncio
import json
import sqlite3
import unittest
from datetime import timedelta

import digest
import jobs
import learning
import manual
import user_sources
import veille_votes
from feeds import Article, article_id
from store import Store
from tasks_testing import (
    Clock,
    Env,
    FakeModel,
    all_feeds,
    answer_for,
    config,
    utc,
    Web,
)

NOW = utc(2026, 11, 16, 12, 0)


class Requests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.votes = veille_votes.VotesDB(self.env.votes)

    def test_base_ou_table_absente(self):
        self.assertIsNone(manual.pending(self.env.votes, 0, NOW))
        self.votes.set_enabled("X", True, NOW)  # base créée, sans demande
        self.assertIsNone(manual.pending(self.env.votes, 0, NOW))

    def test_derniere_demande_recente_non_prise(self):
        first = self.votes.add_run_request(NOW - timedelta(minutes=2))
        second = self.votes.add_run_request(NOW - timedelta(minutes=1))
        self.assertEqual(manual.pending(self.env.votes, 0, NOW), second["id"])
        self.assertIsNone(manual.pending(self.env.votes, second["id"], NOW))
        self.assertGreater(second["id"], first["id"])

    def test_demande_expiree_ignoree(self):
        self.votes.add_run_request(NOW - timedelta(minutes=11))
        self.assertIsNone(manual.pending(self.env.votes, 0, NOW))

    def test_passage_manuel_complet_une_seule_fois(self):
        cfg = config()
        clock = Clock(NOW)
        ctx = self.env.context(all_feeds(Web(), cfg), FakeModel(answer_for), clock, cfg)
        ctx.store.init(NOW)
        request = self.votes.add_run_request(NOW)
        result = asyncio.run(jobs.run_requested(ctx))
        self.assertIsNotNone(result)
        self.assertEqual(result.record.status, "done")
        self.assertIsNotNone(result.weather)  # météo relevée
        runs = ctx.store.runs()
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["request_id"], request["id"])
        self.assertIsNone(runs[0]["slot_at"])
        done = ctx.store.manual_run(request["id"])
        self.assertEqual((done["status"], done["run_id"]), ("done", runs[0]["id"]))
        self.assertEqual(ctx.store.last_request_id(), request["id"])
        # Demande déjà prise : rien de plus
        self.assertIsNone(asyncio.run(jobs.run_requested(ctx)))
        self.assertEqual(len(ctx.store.runs()), 1)

    def test_demande_en_cours_orpheline_en_echec(self):
        store = self.env.store()
        store.init(NOW)
        self.assertTrue(store.take_request(7, NOW))
        self.assertFalse(store.take_request(7, NOW))
        store.init(NOW + timedelta(minutes=1))  # redémarrage brutal
        self.assertEqual(store.manual_run(7)["status"], "failed")
        # Purge : le dernier numéro pris reste connu (meta)
        store.purge(NOW + timedelta(days=40), 30)
        self.assertIsNone(store.manual_run(7))
        self.assertEqual(store.last_request_id(), 7)


class Others(unittest.TestCase):
    def test_articles_non_retenus_enregistres(self):
        env = Env()
        cfg = config()
        # Un seul article retenu par le modèle : les autres sont « non retenus »
        model = FakeModel(lambda messages: answer_for(messages, count=1))
        ctx = env.context(all_feeds(Web(), cfg), model, Clock(NOW), cfg)
        ctx.store.init(NOW)
        result = asyncio.run(jobs.run_veille(ctx))
        record = result.record
        self.assertTrue(record.others)
        kept = {i["id"] for i in record.items}
        self.assertFalse(kept & {o["id"] for o in record.others})
        scores = [o["score"] for o in record.others]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(
            set(record.others[0]),
            {
                "id",
                "title",
                "url",
                "source",
                "lang",
                "category",
                "summary",
                "published_at",
                "score",
            },
        )
        row = ctx.store.runs()[0]
        self.assertEqual(len(json.loads(row["others_json"])), len(record.others))
        # Jamais notés vus : ils restent candidats au passage suivant
        others = [o["url"] for o in record.others]
        self.assertEqual(ctx.store.seen(others), set())

    def test_limite(self):
        pool = [
            Article(
                feed="A",
                title=f"Titre {i}",
                url=f"https://a.example.com/{i}",
                summary="",
                published=NOW,
                id=article_id(f"https://a.example.com/{i}"),
                score=float(i),
            )
            for i in range(10)
        ]
        rest = jobs.others(pool, {pool[9].id}, 3)
        self.assertEqual([o["score"] for o in rest], [8.0, 7.0, 6.0])


class Favorites(unittest.TestCase):
    def test_lecture(self):
        env = Env()
        self.assertEqual(user_sources.favorites(env.votes), set())
        votes = veille_votes.VotesDB(env.votes)
        votes.set_enabled("X", True, NOW)
        self.assertEqual(user_sources.favorites(env.votes), set())
        votes.set_favorite("Korben", True, NOW)
        votes.set_favorite("Next", True, NOW)
        votes.set_favorite("Next", False, NOW)
        self.assertEqual(user_sources.favorites(env.votes), {"Korben"})

    def test_places_garanties(self):
        cfg = config()
        cfg = cfg.model_copy(
            update={"limits": cfg.limits.model_copy(update={"candidates": 30})}
        )
        votes = [
            learning.Vote(
                kind="article",
                value=1,
                title=f"s{s} {i}",
                voted_at=NOW,
                source=f"S{s}",
                category="ia",
            )
            for s in range(10)
            for i in range(5)
        ]
        votes += [
            learning.Vote(
                kind="article",
                value=-1,
                title=f"k {i}",
                voted_at=NOW,
                source="Korben",
                category="ia",
            )
            for i in range(5)
        ]
        weights = learning.compute_weights(votes, NOW, cfg.learning)

        def article(feed: str, n: int) -> Article:
            url = f"https://{feed.lower()}.example.com/{n}"
            return Article(
                feed=feed,
                title=f"{feed} nouvelle {n}",
                url=url,
                summary="",
                published=NOW - timedelta(hours=1),
                id=article_id(url),
                category="ia",
            )

        pool = [article(f"S{s}", i) for s in range(10) for i in range(8)]
        pool += [article("Korben", i) for i in range(8)]
        picked = learning.pick(list(pool), weights, cfg, NOW)
        self.assertEqual(sum(1 for a in picked if a.feed == "Korben"), 0)
        picked = learning.pick(list(pool), weights, cfg, NOW, {"Korben"})
        self.assertEqual(len(picked), 30)
        self.assertEqual(sum(1 for a in picked if a.feed == "Korben"), 3)
        # Numérotés en premier : le modèle les voit d'abord
        self.assertEqual([a.feed for a in picked[:3]], ["Korben"] * 3)
        self.assertEqual([a.ref for a in picked[:3]], ["c1", "c2", "c3"])

    def test_un_article_garanti_a_la_une(self):
        cfg = config()
        candidates = [
            Article(
                feed=feed,
                title=f"{feed} titre {n}",
                url=f"https://{feed.lower()}.example.com/{n}",
                summary=f"Extrait {feed} {n}",
                published=NOW,
                id=f"{i:016x}",
                ref=f"c{i + 1}",
                category="informatique",
            )
            for i, (feed, n) in enumerate(
                [("Korben", 1), ("Korben", 2), ("Next", 1), ("Absente", 1)]
            )
        ]
        answer = digest.ArticlesAnswer.model_validate(
            {"items": [{"ref": "c3", "category": "ia", "sentence": "Phrase."}]}
        )
        items = digest.select_items(answer, candidates, cfg, {"Korben", "Next", "Rien"})
        self.assertEqual(
            [(i["source"], i["title"], i["sentence"]) for i in items],
            [("Next", "Next titre 1", "Phrase."), ("Korben", "Korben titre 1", "")],
        )
        self.assertEqual(items[1]["summary"], "Extrait Korben 1")

    def test_prompt(self):
        cfg = config()
        candidate = Article(
            feed="Korben",
            title="Titre",
            url="https://korben.info/a",
            summary="x" * 1000,
            published=NOW,
            ref="c1",
            category="ia",
        )
        messages = digest.build_articles_messages(
            [candidate], cfg, [], [], ["Korben", "Absente"]
        )
        user = messages[1]["content"]
        self.assertIn("## Sources privilégiées\nKorben\n", user)
        self.assertNotIn("Absente", user)
        # Extrait long gardé pour l'interface, coupé dans le prompt
        self.assertIn("x" * (cfg.limits.summary_chars - 1) + "…", user)
        self.assertNotIn("x" * cfg.limits.summary_chars, user)
        empty = digest.build_articles_messages([candidate], cfg, [], [])
        self.assertIn("## Sources privilégiées\n(aucune)", empty[1]["content"])


class Migration(unittest.TestCase):
    def test_base_de_schema_2(self):
        env = Env()
        conn = sqlite3.connect(env.db)
        conn.executescript(
            "CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, slot_at TEXT, "
            "day TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, "
            "status TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]', "
            "ideas_json TEXT NOT NULL DEFAULT '[]', errors_json TEXT NOT NULL "
            "DEFAULT '[]', model TEXT NOT NULL DEFAULT '');"
            "INSERT INTO runs (day, started_at, finished_at, status) VALUES "
            "('2026-11-15', '2026-11-15T07:00:00+00:00', "
            "'2026-11-15T07:01:00+00:00', 'done');"
            "PRAGMA user_version=2;"
        )
        conn.close()
        store = Store(env.db)
        store.init(NOW)
        store.init(NOW)  # idempotent
        row = store.runs()[0]
        self.assertEqual((row["others_json"], row["request_id"]), ("[]", None))
        conn = sqlite3.connect(env.db)
        self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], 5)
        conn.close()


if __name__ == "__main__":
    unittest.main()
