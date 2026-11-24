"""Assistant de la présidentielle (presidentielle_assistant.py, POST /api/presidentielle/ask),
modèle simulé, sur une copie du jeu fictif : liste blanche, refus de vote, attribution,
ordre reçu, mise en attente pendant un appel vocal, journaux et confidentialité.

python -m unittest test_presidentielle_assistant (dans router/, cf. README).
"""

import asyncio
import io
import json
import logging
import random
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any
from unittest import mock

import presidentielle
import presidentielle_api
import presidentielle_assistant as assistant
import presidentielle_index as index
from test_presidentielle_routes import GUEST, OWNER, Base, routeur

ALINE, BRUNO, CARLA, GASTON = (
    "aline-fictiva",
    "bruno-demonstra",
    "carla-exemplia",
    "gaston-fictorin",
)
PARTICIPANTS = [ALINE, BRUNO, CARLA]
ORDRE = [CARLA, GASTON, ALINE, BRUNO]
QUESTIONS_DE_VOTE = [
    "Pour qui voter ?",
    "pour qui je dois voter en 2027",
    "Qui est le meilleur candidat ?",
    "Qui va gagner l'élection ?",
    "Que disent les sondages ?",
    "QUE DISENT LES SONDAGES",
    "pour qui voter ? qui est le meilleur candidat ? qui va gagner",
    "Pour qui dois-je voter ?",
    "Quel candidat choisir ?",
    "Qui est le favori de la présidentielle ?",
    "Donnez-moi un classement des candidats",
    "Qui a le plus de chances de gagner ?",
    "Qui est le plus crédible sur l'économie ?",
    "Quelle est votre consigne de vote ?",
    "Qui sera élu président ?",
    # Relevées par la revue de code
    "Quel candidat est le meilleur sur l'écologie ?",
    "Dois-je voter Dupont ?",
    "Faut-il voter Dupont ?",
    "Qui est en tête ?",
    "Qui sera président ?",
    "Qui va remporter l'élection ?",
    "Quel est le programme le plus réaliste ?",
    "Lequel est le plus convaincant ?",
    "Dupont ou Martin, lequel choisir ?",
]
# Faux refus relevés par la revue de code : jamais refusés
FAUX_REFUS_EVITES = [
    "Que proposent les candidats contre les pesticides les plus dangereux ?",
    "Que proposent-ils pour les métiers les plus dangereux ?",
    "Et pour les quartiers les plus populaires ?",
    "Quelles sont les prévisions de déficit ?",
    "Que proposent-ils pour encadrer les sondages ?",
    "Que disent-ils du classement des universités ?",
    "Qui propose le meilleur choix pour les retraites ?",
    "Faut-il voter à 16 ans ?",
    "Qui propose le plus de logements ?",
    "Qui veut faire voter des lois sur le climat ?",
]
# Jeu de contrôle (règle à trancher n° 3) : questions légitimes, jamais refusées
QUESTIONS_LEGITIMES = [
    "Que proposent-ils sur le droit de vote à 16 ans ?",
    "Qui propose un meilleur accès aux soins ?",
    "Que disent-ils du vote obligatoire ?",
    "Le vote des étrangers aux élections locales est-il proposé ?",
    "Qui veut une meilleure rémunération des enseignants ?",
    "Que proposent-ils pour le vote par correspondance ?",
    "Quelles mesures pour les classes de primaire ?",
    "Qui veut reconnaître le vote blanc ?",
    "Comment voter par procuration ?",
    "Que proposent-ils pour améliorer le pouvoir d'achat ?",
]


def etat_demo(dossier: Path) -> presidentielle.Etat:
    return presidentielle.relire(dossier)


class Logique(Base):
    """Fonctions pures de l'assistant, sans route ni modèle."""

    def setUp(self):
        super().setUp()
        self.etat = etat_demo(self.dossier)

    def test_vote_refuse_sans_modele(self):
        for question in QUESTIONS_DE_VOTE:
            with self.subTest(question=question):
                self.assertTrue(assistant.refuse(question))
                plan = assistant.planifier(self.etat, question, ORDRE)
                self.assertIsNotNone(plan.reponse)
                self.assertEqual(plan.reponse.kind, "refus")
                self.assertEqual(plan.reponse.introduction, assistant.REFUS)
                self.assertEqual(plan.reponse.passages, [])
        # Sans accents, en majuscules, apostrophe typographique
        for question in ("POUR QUI VOTER", "qui va l’emporter ?", "Qui sera élue ?"):
            with self.subTest(question=question):
                self.assertTrue(assistant.refuse(question))

    def test_question_legitime_non_refusee(self):
        self.assertEqual(len(QUESTIONS_LEGITIMES), 10)
        for question in QUESTIONS_LEGITIMES + FAUX_REFUS_EVITES:
            with self.subTest(question=question):
                self.assertFalse(assistant.refuse(question))
                plan = assistant.planifier(self.etat, question, ORDRE)
                kind = plan.reponse.kind if plan.reponse else "recherche"
                self.assertNotEqual(kind, "refus")

    def test_fiche_candidat_theme(self):
        plan = assistant.planifier(
            self.etat, "Que propose Aline Fictiva sur la santé ?", ORDRE
        )
        reponse = plan.reponse
        self.assertEqual(reponse.kind, "fiche")
        self.assertEqual(
            reponse.introduction,
            "Voici les passages relus qui portent sur le thème Santé.",
        )
        self.assertEqual([p["candidat"] for p in reponse.passages], [ALINE])
        self.assertEqual(
            reponse.passages[0]["citation"],
            self.etat.fiches[ALINE].mesures[2].citation,
        )
        self.assertEqual(reponse.passages[0]["source"]["id"], "aline-programme")
        self.assertIsNone(reponse.model)

    def test_themes_hors_quiz_reconnus(self):
        # Thèmes des fiches hors quiz (ADR 0016) : libellé de référence, mots-clés
        for question, theme, mesure in (
            (
                "Que propose Aline Fictiva pour les musées ?",
                "culture",
                "culture-musees",
            ),
            (
                "Que propose Aline Fictiva sur le patrimoine culturel et le sport ?",
                "culture",
                "culture-musees",
            ),
            (
                "Que propose Aline Fictiva pour les aidants ?",
                "solidarites",
                "solidarites-aidants",
            ),
            (
                "Que propose Aline Fictiva sur les proches aidants ?",
                "solidarites",
                "solidarites-aidants",
            ),
        ):
            with self.subTest(question=question):
                self.assertEqual(assistant.themes_cites(self.etat, question), [theme])
                reponse = assistant.planifier(self.etat, question, ORDRE).reponse
                self.assertEqual(reponse.kind, "fiche")
                self.assertEqual([p["mesure"] for p in reponse.passages], [mesure])
                self.assertEqual(
                    reponse.passages[0]["theme_libelle"],
                    presidentielle.THEMES_REFERENCE[theme][0],
                )
        # Mots à double sens : jamais pris pour un thème hors quiz
        for question, attendus in (
            ("Que proposent-ils pour taxer le patrimoine ?", []),
            ("Quel impôt sur le patrimoine ?", ["economie"]),
            ("Comment réduire la dépendance énergétique de la France ?", []),
            ("Que proposent-ils en aidant les PME ?", []),
            ("Quelles armes livrées à l'Ukraine ?", []),
            ("Association de malfaiteurs et prison", ["securite"]),
        ):
            with self.subTest(question=question):
                cites = assistant.themes_cites(self.etat, question)
                self.assertFalse(set(cites) & set(presidentielle.THEMES_HORS_QUIZ))
                if attendus:
                    self.assertEqual(cites, attendus)
        for question in (
            "Quelle politique culturelle ?",
            "Que proposent-ils pour les allocations familiales ?",
        ):
            with self.subTest(question=question):
                self.assertNotEqual(assistant.themes_cites(self.etat, question), [])
        reponse = assistant.planifier(
            self.etat, "Que proposent-ils pour la famille ?", ORDRE
        ).reponse
        self.assertEqual(reponse.kind, "theme")
        self.assertEqual([p["candidat"] for p in reponse.passages], [ALINE])
        self.assertEqual([s["candidat"] for s in reponse.sans_position], [CARLA, BRUNO])

    def test_fiche_theme_vide(self):
        reponse = assistant.planifier(
            self.etat, "Que propose Carla Exemplia sur l'écologie ?", ORDRE
        ).reponse
        self.assertEqual(reponse.kind, "fiche")
        self.assertEqual(reponse.passages, [])
        self.assertEqual(
            reponse.sans_position,
            [
                {
                    "candidat": CARLA,
                    "nom": "Carla Exemplia",
                    "texte": assistant.PAS_DE_POSITION,
                }
            ],
        )
        self.assertEqual(assistant.PAS_DE_POSITION, "Pas de position connue à ce jour")

    def test_theme_seul_tous_candidats(self):
        reponse = assistant.planifier(
            self.etat, "Que proposent-ils sur le logement ?", ORDRE
        ).reponse
        self.assertEqual(reponse.kind, "theme")
        self.assertEqual([p["candidat"] for p in reponse.passages], [BRUNO])
        # Tous les participants, ceux sans position compris, dans l'ordre reçu ; le
        # candidat retiré n'en fait pas partie
        self.assertEqual([s["candidat"] for s in reponse.sans_position], [CARLA, ALINE])
        sante = assistant.planifier(self.etat, "et la santé ?", ORDRE).reponse
        self.assertEqual([p["candidat"] for p in sante.passages], [CARLA, ALINE, BRUNO])
        autre = assistant.planifier(
            self.etat, "et la santé ?", [BRUNO, ALINE, CARLA]
        ).reponse
        self.assertEqual([p["candidat"] for p in autre.passages], [BRUNO, ALINE, CARLA])

    def test_ordre_recu_verifie(self):
        self.assertTrue(assistant.ordre_valide(self.etat, ORDRE))
        self.assertTrue(assistant.ordre_valide(self.etat, [BRUNO, ALINE, CARLA]))
        for ordre in (
            [ALINE, BRUNO],
            [ALINE, BRUNO, CARLA, "inconnu"],
            [ALINE, BRUNO, CARLA, ALINE],
            "aline-fictiva",
            [ALINE, BRUNO, 3],
            [],
        ):
            with self.subTest(ordre=ordre):
                self.assertFalse(assistant.ordre_valide(self.etat, ordre))
                tire = assistant.ordre_retenu(self.etat, ordre, random.Random(4))
                self.assertEqual(sorted(tire), sorted(self.etat.fiches))
        # Ordre tiré par le routeur : varie d'un tirage à l'autre
        tirages = {
            tuple(assistant.ordre_retenu(self.etat, [], random.Random(graine)))
            for graine in range(30)
        }
        self.assertGreater(len(tirages), 5)

    def test_candidat_repere_par_alias_initiales(self):
        cas = {
            "Que propose A. Fictiva ?": [ALINE],
            "que propose fictiva": [ALINE],
            "Et AF sur l'impôt ?": [ALINE],
            "et af sur l'impot": [],
            "bruno demonstra": [BRUNO],
            "Que dit Démonstra ?": [BRUNO],
            "carla exemplia et bruno démonstra": [BRUNO, CARLA],
            "Fictivaland": [],
        }
        for question, attendu in cas.items():
            with self.subTest(question=question):
                self.assertEqual(
                    assistant.candidats_cites(self.etat, question), attendu
                )

        # Deux candidats du même nom de famille : tous deux, traités comme plusieurs
        def homonyme(data):
            data["nom_affiche"] = "Bruno Fictiva"

        self.modifier("candidats/bruno-demonstra.yaml", homonyme)
        etat = etat_demo(self.dossier)
        self.assertEqual(
            assistant.candidats_cites(etat, "que dit Fictiva"), [ALINE, BRUNO]
        )
        reponse = assistant.planifier(
            etat, "que dit Fictiva sur la santé", ORDRE
        ).reponse
        self.assertEqual(reponse.kind, "theme")
        self.assertEqual([p["candidat"] for p in reponse.passages], [ALINE, BRUNO])

    def test_themes_par_mots_cles_et_pluriels(self):
        self.assertEqual(assistant.themes_cites(self.etat, "les médecins"), ["sante"])
        self.assertEqual(assistant.themes_cites(self.etat, "EDUCATION"), ["education"])
        self.assertEqual(assistant.themes_cites(self.etat, "les loyers"), ["logement"])
        self.assertEqual(assistant.themes_cites(self.etat, "la météo"), [])

    def test_ordre_tire_departage_les_egalites(self):
        # « impôt » : un mot commun pour chaque candidat ; l'ordre tiré décide, jamais
        # l'alphabet
        for ordre in (ORDRE, list(reversed(ORDRE))):
            found = index.rechercher_par_mots(self.etat, "impôt", PARTICIPANTS, ordre)
            vus = list(dict.fromkeys(p.candidat for p in found))
            self.assertEqual(vus, [c for c in ordre if c in vus])
            self.assertEqual(len(vus), 3)

    def test_reponse_vide_du_modele(self):
        trouves = index.passages(self.etat, [ALINE])
        for brut in (None, 3, {"passages": []}):
            self.assertEqual(assistant.identifiants_choisis(brut, trouves), [])  # type: ignore[arg-type]

    def test_candidat_retire_nomme_ajoute_a_l_ordre(self):
        reponse = assistant.planifier(
            self.etat,
            "Que propose Gaston Fictorin sur l'écologie ?",
            [BRUNO, ALINE, CARLA],
        ).reponse
        self.assertEqual(reponse.json(self.etat)["ordre"][-1], GASTON)
        self.assertEqual([p["candidat"] for p in reponse.passages], [GASTON])

    def test_identifiant_invente_ou_malforme_retire(self):
        trouves = index.passages(self.etat, [ALINE])[:2]
        bons = [p.id for p in trouves]
        for brut in (
            json.dumps({"passages": ["p27:aline-fictiva:m99", *bons]}),
            json.dumps({"passages": ["p27:../x", "p27:aline-fictiva", bons[0],
                                     "p27:aline-fictiva:eco-impot:x", 5, None, bons[1]]}),
            "Voici : " + json.dumps({"passages": bons}) + " Votez pour A",
            json.dumps({"passages": bons, "avis": "Votez pour A"}),
        ):  # fmt: skip
            with self.subTest(brut=brut[:50]):
                self.assertEqual(assistant.identifiants_choisis(brut, trouves), bons)
        # Identifiant valide mais absent des passages retrouvés
        autre = index.doc_id(BRUNO, "eco-impot")
        brut = json.dumps({"passages": [autre]})
        self.assertEqual(assistant.identifiants_choisis(brut, trouves), [])
        for brut in ("", "pas du json", "[]", '{"passages": "p27:a:b"}', "{"):
            self.assertEqual(assistant.identifiants_choisis(brut, trouves), [])

    def test_deux_passages_par_candidat_au_plus(self):
        tous = index.passages(self.etat)
        bornes = index.borner(tous)
        compte: dict[str, int] = {}
        for p in bornes:
            compte[p.candidat] = compte.get(p.candidat, 0) + 1
        self.assertTrue(all(n <= 2 for n in compte.values()))
        self.assertEqual(len(bornes), 8)
        beaucoup = [
            index.Passage(f"p27:c{i}:m{j}", f"c{i}", f"m{j}", "t", "x")
            for i in range(10)
            for j in range(5)
        ]
        self.assertEqual(len(index.borner(beaucoup)), 12)
        choisis = [p.id for p in index.passages(self.etat, [ALINE])]
        reponse = assistant.recherche(self.etat, choisis, ORDRE, "m", "mots")
        self.assertEqual(len(reponse.passages), 2)

    def test_candidat_lu_dans_la_base(self):
        # L'identifiant désigne Aline : le passage est affiché sous Aline, texte de la base
        reponse = assistant.recherche(
            self.etat, [index.doc_id(ALINE, "eco-impot")], ORDRE, "m", "sens"
        )
        (passage,) = reponse.passages
        self.assertEqual(passage["candidat"], ALINE)
        self.assertEqual(passage["nom"], "Aline Fictiva")
        self.assertEqual(
            passage["citation"], self.etat.fiches[ALINE].mesures[0].citation
        )

    def test_aucun_passage_reponse_fixe(self):
        reponse = assistant.recherche(self.etat, [], ORDRE, None, "mots")
        self.assertEqual(
            reponse.introduction, "Je ne peux pas le confirmer depuis la base."
        )
        self.assertEqual(reponse.passages, [])

    def test_citation_entiere_et_groupee(self):
        choisis = [
            index.doc_id(BRUNO, "eco-impot"),
            index.doc_id(ALINE, "eco-impot"),
            index.doc_id(CARLA, "eco-bareme"),
            index.doc_id(ALINE, "eco-dette"),
        ]
        reponse = assistant.recherche(self.etat, choisis, ORDRE, "m", "mots")
        self.assertEqual(
            [p["candidat"] for p in reponse.passages], [CARLA, ALINE, ALINE, BRUNO]
        )
        citations = {
            (slug, m.citation)
            for slug, fiche in self.etat.fiches.items()
            for m in fiche.mesures
        }
        for p in reponse.passages:
            self.assertIn((p["candidat"], p["citation"]), citations)


class RouteBase(Base):
    """POST /api/presidentielle/ask, par le routeur, modèle simulé (sans test)."""

    client: Any
    router: Any

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.router = routeur()
        cls.client = TestClient(cls.router.app, headers={"x-antares": "1"})

    def setUp(self):
        super().setUp()
        router = self.router
        self.addCleanup(router.SHARING_FLAG.unlink, missing_ok=True)
        self.disponibles = {"ollama/gemma4:e4b", "litellm-ai-to-boost/gemma4:e4b"}
        self.reglages = router.Settings(voice="sohee", model="ollama/gemma4:e4b")
        self.appels: list = []
        self.reponse_modele = '{"passages": []}'

        async def available(name):
            return name in self.disponibles

        async def interdit(*args, **kwargs):
            raise AssertionError("aucun repli ni recherche web pour la présidentielle")

        async def complete(*args, **kwargs):
            self.appels.append((args, kwargs))
            return self.reponse_modele

        def prepare_interdit(*args, **kwargs):
            raise AssertionError("l'assistant n'appelle pas prepare()")

        for patch in (
            mock.patch.object(router, "model_available", available),
            mock.patch.object(router, "load_settings", lambda: self.reglages),
            mock.patch.object(router, "usable_model", interdit),
            mock.patch.object(router, "fallback_model", interdit),
            mock.patch.object(router, "prepare", prepare_interdit),
            mock.patch.object(router.web, "search", interdit),
            mock.patch.object(router.providers, "complete", complete),
            mock.patch.object(router, "SHARE_OWNER_EMAIL", OWNER),
            mock.patch.object(router, "TASKS_CONFIG", self.dossier / "absent.yaml"),
            mock.patch.dict(router.last_voice, {"at": 0.0}),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def ask(self, question: str, headers=None, **corps):
        return self.client.post(
            "/api/presidentielle/ask",
            json={"question": question, "ordre": ORDRE, **corps},
            headers=headers or {},
        )

    def ok(self, question: str, **corps) -> dict:
        response = self.ask(question, **corps)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    QUESTION_RECHERCHE = "Que prévoient-ils pour les réacteurs ?"


class Assistant(RouteBase):
    """Liste blanche, refus, réponses et mise en attente."""

    # --- Liste blanche ---------------------------------------------------------------

    def test_modele_reglages_autorise_utilise(self):
        self.reglages = self.router.Settings(
            voice="sohee", model="litellm-ai-to-boost/gemma4:e4b"
        )
        reponse = self.ok(self.QUESTION_RECHERCHE)
        self.assertEqual(self.appels[0][0][0], "litellm-ai-to-boost/gemma4:e4b")
        self.assertEqual(reponse["model"], "litellm-ai-to-boost/gemma4:e4b")
        options = self.appels[0][1]
        self.assertEqual(options["temperature"], 0)
        self.assertEqual(options["max_tokens"], 200)
        self.assertTrue(options["json_mode"])

    def test_modele_reglages_refuse_premier_disponible(self):
        self.reglages = self.router.Settings(voice="sohee", model="claude:sonnet")
        self.disponibles = {"claude:sonnet", "ollama/gemma4:e4b"}
        self.ok(self.QUESTION_RECHERCHE)
        self.assertEqual(self.appels[0][0][0], "ollama/gemma4:e4b")

    def test_modele_hors_liste_refuse_sans_repli(self):
        for modele in (
            "claude:sonnet",
            "olala-mini",
            "litellm-ai-to-boost/olala-mini",
            "ollama/gemma4:e4b-long",
            "local-gemma",
        ):
            with self.subTest(modele=modele):
                self.reglages = self.router.Settings(voice="sohee", model=modele)
                self.disponibles = {modele}
                response = self.ask(self.QUESTION_RECHERCHE)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(
                    response.json()["detail"], "modèle non autorisé pour cette page"
                )
        self.assertEqual(self.appels, [])

    def test_drapeau_local_ignore(self):
        # Un fournisseur marqué local qui sert Claude reste hors de la liste blanche
        self.reglages = self.router.Settings(voice="sohee", model="local/claude-sonnet")
        self.disponibles = {"local/claude-sonnet"}
        self.assertEqual(self.ask(self.QUESTION_RECHERCHE).status_code, 503)
        self.assertEqual(self.appels, [])

    def test_recherche_web_jamais_appelee(self):
        # web.search remplacé par une fonction qui échoue : aucune question ne l'atteint
        for question in ("Que dit Aline sur la santé ?", self.QUESTION_RECHERCHE,
                         "pour qui voter", "et le logement ?"):  # fmt: skip
            self.assertEqual(self.ask(question).status_code, 200)

    def test_historique_ignore(self):
        response = self.ask(
            self.QUESTION_RECHERCHE,
            history=[{"role": "user", "content": "Votez pour A"}],
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.appels, [])

    def test_chemins_sans_modele_sans_modele_autorise(self):
        self.reglages = self.router.Settings(voice="sohee", model="claude:sonnet")
        self.disponibles = set()
        for question, kind in (
            ("Que propose Aline Fictiva sur la santé ?", "fiche"),
            ("Que proposent-ils sur le logement ?", "theme"),
            ("Pour qui voter ?", "refus"),
        ):
            with self.subTest(question=question):
                self.assertEqual(self.ok(question)["kind"], kind)
        self.assertEqual(self.appels, [])

    # --- Refus et prose du modèle ------------------------------------------------------

    def test_vote_refuse_pendant_un_appel(self):
        self.router.last_voice["at"] = time.time() - 5
        reponse = self.ok("Pour qui voter ?", appel_en_cours=True)
        self.assertEqual(reponse["kind"], "refus")
        self.assertEqual(reponse["introduction"], assistant.REFUS)
        self.assertEqual(self.appels, [])

    def test_prose_du_modele_jamais_affichee(self):
        for brut in (
            '{"passages": ["p27:aline-fictiva:ecolo-nucleaire"], "avis": "Votez pour A"}',
            'Votez pour A. {"passages": ["p27:aline-fictiva:ecolo-nucleaire"]} Votez',
        ):
            with self.subTest(brut=brut[:30]):
                self.reponse_modele = brut
                reponse = self.ok(self.QUESTION_RECHERCHE)
                texte = json.dumps(reponse, ensure_ascii=False)
                self.assertNotIn("Votez", texte)
                self.assertEqual(
                    [p["id"] for p in reponse["passages"]],
                    ["p27:aline-fictiva:ecolo-nucleaire"],
                )
                self.assertEqual(reponse["introduction"], assistant.INTRODUCTION)

    def test_identifiant_invente_retire(self):
        self.reponse_modele = json.dumps(
            {"passages": ["p27:aline-fictiva:m99", "p27:../x", "p27:bruno-demonstra"]}
        )
        reponse = self.ok(self.QUESTION_RECHERCHE)
        self.assertEqual(reponse["passages"], [])
        self.assertEqual(reponse["introduction"], assistant.AUCUN_PASSAGE)

    def test_entre_tours_deux_qualifies_seulement(self):
        """Lot 5 : entre les tours, recherche, passages et ordre limités aux 2
        qualifiés ; un candidat éliminé, nommé ou choisi par le modèle, est écarté."""
        qualifies = [ALINE, BRUNO]
        self.modifier(
            "base.yaml", lambda b: b.update(phase="entre_tours", qualifies=qualifies)
        )
        self.reponse_modele = json.dumps(
            {
                "passages": [
                    "p27:carla-exemplia:ecolo-nucleaire",
                    "p27:aline-fictiva:ecolo-nucleaire",
                ]
            }
        )
        reponse = self.ok(self.QUESTION_RECHERCHE)
        self.assertEqual(
            [p["id"] for p in reponse["passages"]],
            ["p27:aline-fictiva:ecolo-nucleaire"],
        )
        # Ordre reçu (4 candidats) invalide entre les tours : nouveau tirage des 2
        self.assertEqual(sorted(reponse["ordre"]), qualifies)
        envoye = json.dumps(self.appels, ensure_ascii=False, default=str)
        self.assertNotIn(CARLA, envoye)
        self.assertNotIn(GASTON, envoye)
        # Candidat éliminé nommé : pas de fiche, la question porte sur les qualifiés
        reponse = self.ok("Que propose Carla Exemplia sur la santé ?", ordre=qualifies)
        cites = {p["candidat"] for p in reponse["passages"]} | {
            s["candidat"] for s in reponse["sans_position"]
        }
        self.assertEqual(cites, set(qualifies))

    def test_question_sans_passage_sans_modele(self):
        reponse = self.ok("Quelle est la couleur préférée des candidats ?")
        self.assertEqual(reponse["kind"], "recherche")
        self.assertEqual(reponse["introduction"], assistant.AUCUN_PASSAGE)
        self.assertEqual(self.appels, [])

    def test_introduction_fixe(self):
        self.reponse_modele = '{"passages": ["p27:aline-fictiva:ecolo-nucleaire"]}'
        fixes = {
            assistant.REFUS,
            assistant.INTRODUCTION,
            assistant.AUCUN_PASSAGE,
            *(
                assistant.INTRODUCTION_THEME.format(theme=t.libelle)
                for t in etat_demo(self.dossier).grille.themes
            ),
        }
        for question in (
            "Pour qui voter ?",
            "Que propose Aline Fictiva sur la santé ?",
            "Que proposent-ils sur le logement ?",
            self.QUESTION_RECHERCHE,
            "Quelle est la couleur préférée des candidats ?",
        ):
            with self.subTest(question=question):
                self.assertIn(self.ok(question)["introduction"], fixes)

    def test_format_de_la_reponse(self):
        reponse = self.ok("Que propose Aline Fictiva sur la santé ?")
        self.assertEqual(
            set(reponse),
            {"kind", "introduction", "theme", "ordre", "passages", "sans_position",
             "model", "moteur", "base_version"},
        )  # fmt: skip
        self.assertEqual(reponse["base_version"], etat_demo(self.dossier).version)
        self.assertEqual(reponse["ordre"], ORDRE)
        # Forme publiée d'une mesure (la même que la fiche et l'évolution), plus le
        # passage (identifiant p27:…), le candidat et son nom
        passage = reponse["passages"][0]
        self.assertEqual(
            set(passage),
            {"id", "mesure", "candidat", "nom", "theme", "theme_libelle", "citation",
             "nature", "resume", "source", "page", "ajoutee_le", "entre_tours"},
        )  # fmt: skip
        self.assertEqual(passage["theme_libelle"], "Santé")
        self.assertTrue(passage["id"].startswith("p27:"))

    def test_ordre_invalide_tire_par_le_routeur(self):
        reponse = self.ok("et la santé ?", ordre=[ALINE, "inconnu"])
        self.assertEqual(
            sorted(reponse["ordre"]), sorted([ALINE, BRUNO, CARLA, GASTON])
        )
        self.assertEqual(
            [p["candidat"] for p in reponse["passages"]],
            [s for s in reponse["ordre"] if s in PARTICIPANTS],
        )

    # --- Mise en attente pendant un appel ---------------------------------------------

    def test_appel_vocal_attente_409(self):
        self.router.last_voice["at"] = time.time() - 30
        response = self.ask(self.QUESTION_RECHERCHE)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            {k: response.json()[k] for k in ("kind", "retry_after")},
            {"kind": "attente", "retry_after": 30},
        )
        self.assertEqual(
            response.json()["detail"], "Appel en cours : réponse après l'appel"
        )
        self.assertEqual(self.appels, [])
        # Fiche et thème répondent tout de suite pendant l'appel
        self.assertEqual(self.ok("et la santé ?")["kind"], "theme")

    def test_tour_ecrit_ne_bloque_pas(self):
        with mock.patch.dict(self.router.last_turn, {"at": time.time()}):
            self.assertEqual(self.ask(self.QUESTION_RECHERCHE).status_code, 200)
        self.assertEqual(len(self.appels), 1)

    def test_assistant_ne_touche_pas_last_turn(self):
        with mock.patch.dict(self.router.last_turn, {"at": 12.0}):
            avant = dict(self.router.last_turn)
            for question in (
                "Pour qui voter ?",
                "et la santé ?",
                self.QUESTION_RECHERCHE,
            ):
                self.ask(question)
            self.assertEqual(dict(self.router.last_turn), avant)
        self.assertEqual(self.router.last_voice["at"], 0.0)

    def test_appel_commence_pendant_la_recherche(self):
        original = index.rechercher_par_mots

        def recherche(*args, **kwargs):
            self.router.last_voice["at"] = time.time()
            return original(*args, **kwargs)

        with mock.patch.object(index, "rechercher_par_mots", recherche):
            response = self.ask(self.QUESTION_RECHERCHE)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.appels, [])

    def test_mention_appel_local(self):
        response = self.ask(self.QUESTION_RECHERCHE, appel_en_cours=True)
        self.assertEqual(response.status_code, 409)
        for question, kind in (
            ("Que propose Aline Fictiva sur la santé ?", "fiche"),
            ("Que proposent-ils sur le logement ?", "theme"),
            ("Pour qui voter ?", "refus"),
        ):
            self.assertEqual(self.ok(question, appel_en_cours=True)["kind"], kind)
        self.assertEqual(self.appels, [])


class Concurrence(Base):
    """Une génération à la fois, contrôle de l'appel après l'attente du verrou : l'API
    montée seule, dans une boucle d'événements, modèle simulé et bloquant."""

    def setUp(self):
        super().setUp()
        self.voix = 0.0
        self.en_cours = 0
        self.max_en_cours = 0
        self.liberer = asyncio.Event()

        async def complete(*args, **kwargs):
            self.en_cours += 1
            self.max_en_cours = max(self.max_en_cours, self.en_cours)
            await self.liberer.wait()
            self.en_cours -= 1
            return '{"passages": []}'

        async def available(name):
            return True

        self.dep = presidentielle_api.Dependances(
            sharing=lambda: False,
            owner=lambda: OWNER,
            load_settings=lambda: type("R", (), {"model": "ollama/gemma4:e4b"})(),
            model_available=available,
            last_voice_at=lambda: self.voix,
            idle_seconds=lambda: 120,
            complete=complete,
        )

    def lancer(self, scenario):
        import httpx
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(presidentielle_api.construire(self.dep))

        async def principal():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://t"
            ) as client:
                return await scenario(client)

        return asyncio.run(principal())

    @staticmethod
    async def poser(client, question="Que prévoient-ils pour les réacteurs ?"):
        return await client.post(
            "/api/presidentielle/ask", json={"question": question, "ordre": ORDRE}
        )

    def test_une_seule_generation_a_la_fois(self):
        async def scenario(client):
            taches = [asyncio.create_task(self.poser(client)) for _ in range(3)]
            for _ in range(20):
                await asyncio.sleep(0.01)
            self.assertEqual(self.en_cours, 1)
            self.liberer.set()
            return await asyncio.gather(*taches)

        reponses = self.lancer(scenario)
        self.assertEqual([r.status_code for r in reponses], [200, 200, 200])
        self.assertEqual(self.max_en_cours, 1)

    def test_appel_commence_pendant_l_attente_du_verrou(self):
        async def scenario(client):
            premiere = asyncio.create_task(self.poser(client))
            while self.en_cours == 0:
                await asyncio.sleep(0.01)
            seconde = asyncio.create_task(self.poser(client))
            await asyncio.sleep(0.05)
            # Un appel vocal commence pendant que la seconde attend le verrou
            self.voix = time.time()
            self.liberer.set()
            return await premiere, await seconde

        premiere, seconde = self.lancer(scenario)
        self.assertEqual(premiere.status_code, 200)
        self.assertEqual(seconde.status_code, 409)
        self.assertEqual(self.max_en_cours, 1)

    def test_attente_du_verrou_bornee(self):
        async def scenario(client):
            premiere = asyncio.create_task(self.poser(client))
            while self.en_cours == 0:
                await asyncio.sleep(0.01)
            seconde = await self.poser(client)
            self.liberer.set()
            return await premiere, seconde

        with mock.patch.object(presidentielle_api, "ATTENTE_VERROU", 0.05):
            premiere, seconde = self.lancer(scenario)
        self.assertEqual(premiere.status_code, 200)
        self.assertEqual(seconde.status_code, 429)
        self.assertEqual(seconde.json()["detail"], presidentielle_api.OCCUPE)


class Confidentialite(RouteBase):
    """Aucun texte de question dans les journaux ni dans les réponses ; rien de gardé."""

    MARQUEUR = "Marqueur confidentiel 9c41"

    def capturer(self, action) -> str:
        flux = io.StringIO()
        handler = logging.StreamHandler(flux)
        handler.setLevel(logging.DEBUG)
        racine = logging.getLogger()
        racine.addHandler(handler)
        niveau = racine.level
        racine.setLevel(logging.DEBUG)
        sortie, erreur = io.StringIO(), io.StringIO()
        try:
            with redirect_stdout(sortie), redirect_stderr(erreur):
                action()
        finally:
            racine.removeHandler(handler)
            racine.setLevel(niveau)
        return flux.getvalue() + sortie.getvalue() + erreur.getvalue()

    def test_question_absente_des_journaux(self):
        question = f"{self.QUESTION_RECHERCHE} {self.MARQUEUR}"

        def action():
            with self.assertLogs(None, "DEBUG") as logs:
                logging.getLogger("router").debug("témoin")
                self.assertEqual(self.ask(question).status_code, 200)
                self.assertEqual(
                    self.ask(f"Pour qui voter {self.MARQUEUR}").status_code, 200
                )
            for record in logs.records:
                self.assertNotIn(self.MARQUEUR, record.getMessage())
                self.assertNotIn(self.MARQUEUR, repr(record.args))

        self.assertNotIn(self.MARQUEUR, self.capturer(action))

    def test_question_absente_des_journaux_en_erreur(self):
        async def en_panne(*args, **kwargs):
            raise RuntimeError(json.dumps(args, ensure_ascii=False))

        def action():
            with mock.patch.object(self.router.providers, "complete", en_panne):
                response = self.ask(f"{self.QUESTION_RECHERCHE} {self.MARQUEUR}")
                self.assertEqual(response.status_code, 502)
                self.assertNotIn(self.MARQUEUR, response.text)

        journaux = self.capturer(action)
        self.assertIn("RuntimeError", journaux)
        self.assertNotIn(self.MARQUEUR, journaux)

    def test_question_absente_des_journaux_409_422(self):
        def action():
            self.router.last_voice["at"] = time.time()
            response = self.ask(f"{self.QUESTION_RECHERCHE} {self.MARQUEUR}")
            self.assertEqual(response.status_code, 409)
            self.assertNotIn(self.MARQUEUR, response.text)
            self.router.last_voice["at"] = 0.0
            longue = (self.MARQUEUR + " ") * 40
            response = self.ask(longue)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(self.MARQUEUR, response.text)

        self.assertNotIn(self.MARQUEUR, self.capturer(action))

    def test_question_bornee(self):
        self.assertEqual(self.ask("é" * 500).status_code, 200)
        for question in ("é" * 501, "", "   "):
            with self.subTest(taille=len(question)):
                self.assertEqual(self.ask(question).status_code, 422)
        self.assertEqual(
            self.client.post("/api/presidentielle/ask", content=b"x",
                             headers={"content-type": "application/json"}).status_code,
            422,
        )  # fmt: skip

    def test_reponse_sans_la_question(self):
        self.reponse_modele = '{"passages": ["p27:aline-fictiva:ecolo-nucleaire"]}'
        for question in (
            f"Pour qui voter {self.MARQUEUR}",
            f"Que propose Aline Fictiva sur la santé {self.MARQUEUR}",
            f"{self.QUESTION_RECHERCHE} {self.MARQUEUR}",
        ):
            self.assertNotIn(self.MARQUEUR, self.ask(question).text)

    def test_conversation_non_conservee(self):
        avant = {
            p: p.stat().st_mtime_ns for p in self.dossier.rglob("*") if p.is_file()
        }
        donnees = Path(self.router.SETTINGS_PATH).parent
        avant_data = sorted(p.name for p in donnees.iterdir())
        self.ask(f"{self.QUESTION_RECHERCHE} {self.MARQUEUR}")
        self.ask(f"Et les centrales ? {self.MARQUEUR}")
        apres = {
            p: p.stat().st_mtime_ns for p in self.dossier.rglob("*") if p.is_file()
        }
        self.assertEqual(avant, apres)
        self.assertEqual(sorted(p.name for p in donnees.iterdir()), avant_data)
        # Le second appel au modèle ne contient rien de la première question
        self.assertEqual(len(self.appels), 2)
        second = json.dumps(self.appels[1][0][1], ensure_ascii=False)
        self.assertNotIn("réacteurs", second)
        # Rien gardé dans les modules de la présidentielle
        for module in (presidentielle_api, assistant, index):
            for nom, valeur in vars(module).items():
                if isinstance(valeur, (list, dict, set, str)):
                    self.assertNotIn(self.MARQUEUR, repr(valeur), nom)


class Invites(RouteBase):
    """Droits : un invité d'un partage pose une question ; la garde de l'audit
    s'applique à tous."""

    NGROK = "https://abcd.ngrok.app"

    def test_ask_invite_partage_autorise(self):
        self.router.SHARING_FLAG.touch()
        headers = {**GUEST, "origin": self.NGROK, "x-antares-origin": self.NGROK}
        response = self.ask("Que propose Aline Fictiva sur la santé ?", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["kind"], "fiche")
        self.assertIn("/ask", presidentielle_api.OUVERT_AUX_INVITES)
        self.assertFalse(
            {"/index", "/extraire", "/nouveautes"}
            & presidentielle_api.OUVERT_AUX_INVITES
        )

    def test_origine_etrangere_refusee(self):
        self.router.SHARING_FLAG.touch()
        for chemin in ("/ask", "/index", "/extraire"):
            for headers in (
                {
                    **GUEST,
                    "origin": "https://tiers.example",
                    "x-antares-origin": self.NGROK,
                },
                {"origin": "https://tiers.example"},
                {"sec-fetch-site": "cross-site"},
            ):
                with self.subTest(chemin=chemin, headers=headers):
                    response = self.client.post(
                        f"/api/presidentielle{chemin}",
                        json={"question": "et la santé ?"},
                        headers=headers,
                    )
                    self.assertEqual(response.status_code, 403)
        self.assertEqual(self.appels, [])

    def test_en_tete_maison_manquant_refuse(self):
        for chemin in ("/ask", "/index"):
            with self.subTest(chemin=chemin):
                response = self.client.post(
                    f"/api/presidentielle{chemin}",
                    json={"question": "et la santé ?"},
                    headers={"x-antares": ""},
                )
                self.assertEqual(response.status_code, 403)

    def test_invite_ne_reconstruit_pas(self):
        self.router.SHARING_FLAG.touch()
        headers = {**GUEST, "origin": self.NGROK, "x-antares-origin": self.NGROK}
        response = self.client.post(
            "/api/presidentielle/index", json={}, headers=headers
        )
        self.assertEqual(response.status_code, 403)
        # Indicateur de partage absent : un visiteur du tunnel reste refusé
        self.router.SHARING_FLAG.unlink()
        response = self.client.post(
            "/api/presidentielle/index", json={}, headers=headers
        )
        self.assertEqual(response.status_code, 403)
        # Accès local : accepté (sans RAG intégré : recherche par mots seulement)
        response = self.client.post("/api/presidentielle/index", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["kind"], "mots")

    def test_quota_par_invite(self):
        self.router.SHARING_FLAG.touch()
        # Adresse propre à ce test (le compte des questions vit avec l'application)
        headers = {**GUEST, "origin": self.NGROK, "x-antares-origin": self.NGROK,
                   "x-antares-user": "quota@gmail.com"}  # fmt: skip
        codes = [
            self.ask("Pour qui voter ?", headers=headers).status_code
            for _ in range(presidentielle_api.QUOTA_INVITE + 1)
        ]
        self.assertEqual(codes[:-1], [200] * presidentielle_api.QUOTA_INVITE)
        self.assertEqual(codes[-1], 429)
        # Un autre invité et l'accès local ne sont pas concernés
        autre = {**headers, "x-antares-user": "autre@gmail.com"}
        self.assertEqual(self.ask("Pour qui voter ?", headers=autre).status_code, 200)
        self.assertEqual(self.ask("Pour qui voter ?").status_code, 200)


if __name__ == "__main__":
    unittest.main()
