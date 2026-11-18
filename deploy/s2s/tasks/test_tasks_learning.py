"""Apprentissage par les votes (learning.py) : lecture de la base du routeur, décroissance,
bornes, ordre, exploration, base absente."""

import sqlite3
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

import learning
from feeds import Article, article_id
from tasks_testing import config, utc, write_votes

NOW = utc(2026, 11, 17, 12, 0)
# Totaux des tests ci-dessous : 60 candidats (90 dans tasks.yaml)
CFG = config()
CFG = CFG.model_copy(
    update={"limits": CFG.limits.model_copy(update={"candidates": 60})}
)


def article(feed: str, n: int, hours_old: float = 1, title: str = "") -> Article:
    url = f"https://{feed.lower()}.example.com/{n}"
    return Article(
        feed=feed,
        title=title or f"{feed} nouvelle {n}",
        url=url,
        summary="",
        published=NOW - timedelta(hours=hours_old),
        id=article_id(url),
        category="informatique",
    )


def vote(value: int, days_old: float = 0, **fields) -> learning.Vote:
    return learning.Vote(
        kind="article",
        value=value,
        title=fields.pop("title", "titre"),
        voted_at=NOW - timedelta(days=days_old),
        **fields,
    )


class Weights(unittest.TestCase):
    def test_demi_vie(self):
        today = learning.vote_weight(1, NOW, NOW, 30)
        old = learning.vote_weight(1, NOW - timedelta(days=30), NOW, 30)
        self.assertAlmostEqual(old, today / 2)
        self.assertAlmostEqual(learning.vote_weight(-1, NOW, NOW, 30), -1)

    def test_bornes(self):
        many = [1.0] * 1000
        self.assertLess(learning.trait_weight(many, 2), 1)
        self.assertGreater(learning.trait_weight([-1.0] * 1000, 2), -1)
        self.assertEqual(learning.trait_weight([], 2), 0)
        # Un seul vote du jour : 1 / (2 + 1)
        self.assertAlmostEqual(learning.trait_weight([1.0], 2), 1 / 3)

    def test_score_borne(self):
        weights = learning.Weights(
            source={"X": 0.99},
            category={"informatique": 0.99},
            words={"nouvelle": 0.99},
        )
        cfg = CFG.model_copy(
            update={
                "learning": CFG.learning.model_copy(
                    update={
                        "weights": CFG.learning.weights.model_copy(
                            update={"source": 10, "category": 10, "words": 10}
                        )
                    }
                )
            }
        )
        self.assertEqual(learning.score(article("X", 1), weights, cfg, NOW), 3.0)

    def test_sources_aimees_et_rejetees(self):
        votes = [vote(-1, source="X", title=f"x {i}") for i in range(5)]
        votes += [vote(1, source="Y", title=f"y {i}") for i in range(5)]
        weights = learning.compute_weights(votes, NOW, CFG.learning)
        x, y = article("X", 1, hours_old=3), article("Y", 1, hours_old=3)
        picked = learning.pick([x, y], weights, CFG, NOW)
        self.assertEqual([a.feed for a in picked], ["Y", "X"])
        self.assertEqual([a.ref for a in picked], ["c1", "c2"])
        self.assertGreater(y.score, x.score)

    def test_mots_du_titre(self):
        votes = [vote(1, title="Kubernetes autoscaling"), vote(1, title="Kubernetes 2")]
        weights = learning.compute_weights(votes, NOW, CFG.learning)
        self.assertGreater(weights.words["kubernetes"], 0)
        a = article("A", 1, title="Kubernetes en production")
        b = article("A", 2, title="Football en production")
        learning.pick([a, b], weights, CFG, NOW)
        self.assertGreater(a.score, b.score)


class Pick(unittest.TestCase):
    def test_ordre_total_stable(self):
        pool = [article("A", i, hours_old=1) for i in range(5)]
        first = [a.id for a in learning.pick(list(pool), learning.Weights(), CFG, NOW)]
        second = [
            a.id
            for a in learning.pick(list(reversed(pool)), learning.Weights(), CFG, NOW)
        ]
        self.assertEqual(first, second)
        self.assertEqual(first, sorted(first))

    def test_limites_par_source_et_total(self):
        pool = [article(f"S{s}", i, hours_old=i) for s in range(10) for i in range(12)]
        picked = learning.pick(pool, learning.Weights(), CFG, NOW)
        self.assertEqual(len(picked), 60)
        for s in range(10):
            self.assertLessEqual(sum(1 for a in picked if a.feed == f"S{s}"), 8)
        self.assertEqual([a.ref for a in picked], [f"c{i}" for i in range(1, 61)])

    def test_exploration_source_peu_votee(self):
        # 20 sources très aimées remplissent 60 places ; « Neuve » (aucun vote) est plus
        # ancienne et moins bien notée, mais garde des places réservées
        votes = [
            vote(1, source=f"S{s}", title=f"s{s} {i}")
            for s in range(20)
            for i in range(5)
        ]
        weights = learning.compute_weights(votes, NOW, CFG.learning)
        pool = [article(f"S{s}", i, hours_old=1) for s in range(20) for i in range(8)]
        pool += [article("Neuve", i, hours_old=30) for i in range(8)]
        picked = learning.pick(pool, weights, CFG, NOW)
        self.assertEqual(len(picked), 60)
        self.assertEqual(sum(1 for a in picked if a.feed == "Neuve"), 6)

    def test_part_minimale_par_categorie(self):
        # Catégorie « ia » très aimée, « securite » rejetée : 5 places restent à la sécurité
        votes = [
            vote(1, source=f"S{s}", category="ia", title=f"s{s} {i}")
            for s in range(10)
            for i in range(5)
        ]
        votes += [
            vote(-1, source=f"Secu{s}", category="securite", title=f"secu{s} {i}")
            for s in range(2)
            for i in range(5)
        ]
        weights = learning.compute_weights(votes, NOW, CFG.learning)
        pool = [article(f"S{s}", i) for s in range(10) for i in range(8)]
        for a in pool:
            a.category = "ia"
        secu = [article(f"Secu{s}", i) for s in range(2) for i in range(8)]
        for a in secu:
            a.category = "securite"
        picked = learning.pick(pool + secu, weights, CFG, NOW)
        self.assertEqual(len(picked), 60)
        self.assertEqual(sum(1 for a in picked if a.category == "securite"), 5)
        self.assertEqual([a.ref for a in picked], [f"c{i}" for i in range(1, 61)])

        limits = CFG.limits.model_copy(update={"candidates_per_category": 0})
        cfg = CFG.model_copy(update={"limits": limits})
        picked = learning.pick(pool + secu, weights, cfg, NOW)
        self.assertEqual(sum(1 for a in picked if a.category == "securite"), 0)

    def test_sans_vote_tout_explore(self):
        pool = [article("A", i, hours_old=i) for i in range(3)]
        self.assertEqual(len(learning.pick(pool, learning.Weights(), CFG, NOW)), 3)


class ReadVotes(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.path = self.dir / "veille.db"

    def test_base_absente_scores_neutres(self):
        votes = learning.read_votes(self.path, NOW, CFG.learning)
        self.assertEqual((votes.articles, votes.ideas), ([], []))
        self.assertIn("scores neutres", votes.warning)
        self.assertFalse(self.path.exists())

    def test_base_illisible(self):
        self.path.write_bytes(b"ceci n'est pas une base sqlite" * 100)
        votes = learning.read_votes(self.path, NOW, CFG.learning)
        self.assertEqual(votes.articles, [])
        self.assertIn("illisible", votes.warning)

    def test_table_absente(self):
        sqlite3.connect(self.path).close()
        self.assertIn(
            "illisible", learning.read_votes(self.path, NOW, CFG.learning).warning
        )

    def test_lecture_fenetre_et_tri(self):
        write_votes(
            self.path,
            [
                {
                    "target_id": "a" * 16,
                    "value": 1,
                    "title": "Récent",
                    "source": "AWS",
                    "voted_at": (NOW - timedelta(days=1)).isoformat(),
                },
                {
                    "target_id": "b" * 16,
                    "value": -1,
                    "title": "Ancien",
                    "voted_at": (NOW - timedelta(days=10)).isoformat(),
                },
                {
                    "target_id": "c" * 16,
                    "value": 1,
                    "title": "Trop vieux",
                    "voted_at": (NOW - timedelta(days=400)).isoformat(),
                },
                {
                    "kind": "idea",
                    "target_id": "d" * 16,
                    "value": -1,
                    "title": "Tableau de bord des coûts",
                    "voted_at": (NOW - timedelta(days=2)).isoformat(),
                },
            ],
        )
        votes = learning.read_votes(self.path, NOW, CFG.learning)
        self.assertIsNone(votes.warning)
        self.assertEqual([v.title for v in votes.articles], ["Récent", "Ancien"])
        self.assertEqual(votes.articles[0].source, "AWS")
        self.assertEqual(
            learning.rejected_idea_keys(votes),
            [("Tableau de bord des coûts", "tableau bord couts")],
        )
        self.assertEqual(
            [v.title for v in learning.examples(votes.articles, -1, 10)], ["Ancien"]
        )

    def test_lecture_seule(self):
        write_votes(self.path, [])
        before = self.path.stat().st_mtime_ns
        learning.read_votes(self.path, NOW, CFG.learning)
        self.assertEqual(self.path.stat().st_mtime_ns, before)
        self.assertFalse(self.path.with_name("veille.db-journal").exists())


if __name__ == "__main__":
    unittest.main()
