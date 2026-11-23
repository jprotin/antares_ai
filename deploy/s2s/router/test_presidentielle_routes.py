"""Lecture de la base « Présidentielle 2027 » par le routeur (presidentielle.py) et routes
/api/presidentielle (presidentielle_api.py), sur une copie du jeu fictif dans un dossier
temporaire ; horodatage des tours vocaux dans router.relay().

python -m unittest test_presidentielle_routes (dans router/, cf. README).

Le routeur est importé au premier test, pas au chargement du module : dans la suite
complète, test_router_veille.py pose ses variables d'environnement avant de l'importer.
"""

import asyncio
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import mock

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle
import presidentielle_api
import presidentielle_schema as schema

FIXTURES = Path(__file__).parent / "fixtures" / "presidentielle"
DEMO = FIXTURES / "demo"
OWNER = "proprio@example.fr"
GUEST = {"x-antares-user": "invite@gmail.com", "x-forwarded-for": "203.0.113.5"}
OWNER_HEADERS = {
    "x-antares-user": "Proprio@Example.fr",
    "x-forwarded-for": "203.0.113.5",
}
BRUNO = "candidats/bruno-demonstra.yaml"
# Routes prévues par le plan sous /api/presidentielle (lots 1, 2, 4a et 4b)
ROUTES_DU_PLAN = {
    ("GET", "/api/presidentielle"),
    ("GET", "/api/presidentielle/meta"),
    ("GET", "/api/presidentielle/quiz"),
    ("POST", "/api/presidentielle/ask"),
    ("POST", "/api/presidentielle/index"),
    ("POST", "/api/presidentielle/extraire"),
    ("GET", "/api/presidentielle/nouveautes"),
}
# Noms publics de router.py avant la présidentielle (develop 21bdd6d) : aucun ne disparaît
NOMS_DU_ROUTEUR = """
BuiltinToggle ChatRequest DraftRequest FEATURES_PATH FavoriteToggle LivePhase
McpDraft OBSERVED_PATH PORT ProviderDraft REPO_ROOT SERVICES SETTINGS_PATH
SHARE_OWNER_EMAIL SHARING_FLAG SMOOTHING SaveRequest Settings SettingsUpdate
TASKS_CODE TASKS_CONFIG TagsRequest VEILLE_DB VOICES_CATALOG VOICES_LOCAL VOTES_DB
VeilleVoteBody agents_meta app ask_llm chat_models check_agent claude_available
clear_documents create_agent delete_agent delete_mcp delete_provider discuss_report
external_allowed fallback_model get_connections get_settings get_voices healthz
idea_prompt_model keep_code knowledge_delete knowledge_draft knowledge_list
knowledge_obsolete knowledge_save knowledge_similar last_turn list_agents
list_documents list_models list_modes list_projects load_observed load_settings
logger measure model_available net_state prepare rag_add_document rag_documents
rag_remove_document rag_remove_project record_observed refuse_guest_write
refuse_while_sharing rehearsal_create rehearsal_delete rehearsal_discussion
rehearsal_get rehearsal_live rehearsal_live_stop rehearsal_or_404 rehearsal_qa
rehearsal_report rehearsal_slide rehearsal_slides rehearsal_talk rehearsals_list
relay remove_document save_mcp save_provider save_service save_settings sharing
spoken_discussion start_watch test_mcp test_provider test_service to_native
turn_last update_agent update_settings upload_document usable_model
veille_access_info veille_day veille_idea_prompt veille_journal_start
veille_journal_state veille_journal_stop veille_latest veille_make_idea_prompt
veille_others veille_read_only veille_run_request veille_run_status veille_snapshot
veille_sources_add veille_sources_delete veille_sources_favorite
veille_sources_favorites veille_sources_list veille_sources_test
veille_sources_toggle veille_sources_update veille_statistics
veille_translate_article veille_translation veille_vote veille_votes_db
voice_catalog web_tags with_prefix written_chat
""".split()


def routeur():
    """Le module router, importé une fois ; seul (python -m unittest ce_fichier), ses
    réglages vont dans un dossier temporaire."""
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


def toutes_les_routes(routes) -> list:
    """Routes de l'application, y compris celles des routeurs inclus (FastAPI les garde
    dans un `_IncludedRouter`)."""
    found = []
    for route in routes:
        inclus = getattr(route, "original_router", None)
        found += toutes_les_routes(inclus.routes) if inclus is not None else [route]
    return found


class Base(unittest.TestCase):
    """Copie du jeu fictif servie par PRESIDENTIELLE_DIR."""

    def setUp(self):
        self.dossier = Path(tempfile.mkdtemp()) / "presidentielle"
        shutil.copytree(DEMO, self.dossier)
        self.addCleanup(shutil.rmtree, self.dossier.parent)
        env = mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": str(self.dossier)})
        env.start()
        self.addCleanup(env.stop)

    def modifier(self, rel: str, change) -> None:
        path = self.dossier / rel
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        change(data)
        path.write_text(
            yaml.safe_dump(
                data, explicit_start=True, sort_keys=False, allow_unicode=True
            ),
            encoding="utf-8",
        )


class Routes(Base):
    client: Any
    router: Any

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.router = routeur()
        cls.client = TestClient(cls.router.app)

    def setUp(self):
        super().setUp()
        router = self.router
        self.addCleanup(router.SHARING_FLAG.unlink, missing_ok=True)
        self.disponibles = {"ollama/gemma4:e4b"}
        self.reglages = router.Settings(voice="sohee", model="ollama/gemma4:e4b")

        async def available(name):
            return name in self.disponibles

        async def interdit(*args, **kwargs):
            raise AssertionError("aucun repli pour la présidentielle")

        for patch in (
            mock.patch.object(router, "model_available", available),
            mock.patch.object(router, "load_settings", lambda: self.reglages),
            mock.patch.object(router, "usable_model", interdit),
            mock.patch.object(router, "fallback_model", interdit),
            mock.patch.object(router, "SHARE_OWNER_EMAIL", OWNER),
            mock.patch.object(router, "TASKS_CONFIG", self.dossier / "absent.yaml"),
            mock.patch.dict(router.last_voice, {"at": 0.0}),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def get(self, path: str = "", headers=None) -> dict:
        response = self.client.get(f"/api/presidentielle{path}", headers=headers or {})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_lecture_base_publiee(self):
        body = self.get()
        self.assertEqual(body["jeu"], "demonstration")
        self.assertTrue(body["disponible"])
        self.assertRegex(body["version"], r"^[0-9a-f]{12}$")
        self.assertEqual(
            [c["id"] for c in body["candidats"]],
            ["aline-fictiva", "bruno-demonstra", "carla-exemplia", "gaston-fictorin"],
        )
        self.assertEqual(len(body["themes"]), 10)
        aline = body["candidats"][0]
        mesure = aline["mesures"][0]
        self.assertEqual(mesure["nature"], "candidat")
        self.assertEqual(mesure["source"]["niveau"], "candidat")
        self.assertTrue(mesure["source"]["url"].startswith("https://"))
        self.assertNotIn("a_verifier", mesure)
        self.assertEqual(aline["description"]["nature"], "redaction")
        self.assertEqual(aline["votes"][0]["source"]["niveau"], "vote_reel")
        self.assertEqual(body["candidats"][1]["lignes_phares"], [])
        self.assertEqual(body["candidats"][3]["statut"], "retire")
        dates = [e["date"] for e in body["journal"]]
        self.assertEqual(dates, sorted(dates, reverse=True))

    def test_lecture_seules_fiches_publiees(self):
        brouillons = self.dossier / "brouillons"
        brouillons.mkdir()
        brouillon = (self.dossier / BRUNO).read_text(encoding="utf-8")
        (brouillons / "zoe-brouillon.yaml").write_text(
            brouillon.replace("bruno-demonstra", "zoe-brouillon"), encoding="utf-8"
        )
        ids = [c["id"] for c in self.get()["candidats"]]
        self.assertNotIn("zoe-brouillon", ids)
        self.assertEqual(len(ids), 4)
        self.assertEqual(self.get("/meta")["erreurs"], [])

    def test_fiche_en_defaut_ecartee_autres_servies(self):
        self.modifier(BRUNO, lambda d: d.update(statut="pressenti"))
        ids = [c["id"] for c in self.get()["candidats"]]
        self.assertEqual(ids, ["aline-fictiva", "carla-exemplia", "gaston-fictorin"])
        erreurs = self.get("/meta")["erreurs"]
        self.assertEqual([e["fichier"] for e in erreurs], [BRUNO])
        # Ses rattachements sont écartés sans erreur de plus
        quiz = self.get("/quiz")
        self.assertNotIn(
            "bruno-demonstra", {r["candidat"] for r in quiz["rattachements"]}
        )

    def test_fiche_piegee_ecartee_autres_servies(self):
        shutil.copyfile(
            FIXTURES / "cas" / "fiche_cle_non_hashable.txt", self.dossier / BRUNO
        )
        ids = [c["id"] for c in self.get()["candidats"]]
        self.assertEqual(ids, ["aline-fictiva", "carla-exemplia", "gaston-fictorin"])
        self.assertEqual(len(self.get("/quiz")["themes"]), 10)
        erreurs = self.get("/meta")["erreurs"]
        self.assertEqual([e["fichier"] for e in erreurs], [BRUNO])
        self.assertIn("clé non hashable", erreurs[0]["message"])

    def test_journal_piege_erreur_nommee_sans_500(self):
        shutil.copyfile(
            FIXTURES / "cas" / "journal_imbrication_excessive.txt",
            self.dossier / "journal.yaml",
        )
        self.assertEqual(len(self.get()["candidats"]), 4)
        self.assertEqual(self.get()["journal"], [])
        self.assertFalse(self.get("/quiz")["disponible"])
        erreurs = self.get("/meta")["erreurs"]
        journal = [e for e in erreurs if e["fichier"] == "journal.yaml"]
        self.assertEqual(len(journal), 1)
        self.assertIn("structure refusée", journal[0]["message"])

    def test_erreurs_visibles_proprietaire_seulement(self):
        self.modifier(BRUNO, lambda d: d.update(statut="pressenti"))
        self.router.SHARING_FLAG.touch()
        for headers, guest in (({}, False), (OWNER_HEADERS, False), (GUEST, True)):
            with self.subTest(headers=headers):
                meta = self.get("/meta", headers)
                self.assertEqual(meta["guest"], guest)
                self.assertTrue(meta["sharing"])
                if guest:
                    self.assertNotIn("erreurs", meta)
                else:
                    self.assertEqual(len(meta["erreurs"]), 1)

    def test_invite_lecture_complete(self):
        self.router.SHARING_FLAG.touch()
        self.assertEqual(len(self.get("", GUEST)["candidats"]), 4)
        self.assertEqual(len(self.get("/quiz", GUEST)["themes"]), 10)
        self.assertTrue(self.get("/meta", GUEST)["guest"])
        # Sans partage, en-têtes du tunnel ou non : pas d'invité
        self.router.SHARING_FLAG.unlink()
        self.assertFalse(self.get("/meta", GUEST)["guest"])

    def test_meta(self):
        meta = self.get("/meta")
        for key in (
            "sharing",
            "guest",
            "appel_en_cours",
            "assistant",
            "cible",
            "jeu",
            "version",
            "phase",
        ):
            self.assertIn(key, meta)
        self.assertEqual(meta["jeu"], "demonstration")
        self.assertEqual(meta["fiches"], 4)
        self.assertEqual(meta["version"], self.get()["version"])

    def test_meta_appel_en_cours(self):
        self.assertFalse(self.get("/meta")["appel_en_cours"])
        self.router.last_voice["at"] = time.time() - 5
        self.assertTrue(self.get("/meta")["appel_en_cours"])
        self.router.last_voice["at"] = time.time() - 125
        self.assertFalse(self.get("/meta")["appel_en_cours"])
        # Délai des réglages des tâches
        config = self.dossier / "tasks.yaml"
        config.write_text("call:\n  idle_seconds: 300\n", encoding="utf-8")
        with mock.patch.object(self.router, "TASKS_CONFIG", config):
            self.assertTrue(self.get("/meta")["appel_en_cours"])
        # Un tour écrit seul (last_turn) ne compte pas
        self.router.last_voice["at"] = 0.0
        with mock.patch.dict(self.router.last_turn, {"at": time.time()}):
            self.assertFalse(self.get("/meta")["appel_en_cours"])

    def test_meta_modele_assistant(self):
        cas = (
            # (modèle des Réglages, modèles disponibles, attendu)
            ("ollama/gemma4:e4b", {"ollama/gemma4:e4b"}, "ollama/gemma4:e4b"),
            (
                "litellm-ai-to-boost/gemma4:e4b",
                {"litellm-ai-to-boost/gemma4:e4b", "ollama/gemma4:e4b"},
                "litellm-ai-to-boost/gemma4:e4b",
            ),
            (
                "claude:sonnet",
                {"claude:sonnet", "ollama/gemma4:e4b"},
                "ollama/gemma4:e4b",
            ),
            (
                "litellm-ai-to-boost/olala-mini",
                {"litellm-ai-to-boost/olala-mini"},
                None,
            ),
            ("ollama/gemma4:e4b-long", {"ollama/gemma4:e4b-long"}, None),
            ("ollama/gemma4:e4b", set(), None),
        )
        for choisi, disponibles, attendu in cas:
            with self.subTest(choisi=choisi):
                self.reglages = self.router.Settings(voice="sohee", model=choisi)
                self.disponibles = disponibles
                assistant = self.get("/meta")["assistant"]
                self.assertEqual(assistant["modele"], attendu)
                self.assertEqual(
                    assistant["modeles_autorises"], schema.MODELES_PAR_DEFAUT
                )
                if attendu is None:
                    self.assertIn(
                        assistant["message"],
                        (
                            presidentielle_api.MODELE_REFUSE,
                            presidentielle_api.AUCUN_MODELE,
                        ),
                    )
                else:
                    self.assertIsNone(assistant["message"])
        self.reglages = self.router.Settings(voice="sohee", model="olala-mini")
        self.disponibles = set()
        message = self.get("/meta")["assistant"]["message"]
        self.assertEqual(message, presidentielle_api.MODELE_REFUSE)

    def test_cible_cloud(self):
        for valeur, attendu in (
            ("cloud", "cloud"),
            (" Cloud ", "cloud"),
            ("local", "local"),
        ):
            with mock.patch.dict(os.environ, {"ANTARES_TARGET": valeur}):
                self.assertEqual(self.get("/meta")["cible"], attendu)
        with mock.patch.dict(os.environ):
            os.environ.pop("ANTARES_TARGET", None)
            self.assertEqual(self.get("/meta")["cible"], "local")

    def test_quiz(self):
        quiz = self.get("/quiz")
        self.assertTrue(quiz["disponible"])
        self.assertTrue(quiz["barres_visibles"])
        self.assertRegex(quiz["grille_version"], r"^[0-9a-f]{12}$")
        self.assertEqual(
            quiz["participants"], ["aline-fictiva", "bruno-demonstra", "carla-exemplia"]
        )
        eligibles = [
            q["id"] for t in quiz["themes"] for q in t["questions"] if q["eligible"]
        ]
        self.assertEqual(eligibles, ["economie-1", "sante-1", "ecologie-1"])
        question = quiz["themes"][0]["questions"][0]
        self.assertEqual(
            [o["id"] for o in question["options"] if o["speciale"]],
            ["aucune", "sans-avis"],
        )
        self.assertEqual(
            question["couverture"],
            {"participants": 3, "positions": 3, "options_occupees": 3},
        )
        self.assertEqual(len(quiz["rattachements"]), 17)

    def test_quiz_question_brouillon_non_eligible(self):
        empreinte = {}

        def brouillon(d):
            d["themes"][0]["questions"][0]["statut"] = "brouillon"
            empreinte["v"] = d["gel"]["empreinte"] = schema.empreinte_grille(
                schema.Grille.model_validate(d)
            )

        def regel(d):
            for entree in d["entrees"]:
                if entree["objet"] == "gel_grille":
                    entree["empreinte"] = empreinte["v"]

        self.modifier("quiz/grille.yaml", brouillon)
        self.modifier("journal.yaml", regel)
        question = self.get("/quiz")["themes"][0]["questions"][0]
        self.assertFalse(question["eligible"])

    def test_dossier_absent_ou_vide(self):
        for dossier in (self.dossier / "absent", self.dossier / "vide"):
            with self.subTest(dossier=dossier.name):
                if dossier.name == "vide":
                    dossier.mkdir()
                with mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": str(dossier)}):
                    body = self.get()
                    self.assertFalse(body["disponible"])
                    self.assertTrue(body["message"])
                    self.assertEqual(body["candidats"], [])
                    self.assertFalse(self.get("/quiz")["disponible"])
                    meta = self.get("/meta")
                    self.assertIsNone(meta["assistant"]["modele"])
                    self.assertEqual(meta["fiches"], 0)

    def test_inventaire_des_routes(self):
        routes = {
            (method, route.path)
            for route in toutes_les_routes(self.router.app.routes)
            if getattr(route, "path", "").startswith("/api/presidentielle")
            for method in getattr(route, "methods", None) or set()
        }
        self.assertTrue(routes <= ROUTES_DU_PLAN, routes - ROUTES_DU_PLAN)
        self.assertTrue(
            {
                ("GET", "/api/presidentielle"),
                ("GET", "/api/presidentielle/meta"),
                ("GET", "/api/presidentielle/quiz"),
            }
            <= routes
        )
        self.assertFalse(
            {m for m, p in routes if p.endswith("/quiz")} - {"GET", "HEAD"}
        )

    def test_quiz_ecriture_405(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with self.subTest(method=method):
                response = self.client.request(
                    method, "/api/presidentielle/quiz", json={"reponses": [1]}
                )
                self.assertEqual(response.status_code, 405)
        self.assertEqual(self.client.post("/api/presidentielle").status_code, 405)

    def test_aucune_fonction_retiree_de_router(self):
        manquants = [n for n in NOMS_DU_ROUTEUR if not hasattr(self.router, n)]
        self.assertEqual(manquants, [])


class Lecture(Base):
    def charger(self) -> presidentielle.Etat:
        return presidentielle.charger(self.dossier)

    def test_repli_sur_le_jeu_fictif(self):
        with mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": ""}):
            self.assertEqual(presidentielle.dossier(), presidentielle.DEMO)
        self.assertEqual(presidentielle.dossier(), self.dossier)

    def test_version_base_stable(self):
        premiere = self.charger().version
        self.assertRegex(premiere, r"^[0-9a-f]{12}$")
        self.assertEqual(self.charger().version, premiere)
        noms = presidentielle.fichiers_publies(self.dossier)
        self.assertEqual(presidentielle.version_de(self.dossier, noms[::-1]), premiere)
        scandir = os.scandir
        with mock.patch.object(
            presidentielle.os,
            "scandir",
            lambda path: sorted(scandir(path), key=lambda e: e.name, reverse=True),
        ):
            self.assertEqual(
                presidentielle.version_de(
                    self.dossier, presidentielle.fichiers_publies(self.dossier)
                ),
                premiere,
            )

    def test_version_base_change_avec_un_fichier_publie(self):
        avant = self.charger().version
        brouillons = self.dossier / "brouillons"
        brouillons.mkdir()
        (brouillons / "x.yaml").write_text("id: x\n", encoding="utf-8")
        self.assertEqual(self.charger().version, avant)
        self.modifier(BRUNO, lambda d: d.update(version=2))
        self.assertNotEqual(self.charger().version, avant)

    def test_cache_relu_apres_modification(self):
        path = self.dossier / BRUNO
        self.assertEqual(self.charger().fiches["bruno-demonstra"].version, 1)
        self.assertIs(self.charger(), self.charger())
        texte = path.read_text(encoding="utf-8")
        self.assertIn("\nversion: 1\n", texte)
        stat = path.stat()
        path.write_text(
            texte.replace("\nversion: 1\n", "\nversion: 3\n"), encoding="utf-8"
        )
        self.assertEqual(path.stat().st_size, stat.st_size)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000))
        self.assertEqual(self.charger().fiches["bruno-demonstra"].version, 3)

    def test_base_yaml_en_defaut_base_non_servie(self):
        self.modifier("base.yaml", lambda d: d.update(jeu="inconnu"))
        etat = self.charger()
        self.assertIsNone(etat.base)
        self.assertEqual(etat.fiches, {})
        self.assertTrue(etat.message)
        self.assertEqual(etat.erreurs[0].fichier, "base.yaml")


def etat(
    statuts: dict[str, str], positions: list[tuple[str, str]]
) -> presidentielle.Etat:
    """État minimal : candidats et leurs statuts, positions (candidat, option) sur q1."""
    fiches: Any = {s: SimpleNamespace(statut=v) for s, v in statuts.items()}
    rattachements: Any = [
        SimpleNamespace(question="q1", candidat=c, option=o) for c, o in positions
    ]
    return presidentielle.Etat(
        Path("/inexistant"), fiches=fiches, rattachements=rattachements
    )


class Couverture(unittest.TestCase):
    QUATRE = {"a": "declare", "b": "declare", "c": "officiel", "d": "declare"}

    def eligible(self, statuts, positions) -> bool:
        return presidentielle.couverture(etat(statuts, positions), "q1")["eligible"]

    def test_couverture_question(self):
        self.assertFalse(self.eligible(self.QUATRE, [("a", "x")]))
        self.assertTrue(self.eligible(self.QUATRE, [("a", "x"), ("b", "y")]))
        # Deux positions sur la même option : une seule option occupée
        self.assertFalse(self.eligible(self.QUATRE, [("a", "x"), ("b", "x")]))
        self.assertTrue(
            self.eligible(self.QUATRE, [("a", "x"), ("b", "x"), ("c", "y")])
        )

    def test_couverture_nombre_impair(self):
        trois = {"a": "declare", "b": "declare", "c": "declare"}
        self.assertFalse(self.eligible(trois, [("a", "x")]))
        self.assertTrue(self.eligible(trois, [("a", "x"), ("b", "y")]))

    def test_couverture_ignore_retires(self):
        statuts = {
            "a": "declare",
            "b": "declare",
            "r1": "retire",
            "r2": "non_qualifie",
        }
        self.assertFalse(self.eligible(statuts, [("r1", "x"), ("r2", "y")]))
        couverture = presidentielle.couverture(
            etat(statuts, [("r1", "x"), ("r2", "y"), ("a", "x")]), "q1"
        )
        self.assertEqual(
            couverture,
            {
                "participants": 2,
                "positions": 1,
                "options_occupees": 1,
                "eligible": False,
            },
        )

    def test_couverture_sans_participant(self):
        self.assertFalse(self.eligible({"r": "retire"}, [("r", "x")]))
        self.assertFalse(self.eligible({}, []))


class FakeUpstream:
    status_code = 200

    async def aiter_raw(self):
        yield b"data: [DONE]\n\n"

    async def aclose(self):
        return None


class TourVocal(unittest.TestCase):
    """last_voice : posé par le relais vocal, jamais par la conversation écrite."""

    client: Any
    router: Any

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.router = routeur()
        cls.client = TestClient(cls.router.app)

    def setUp(self):
        router = self.router

        async def open_stream(model, payload, native_ctx=None):
            return FakeUpstream()

        async def prepare(messages, settings, spoken=True):
            return messages, "ollama/gemma4:e4b", {"prefix": ""}

        self.prepare = prepare
        for patch in (
            mock.patch.object(router.providers, "open_stream", open_stream),
            mock.patch.object(router.veille_journal, "active", lambda: False),
            mock.patch.object(
                router.veille_journal, "journal_asked", lambda said: False
            ),
            mock.patch.object(router.rehearsal, "phase", lambda: None),
            mock.patch.dict(router.last_voice, {"at": 0.0}),
            mock.patch.dict(router.last_turn, {"at": 0.0}),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def test_relay_date_le_tour_vocal(self):
        with mock.patch.object(self.router, "prepare", self.prepare):
            avant = time.time()
            response = self.client.post(
                "/v1/chat/completions",
                json={
                    "model": "x",
                    "messages": [{"role": "user", "content": "Bonjour"}],
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(self.router.last_voice["at"], avant)
        # Les autres chemins du relais ne datent rien
        self.router.last_voice["at"] = 0.0
        self.assertEqual(self.client.post("/v1/embeddings", json={}).status_code, 404)
        self.assertEqual(self.router.last_voice["at"], 0.0)

    def test_prepare_ne_date_pas_la_voix(self):
        router = self.router

        async def usable(model, settings, local_only=False):
            return "ollama/gemma4:e4b"

        async def augment(messages, project, spoken=True):
            return messages

        with (
            mock.patch.object(router, "usable_model", usable),
            mock.patch.object(router.rag, "augment", augment),
            mock.patch.object(router, "veille_snapshot", lambda: {"run": None}),
            mock.patch.object(router.veille_journal, "wanted", lambda *a: False),
            mock.patch.object(router.web, "wanted", lambda asked: False),
        ):
            asyncio.run(
                router.prepare(
                    [{"role": "user", "content": "Bonjour"}],
                    router.Settings(voice="sohee"),
                    spoken=False,
                )
            )
        self.assertGreater(router.last_turn["at"], 0.0)
        self.assertEqual(router.last_voice["at"], 0.0)


if __name__ == "__main__":
    unittest.main()
