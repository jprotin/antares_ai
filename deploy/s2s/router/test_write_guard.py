"""Garde des écritures sur /api/ (write_guard.py, audit 2026-11 point 3) :
python -m unittest test_write_guard (dans router/, cf. README).

Règles seules (`refusal`), puis à travers l'application du routeur : une écriture admise
atteint la route (422 sur un corps vide, pas 403), une écriture refusée s'arrête au garde.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

import write_guard

LOCAL = "http://127.0.0.1:8765"
SHARE = "https://abcd-1234.ngrok-free.app"
UI = {"x-antares": "1"}
TUNNEL = {"x-antares-user": "invite@gmail.com", "x-antares-origin": SHARE}


def routeur():
    """Le module router, importé une fois ; seul, ses réglages vont dans un dossier
    temporaire (comme test_presidentielle_routes.py)."""
    if "router" not in sys.modules:
        data = Path(tempfile.mkdtemp())
        os.environ["SETTINGS_PATH"] = str(data / "settings.json")
        os.environ["TASKS_CONFIG"] = str(data / "tasks.yaml")
        os.environ["FEATURES_PATH"] = str(data / "FEATURES.md")
        os.environ["VOICES_CATALOG"] = str(data / "voices.json")
        (data / "voices.json").write_text(
            '{"default": "sohee", "voices": []}', encoding="utf-8"
        )
        os.environ.pop("TASKS_DB", None)
        os.environ.pop("VOTES_DB", None)
    import router

    return router


class Rules(unittest.TestCase):
    def refused(self, headers, method="POST", path="/api/settings"):
        return write_guard.refusal(method, path, headers)

    def test_interface_locale_admise(self):
        for origin in (LOCAL, "http://localhost:8765"):
            with self.subTest(origin=origin):
                self.assertIsNone(
                    self.refused(
                        {**UI, "origin": origin, "sec-fetch-site": "same-origin"}
                    )
                )

    def test_sans_origin_admis_avec_en_tete(self):
        # curl, rag-index.sh : pas d'Origin, en-tête ajouté
        self.assertIsNone(self.refused(UI))

    def test_toutes_les_methodes_d_ecriture_controlees(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "post"):
            with self.subTest(method=method):
                self.assertIn("X-Antares", self.refused({}, method=method))

    def test_en_tete_x_antares_manquant_ou_faux(self):
        for headers in ({}, {"origin": LOCAL}, {"x-antares": "0"}, {"x-antares": ""}):
            with self.subTest(headers=headers):
                self.assertIn("X-Antares", self.refused(headers))

    def test_origine_etrangere_refusee(self):
        for origin in (
            "https://piege.example",
            "http://127.0.0.1:5173",
            "http://127.0.0.1",
            "null",
            "http://rebind.example:8765",
        ):
            with self.subTest(origin=origin):
                reason = self.refused({**UI, "origin": origin})
                self.assertIn("origine non autorisée", reason)

    def test_cross_site_refuse_meme_avec_en_tete(self):
        reason = self.refused({**UI, "origin": LOCAL, "sec-fetch-site": "cross-site"})
        self.assertIn("autre site", reason)
        self.assertIsNone(self.refused({**UI, "sec-fetch-site": "same-site"}))

    def test_origine_du_partage_admise(self):
        self.assertIsNone(
            self.refused(
                {**UI, **TUNNEL, "origin": SHARE, "sec-fetch-site": "same-origin"}
            )
        )
        # Casse indifférente (hôte écrit par ngrok)
        self.assertIsNone(self.refused({**UI, **TUNNEL, "origin": SHARE.upper()}))

    def test_origine_du_partage_ignoree_sans_x_antares_user(self):
        headers = {**UI, "x-antares-origin": SHARE, "origin": SHARE}
        self.assertIn("origine non autorisée", self.refused(headers))
        self.assertIn(
            "origine non autorisée",
            self.refused({**headers, "x-antares-user": "  "}),
        )

    def test_partage_n_admet_pas_une_autre_origine(self):
        headers = {**UI, **TUNNEL, "origin": "https://autre.ngrok-free.app"}
        self.assertIn("origine non autorisée", self.refused(headers))

    def test_lectures_et_hors_api_non_controlees(self):
        hostile = {"origin": "https://piege.example", "sec-fetch-site": "cross-site"}
        for method in ("GET", "HEAD", "OPTIONS"):
            with self.subTest(method=method):
                self.assertIsNone(self.refused(hostile, method=method))
        for path in ("/v1/chat/completions", "/healthz", "/apix"):
            with self.subTest(path=path):
                self.assertIsNone(self.refused(hostile, path=path))


class ThroughRouter(unittest.TestCase):
    """Garde branché sur l'application : 403 avant la route, ou route atteinte."""

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.client = TestClient(routeur().app)

    def vote(self, headers):
        return self.client.post("/api/veille/vote", json={}, headers=headers)

    def test_ecriture_admise_atteint_la_route(self):
        for headers in (
            UI,
            {**UI, "origin": LOCAL, "sec-fetch-site": "same-origin"},
            {**UI, **TUNNEL, "origin": SHARE},
        ):
            with self.subTest(headers=headers):
                self.assertEqual(self.vote(headers).status_code, 422)

    def test_ecriture_refusee_avec_message(self):
        for headers, motif in (
            ({}, "X-Antares"),
            ({**UI, "origin": "https://piege.example"}, "origine non autorisée"),
            ({**UI, "sec-fetch-site": "cross-site"}, "autre site"),
            (
                {**UI, "x-antares-origin": SHARE, "origin": SHARE},
                "origine non autorisée",
            ),
        ):
            with self.subTest(headers=headers):
                response = self.vote(headers)
                self.assertEqual(response.status_code, 403)
                self.assertIn(motif, response.json()["detail"])

    def test_suppression_et_modification_refusees_sans_en_tete(self):
        self.assertEqual(self.client.delete("/api/documents").status_code, 403)
        self.assertEqual(self.client.put("/api/settings", json={}).status_code, 403)

    def test_lectures_non_bloquees(self):
        hostile = {"origin": "https://piege.example", "sec-fetch-site": "cross-site"}
        self.assertEqual(self.client.get("/healthz", headers=hostile).status_code, 200)
        self.assertEqual(
            self.client.get("/api/veille/access", headers=hostile).status_code, 200
        )


if __name__ == "__main__":
    unittest.main()
