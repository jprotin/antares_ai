"""Base SQLite (store.py) : schéma, transaction unique, créneaux, purge, lecture seule."""

import sqlite3
import unittest
from datetime import timedelta
from typing import Any
from unittest import mock

from store import RunRecord
from tasks_testing import Env, utc

NOW = utc(2026, 11, 16, 12, 0)


def run(**overrides) -> RunRecord:
    values: dict[str, Any] = dict(
        day="2026-11-16",
        started_at=NOW,
        finished_at=NOW,
        status="done",
        items=[
            {"title": "t", "url": "https://ex.com/a", "source": "s", "sentence": "x"}
        ],
        ideas=[{"title": "Idée", "benefit": "b", "effort": "S", "first_step": "f"}],
        idea_keys=["idee"],
        shown_urls=["https://ex.com/a", "https://ex.com/b"],
        model="ollama/gemma4:e4b",
    )
    values.update(overrides)
    return RunRecord(**values)


class Schema(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.store = self.env.store()
        self.store.init(NOW)

    def test_creation_idempotente_wal_et_version(self):
        self.store.init(NOW + timedelta(days=1))
        conn = sqlite3.connect(self.env.db)
        self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], 4)
        self.assertEqual(
            conn.execute(
                "SELECT value FROM meta WHERE key = 'schema_items'"
            ).fetchone()[0],
            "2",
        )
        conn.close()
        # Premier démarrage gardé au second démarrage
        self.assertEqual(self.store.first_start(), NOW)

    def test_double_slot_key_refuse(self):
        key = "2026-11-16T13:00+01:00/veille"
        self.assertTrue(self.store.take_slot(key, "veille", "2026-11-16", NOW, NOW))
        other = self.env.store()  # second processus
        self.assertFalse(other.take_slot(key, "veille", "2026-11-16", NOW, NOW))
        self.assertFalse(other.mark_missed(key, "veille", "2026-11-16", NOW, NOW))

    def test_running_deja_present_refuse_et_failed_au_redemarrage(self):
        key = "2026-11-16T13:00+01:00/veille"
        self.store.take_slot(key, "veille", "2026-11-16", NOW, NOW)
        self.store.init(NOW + timedelta(minutes=5))  # arrêt brutal puis redémarrage
        self.assertEqual(
            self.store.slot_keys_since(NOW - timedelta(hours=1)), {key: "failed"}
        )
        self.assertFalse(self.store.take_slot(key, "veille", "2026-11-16", NOW, NOW))

    def test_passage_reussi_note_adresses_idees_et_creneau(self):
        key = "2026-11-16T13:00+01:00/veille"
        self.store.take_slot(key, "veille", "2026-11-16", NOW, NOW)
        run_id = self.store.record_run(run(slot_key=key, slot_at=NOW))
        self.assertEqual(
            self.store.seen(
                ["https://ex.com/a", "https://ex.com/b", "https://ex.com/c"]
            ),
            {"https://ex.com/a", "https://ex.com/b"},
        )
        self.assertEqual(
            self.store.past_ideas(30), [{"title": "Idée", "title_key": "idee"}]
        )
        self.assertEqual(self.store.idea_keys(), ["idee"])
        slots = self.store.slots_since(NOW - timedelta(hours=1))
        self.assertEqual((slots[0]["status"], slots[0]["run_id"]), ("done", run_id))

    def test_passage_en_echec_enregistre_sans_adresse(self):
        key = "2026-11-16T13:00+01:00/veille"
        self.store.take_slot(key, "veille", "2026-11-16", NOW, NOW)
        self.store.record_run(run(status="failed", slot_key=key, errors=["x"]))
        self.assertEqual(self.store.count("runs"), 1)
        self.assertEqual(self.store.count("seen_urls"), 0)
        self.assertEqual(self.store.count("ideas"), 0)
        self.assertEqual(
            self.store.slots_since(NOW - timedelta(hours=1))[0]["status"], "failed"
        )

    def test_echec_au_milieu_rien_enregistre(self):
        key = "2026-11-16T13:00+01:00/veille"
        self.store.take_slot(key, "veille", "2026-11-16", NOW, NOW)
        # Panne simulée à l'insertion des idées : clés de titre manquantes (zip strict)
        with self.assertRaises(ValueError):
            self.store.record_run(run(slot_key=key, idea_keys=[]))
        self.assertEqual(self.store.count("runs"), 0)
        self.assertEqual(self.store.count("seen_urls"), 0)
        self.assertEqual(
            self.store.slots_since(NOW - timedelta(hours=1))[0]["status"], "running"
        )

    def test_creneau_non_pris_refuse(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.record_run(run(slot_key="2026-11-16T18:00+01:00/veille"))
        self.assertEqual(self.store.count("runs"), 0)

    def test_adresse_deja_vue_reinseree(self):
        self.store.record_run(run())
        later = NOW + timedelta(hours=5)
        self.store.record_run(run(started_at=later, finished_at=later))
        conn = sqlite3.connect(self.env.db)
        first = conn.execute(
            "SELECT first_seen FROM seen_urls WHERE url = 'https://ex.com/a'"
        ).fetchone()[0]
        conn.close()
        self.assertEqual(first, "2026-11-16T12:00:00+00:00")

    def test_meteo_remplacee_a_chaque_passage(self):
        self.store.save_weather("2026-11-16", {"text": "matin"}, NOW)
        later = NOW + timedelta(hours=5)
        self.store.save_weather("2026-11-16", {"text": "soir"}, later)
        self.assertEqual(self.store.count("weather"), 1)
        stored = self.store.weather("2026-11-16")
        self.assertEqual(
            (stored["text"], stored["fetched_at"]),
            ("soir", "2026-11-16T17:00:00+00:00"),
        )

    def test_purge_30_jours_sans_toucher_seen_urls(self):
        old = NOW - timedelta(days=31)
        self.store.take_slot("old/veille", "veille", "2026-10-16", old, old)
        self.store.record_run(
            run(
                day="2026-10-16", started_at=old, finished_at=old, slot_key="old/veille"
            )
        )
        self.store.save_weather("2026-10-16", {"text": "x"}, old)
        self.store.record_run(run())
        self.store.purge(NOW, 30)
        self.assertEqual(self.store.count("runs"), 1)
        self.assertEqual(self.store.count("ideas"), 1)
        self.assertEqual(self.store.count("slots"), 0)
        self.assertEqual(self.store.count("weather"), 0)
        self.assertEqual(self.store.count("seen_urls"), 2)


class ReadOnly(unittest.TestCase):
    def test_base_absente(self):
        env = Env()
        store = env.store(readonly=True)
        self.assertEqual(store.seen(["https://ex.com/a"]), set())
        self.assertEqual(store.past_ideas(30), [])
        self.assertIsNone(store.weather("2026-11-16"))
        self.assertIsNone(store.last_success())
        self.assertFalse(env.db.exists())

    def test_aucune_ecriture_en_essai_a_blanc(self):
        env = Env()
        env.store().init(NOW)
        store = env.store(readonly=True)
        with mock.patch("sqlite3.connect", wraps=sqlite3.connect) as connect:
            store.seen(["https://ex.com/a"])
            store.past_ideas(30)
        for call in connect.call_args_list:
            self.assertIn("mode=ro", call.args[0])
        for write in (
            lambda: store.init(NOW),
            lambda: store.record_run(run()),
            lambda: store.save_weather("2026-11-16", {}, NOW),
            lambda: store.take_slot("k", "veille", "d", NOW, NOW),
        ):
            with self.assertRaises(PermissionError):
                write()

    def test_connexion_lecture_seule_refuse_l_ecriture(self):
        env = Env()
        env.store().init(NOW)
        conn = env.store(readonly=True).connect()
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("INSERT INTO meta VALUES ('x', 'y')")
        conn.close()


if __name__ == "__main__":
    unittest.main()
