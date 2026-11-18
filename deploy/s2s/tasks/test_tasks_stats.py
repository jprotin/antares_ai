"""Statistiques de la veille (router/veille_stats.py) sur de vraies bases : résumés
quotidiens écrits par le service (store.daily_stats), votes du routeur (veille_votes)."""

import json
import sqlite3
import unittest
from datetime import timedelta

import veille_stats
import veille_votes
from store import RunRecord, Store
from tasks_testing import Env, utc

NOW = utc(2026, 11, 17, 12, 0)
CATEGORIES = [
    {"slug": "ia", "label": "IA"},
    {"slug": "cloud", "label": "Cloud"},
    {"slug": "securite", "label": "Sécurité"},
]


def article(n: int, source: str, category: str, title: str = "") -> dict:
    return {
        "id": f"{n:016x}",
        "title": title or f"Titre {n}",
        "url": f"https://ex.com/{n}",
        "source": source,
        "category": category,
    }


class Stats(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.store = Store(self.env.db)
        self.store.init(NOW - timedelta(days=3))
        self.votes = veille_votes.VotesDB(self.env.votes)
        # Hier : 2 à la une (Korben ia, Next cloud), 2 non retenus
        self.record(
            "2026-11-16",
            NOW - timedelta(days=1),
            [article(1, "Korben", "ia"), article(2, "Next", "cloud")],
            [article(3, "Korben", "ia"), article(4, "Zataz", "securite")],
        )
        # Aujourd'hui, deux passages : article 3 mis à la une au second
        self.record(
            "2026-11-17",
            NOW - timedelta(hours=4),
            [article(5, "Next", "ia")],
            [article(3, "Korben", "ia")],
        )
        self.record(
            "2026-11-17",
            NOW - timedelta(hours=1),
            [article(3, "Korben", "ia")],
            [article(6, "Zataz", "securite")],
        )

    def record(self, day, at, items, others):
        self.store.record_run(
            RunRecord(
                day=day,
                started_at=at,
                finished_at=at,
                status="done",
                items=items,
                others=others,
            )
        )

    def vote(
        self,
        n,
        value,
        placement,
        source="Korben",
        category="ia",
        title="Agents autonomes Kubernetes",
        days_ago=0,
        kind="article",
    ):
        self.votes.set_vote(
            kind,
            f"{n:016x}",
            value,
            {
                "title": title,
                "source": source,
                "category": category,
                "placement": placement,
            },
            NOW - timedelta(days=days_ago),
        )

    def test_resumes_quotidiens(self):
        daily = self.store.daily_stats()
        self.assertEqual(daily["2026-11-16"]["runs"], 1)
        self.assertEqual(
            daily["2026-11-16"]["featured"]["sources"], {"Korben": 1, "Next": 1}
        )
        self.assertEqual(
            daily["2026-11-16"]["collected"]["categories"],
            {"ia": 2, "cloud": 1, "securite": 1},
        )
        # Jour à deux passages : article 3 compté une fois, à la une
        self.assertEqual(daily["2026-11-17"]["featured"]["categories"], {"ia": 2})
        self.assertEqual(
            daily["2026-11-17"]["collected"]["categories"], {"ia": 2, "securite": 1}
        )

    def test_purge_et_remplissage_au_demarrage(self):
        conn = sqlite3.connect(self.env.db)
        conn.execute("DELETE FROM daily_stats")
        conn.commit()
        conn.close()
        self.store.init(NOW)
        self.assertEqual(sorted(self.store.daily_stats()), ["2026-11-16", "2026-11-17"])
        self.store.purge(NOW + timedelta(days=400), 30)
        self.assertEqual(self.store.daily_stats(), {})

    def test_gouts_et_choix_de_l_ia(self):
        self.vote(1, "like", "featured", days_ago=1)
        self.vote(
            2,
            "dislike",
            "featured",
            source="Next",
            category="cloud",
            title="Tarifs du stockage",
            days_ago=1,
        )
        self.vote(
            4,
            "like",
            "other",
            source="Zataz",
            category="securite",
            title="Faille Kubernetes corrigée",
            days_ago=1,
        )
        self.vote(9, "like", "", source="Ancienne", days_ago=200)  # hors période
        self.vote(7, "like", "", kind="idea", title="Idée")
        result = veille_stats.stats(self.env.db, self.votes, 30, NOW, CATEGORIES)
        summary = result["summary"]
        self.assertEqual((summary["likes"], summary["dislikes"]), (2, 1))
        self.assertEqual(summary["agreement"], 50.0)
        self.assertEqual(summary["agreement_votes"], 2)
        self.assertEqual(summary["missed_likes"], 1)
        # Lus : comptés par jour (l'article 3, lu les deux jours, compte deux fois)
        self.assertEqual((summary["featured"], summary["collected"]), (4, 7))
        self.assertEqual(summary["ideas_interested"], 1)
        tastes = result["tastes"]
        self.assertEqual(
            [(c["slug"], c["count"], c["share"]) for c in tastes["categories"]],
            [("ia", 1, 50.0), ("securite", 1, 50.0)],
        )
        self.assertEqual(tastes["sources"][0]["name"], "Korben")
        self.assertEqual(
            tastes["sources"][-1],
            {"name": "Next", "likes": 0, "dislikes": 1, "like_rate": 0.0},
        )
        self.assertEqual(tastes["words"][0], {"word": "kubernetes", "count": 2})
        ai = result["ai"]
        self.assertEqual(
            [(c["slug"], c["count"]) for c in ai["categories"]],
            [("ia", 3), ("cloud", 1)],
        )
        korben = next(s for s in ai["sources"] if s["name"] == "Korben")
        self.assertEqual(
            (korben["featured"], korben["collected"], korben["selection_rate"]),
            (2, 3, 66.7),
        )
        self.assertEqual(
            [d["day"] for d in result["timeline"]], ["2026-11-16", "2026-11-17"]
        )
        self.assertEqual(result["timeline"][0]["missed_likes"], 1)

    def test_vote_sans_placement_retrouve_par_les_passages(self):
        self.vote(4, "like", "", source="Zataz", days_ago=1)
        self.vote(5, "like", "", source="Next")
        result = veille_stats.stats(self.env.db, self.votes, 7, NOW, CATEGORIES)
        self.assertEqual(result["summary"]["missed_likes"], 1)
        self.assertEqual(result["summary"]["agreement"], 100.0)

    def test_periode_et_bases_absentes(self):
        self.vote(1, "like", "featured", days_ago=10)
        week = veille_stats.stats(self.env.db, self.votes, 7, NOW, CATEGORIES)
        self.assertEqual(week["summary"]["likes"], 0)
        self.assertEqual(week["since"], "2026-11-11")
        empty = veille_stats.stats(
            self.env.dir / "absente.db",
            veille_votes.VotesDB(self.env.dir / "absente-votes.db"),
            365,
            NOW,
            CATEGORIES,
        )
        self.assertEqual(empty["summary"]["agreement"], None)
        self.assertEqual(empty["timeline"], [])
        self.assertEqual(json.loads(json.dumps(empty)), empty)

    def test_ancienne_base_de_votes_sans_colonne(self):
        conn = sqlite3.connect(self.env.votes)
        conn.executescript(
            "CREATE TABLE votes (kind TEXT, target_id TEXT, value INTEGER, title TEXT,"
            " source TEXT, category TEXT, lang TEXT, url TEXT, detail TEXT,"
            " run_id INTEGER, voted_at TEXT);"
        )
        conn.execute(
            "INSERT INTO votes VALUES ('article', ?, 1, 'T', 'Korben', 'ia', '', '',"
            " '', NULL, ?)",
            (f"{1:016x}", NOW.isoformat()),
        )
        conn.commit()
        conn.close()
        result = veille_stats.stats(self.env.db, self.votes, 7, NOW, CATEGORIES)
        self.assertEqual(result["summary"]["likes"], 1)
        self.assertEqual(result["summary"]["agreement"], 100.0)
        # Premier vote : colonne ajoutée
        self.vote(2, "like", "featured")
        conn = sqlite3.connect(self.env.votes)
        columns = [r[1] for r in conn.execute("PRAGMA table_info(votes)")]
        conn.close()
        self.assertIn("placement", columns)


if __name__ == "__main__":
    unittest.main()
