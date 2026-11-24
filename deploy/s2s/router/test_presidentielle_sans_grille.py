"""Base sans grille du quiz (cas de la base réelle au démarrage) : thèmes déduits des
mesures publiées, assistant, quiz indisponible avec un message clair ; jeu de 27 fiches
d'identité sans mesure ni grille (fictives, domaine exemple.invalid), dont une retirée.

python -m unittest test_presidentielle_sans_grille (dans router/, cf. README).
"""

import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle
import presidentielle_api
import presidentielle_index
from test_presidentielle_assistant import ORDRE, RouteBase

ALINE = "aline-fictiva"
# 27 personnes inventées : prénom et nom distincts, aucun nom de parti
PRENOMS = """Adèle Basile Céleste Damien Elsa Firmin Gisèle Hector Iris Jules Katell
Lucien Maëlle Nestor Odile Pacôme Quitterie Romain Solène Thibault Ursule Valentin
Wanda Xavier Yvette Zacharie Armelle""".split()
NOMS = """Fictilier Exemplot Demontier Simulard Inventin Supposier Modelin Essayot
Brouillet Maquettin Croquier Esquissot Ebauchin Calquier Patronnet Gabarin Specimot
Echantier Prototin Fantaisier Imaginot Chimerin Songeard Revelin Fablier Contier
Legendot""".split()
RETIRE = 13


def slug(rang: int) -> str:
    return f"candidat-{rang:02d}"


def ecrire_jeu_identites(dossier: Path, nombre: int = 27) -> list[str]:
    """Écrit une base de `nombre` fiches d'identité (statut déclaré, une retirée), sans
    mesure, sans ligne phare, sans grille ni rattachements ; rend les identifiants."""
    if dossier.exists():
        shutil.rmtree(dossier)
    (dossier / "candidats").mkdir(parents=True)

    def ecrire(rel: str, data: dict) -> None:
        (dossier / rel).write_text(
            yaml.safe_dump(
                data, explicit_start=True, sort_keys=False, allow_unicode=True
            ),
            encoding="utf-8",
        )

    ecrire(
        "base.yaml",
        {
            "jeu": "demonstration",
            "liste": "declares",
            "phase": "declares",
            "archive_apres": "2027-05-02",
            "tours": {"premier": "2027-04-18", "second": "2027-05-02"},
            "partis": [],
            "assistant": {"modeles_autorises": ["ollama/gemma4:e4b"]},
        },
    )
    sources = [
        {
            "id": "etat-declarations",
            "titre": "Liste fictive des déclarations de candidature",
            "url": "https://etat.exemple.invalid/declarations",
            "niveau": "officiel_etat",
            "publie_le": "2026-11-02",
            "consulte_le": "2026-11-20",
        }
    ]
    journal: list[dict] = [
        {"date": "2026-11-18", "objet": "base", "motif": "Création du jeu d'essai"}
    ]
    slugs = []
    for rang in range(1, nombre + 1):
        identifiant = slug(rang)
        slugs.append(identifiant)
        prenom, nom = PRENOMS[rang - 1], NOMS[rang - 1]
        retire = rang == RETIRE
        if retire:
            sources.append(
                {
                    "id": f"{identifiant}-retrait",
                    "titre": f"Communiqué fictif de retrait de {prenom} {nom}",
                    "url": f"https://{identifiant}.exemple.invalid/retrait",
                    "niveau": "candidat",
                    "publie_le": "2026-11-10",
                    "consulte_le": "2026-11-20",
                    "candidat": identifiant,
                }
            )
        ecrire(
            f"candidats/{identifiant}.yaml",
            {
                "id": identifiant,
                "nom_affiche": f"{prenom} {nom}",
                "initiales": f"{prenom[0]}{nom[0]}".upper().replace("É", "E"),
                "fictif": True,
                "statut": "retire" if retire else "declare",
                "statut_source": (
                    f"{identifiant}-retrait" if retire else "etat-declarations"
                ),
                "declaration": {
                    "date": "2026-09-01",
                    "source_id": "etat-declarations",
                },
                "description": {
                    "texte": f"Personne inventée pour les essais ({rang}).",
                    "nature": "redaction",
                },
                "lignes_phares": [],
                "mesures": [],
                "parlementaire": False,
                "version": 1,
                "mise_a_jour": "2026-11-20",
                "relue_le": "2026-11-20",
            },
        )
        journal.append(
            {
                "date": "2026-11-20",
                "objet": "fiche",
                "cible": identifiant,
                "version": 1,
                "motif": "Fiche d'identité publiée",
            }
        )
    ecrire("sources.yaml", {"sources": sources})
    ecrire("journal.yaml", {"entrees": journal})
    return slugs


class SansGrille(RouteBase):
    """Jeu fictif sans quiz/ : les mesures restent visibles, sous des thèmes déduits."""

    def setUp(self):
        super().setUp()
        shutil.rmtree(self.dossier / "quiz")

    def get(self, path: str = "") -> dict:
        response = self.client.get(f"/api/presidentielle{path}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_themes_deduits_des_mesures(self):
        body = self.get()
        themes = body["themes"]
        presents = {m["theme"] for c in body["candidats"] for m in c["mesures"]}
        self.assertTrue(presents)
        self.assertEqual({t["id"] for t in themes}, presents)
        # Ordre et libellés de référence de l'outil de saisie, axe absent
        reference = list(presidentielle.THEMES_REFERENCE)
        self.assertEqual(
            [t["id"] for t in themes],
            sorted(presents, key=reference.index),
        )
        sante = next(t for t in themes if t["id"] == "sante")
        self.assertEqual(
            sante, {"id": "sante", "libelle": "Santé", "axe": None, "hors_quiz": False}
        )
        # Thèmes hors quiz des mesures (ADR 0016) : libellé de référence, en dernier
        self.assertEqual(
            [t["id"] for t in themes if t["hors_quiz"]], ["culture", "solidarites"]
        )
        self.assertEqual([t["id"] for t in themes[-2:]], ["culture", "solidarites"])
        # Chaque mesure porte le libellé de son thème
        for candidat in body["candidats"]:
            for mesure in candidat["mesures"]:
                libelle = presidentielle.THEMES_REFERENCE[mesure["theme"]][0]
                self.assertEqual(mesure["theme_libelle"], libelle)
        # Avertissement pour le propriétaire, fiches servies
        erreurs = self.get("/meta")["erreurs"]
        self.assertIn(presidentielle.GRILLE_ABSENTE, str(erreurs))

    def test_theme_inconnu_de_la_reference_garde_son_identifiant(self):
        def theme_maison(fiche):
            fiche["mesures"][0]["theme"] = "numerique"

        self.modifier("candidats/aline-fictiva.yaml", theme_maison)
        themes = self.get()["themes"]
        self.assertEqual(
            themes[-1],
            {
                "id": "numerique",
                "libelle": "numerique",
                "axe": None,
                "hors_quiz": False,
            },
        )

    def test_grille_en_defaut_memes_themes_deduits(self):
        shutil.copytree(
            Path(__file__).parent / "fixtures/presidentielle/demo/quiz",
            self.dossier / "quiz",
        )
        self.modifier("quiz/grille.yaml", lambda g: g.update(axes_statut="inconnu"))
        body = self.get()
        self.assertTrue(body["themes"])
        self.assertTrue(all(t["axe"] is None for t in body["themes"]))
        quiz = self.get("/quiz")
        self.assertFalse(quiz["disponible"])
        self.assertEqual(quiz["message"], presidentielle_api.GRILLE_EN_CORRECTION)

    def test_grille_en_defaut_sans_un_theme_aucune_fiche_ecartee(self):
        # Grille lisible mais en défaut, privée du thème santé : les fiches qui ont une
        # mesure sur la santé restent servies, la mesure aussi, signalée au propriétaire
        shutil.copytree(
            Path(__file__).parent / "fixtures/presidentielle/demo/quiz",
            self.dossier / "quiz",
        )
        self.modifier(
            "quiz/grille.yaml",
            lambda g: g.update(themes=[t for t in g["themes"] if t["id"] != "sante"]),
        )
        body = self.get()
        ids = [c["id"] for c in body["candidats"]]
        self.assertEqual(
            ids,
            ["aline-fictiva", "bruno-demonstra", "carla-exemplia", "gaston-fictorin"],
        )
        aline = body["candidats"][0]
        self.assertIn("sante", {m["theme"] for m in aline["mesures"]})
        self.assertIn("sante", {t["id"] for t in body["themes"]})
        erreurs = str(self.get("/meta")["erreurs"])
        self.assertIn("grille en défaut : mesure servie", erreurs)

    def test_grille_valide_theme_inconnu_ecarte_la_fiche(self):
        # Grille valide : un thème inconnu reste une erreur de saisie (fiche écartée)
        shutil.copytree(
            Path(__file__).parent / "fixtures/presidentielle/demo/quiz",
            self.dossier / "quiz",
        )

        def theme_maison(fiche):
            fiche["mesures"][0]["theme"] = "numerique"

        self.modifier("candidats/gaston-fictorin.yaml", theme_maison)
        ids = [c["id"] for c in self.get()["candidats"]]
        self.assertNotIn("gaston-fictorin", ids)
        self.assertIn("numerique", str(self.get("/meta")["erreurs"]))

    def test_quiz_message_grille_non_publiee(self):
        quiz = self.get("/quiz")
        self.assertFalse(quiz["disponible"])
        self.assertEqual(quiz["message"], "La grille du quiz n'est pas encore publiée.")
        self.assertEqual(quiz["themes"], [])

    def test_assistant_reconnait_les_themes_deduits(self):
        reponse = self.ok("Que propose Aline Fictiva sur la santé ?")
        self.assertEqual(reponse["kind"], "fiche")
        self.assertEqual(reponse["theme"], {"id": "sante", "libelle": "Santé"})
        self.assertTrue(reponse["passages"])
        self.assertEqual({p["theme_libelle"] for p in reponse["passages"]}, {"Santé"})
        self.assertEqual(self.appels, [])
        # Mots-clés de référence : « médecins » désigne la santé
        reponse = self.ok("Et pour les médecins ?")
        self.assertEqual(reponse["kind"], "theme")
        self.assertEqual(reponse["theme"]["id"], "sante")

    def test_index_libelles_de_reference(self):
        etat = presidentielle.charger()
        passage = next(
            p for p in presidentielle_index.passages(etat) if p.theme == "sante"
        )
        self.assertTrue(passage.texte.startswith("Santé\n"))


class JeuIdentites(RouteBase):
    """27 fiches d'identité, sans mesure ni grille (cas de la base réelle)."""

    def setUp(self):
        super().setUp()
        self.slugs = ecrire_jeu_identites(self.dossier)

    def get(self, path: str = "") -> dict:
        response = self.client.get(f"/api/presidentielle{path}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_meme_gabarit_aucune_ligne_phare_aucune_mesure(self):
        body = self.get()
        self.assertTrue(body["disponible"])
        self.assertEqual([c["id"] for c in body["candidats"]], self.slugs)
        self.assertEqual(body["themes"], [])
        # Mêmes rubriques pour chaque fiche
        self.assertEqual(len({tuple(sorted(c)) for c in body["candidats"]}), 1)
        for candidat in body["candidats"]:
            self.assertEqual(candidat["lignes_phares"], [])
            self.assertEqual(candidat["mesures"], [])
        statuts = [c["statut"] for c in body["candidats"]]
        self.assertEqual(statuts.count("retire"), 1)
        # Aucune erreur pour le propriétaire : ni grille attendue, ni fiche écartée
        self.assertEqual(self.get("/meta")["erreurs"], [])

    def test_assistant_repond_sans_modele(self):
        ordre = list(reversed(self.slugs))
        for question in (
            "Que propose Adèle Fictilier sur la santé ?",
            "Que prévoient-ils pour les réacteurs ?",
            "Quelle est la position de Basile Exemplot ?",
        ):
            with self.subTest(question=question):
                reponse = self.ok(question, ordre=ordre)
                self.assertEqual(reponse["kind"], "recherche")
                self.assertEqual(reponse["passages"], [])
                self.assertEqual(
                    reponse["introduction"],
                    "Je ne peux pas le confirmer depuis la base.",
                )
                self.assertIsNone(reponse["model"])
        self.assertEqual(self.appels, [])
        # Même pendant un appel vocal : rien à chercher, réponse immédiate
        self.router.last_voice["at"] = time.time() - 5
        reponse = self.ok("Que prévoient-ils pour les réacteurs ?", ordre=ordre)
        self.assertEqual(reponse["passages"], [])
        self.assertEqual(self.appels, [])

    def test_refus_toujours_fixe(self):
        reponse = self.ok("Pour qui voter ?", ordre=self.slugs)
        self.assertEqual(reponse["kind"], "refus")

    def test_quiz_indisponible_message(self):
        quiz = self.get("/quiz")
        self.assertFalse(quiz["disponible"])
        self.assertEqual(quiz["message"], presidentielle_api.GRILLE_NON_PUBLIEE)
        self.assertEqual(len(quiz["participants"]), 26)

    def test_evolution_v1(self):
        for identifiant in (self.slugs[0], slug(RETIRE)):
            with self.subTest(candidat=identifiant):
                body = self.get(f"/evolution/{identifiant}")
                self.assertEqual([v["version"] for v in body["versions"]], [1])
                self.assertTrue(body["versions"][0]["conservee"])
                self.assertEqual(body["versions"][0]["mesures"], 0)
                self.assertIsNone(body["versions"][0]["changements"])
                self.assertEqual(body["programmes"], [])


class AppelAvantRecherche(RouteBase):
    """Appel vocal en cours (lancé ailleurs) : ni recherche ni modèle."""

    def test_aucune_recherche_pendant_un_appel(self):
        self.router.last_voice["at"] = time.time() - 5

        def interdit(*args, **kwargs):
            raise AssertionError("aucune recherche pendant un appel")

        with mock.patch.object(presidentielle_index, "rechercher_par_mots", interdit):
            response = self.ask("Que prévoient-ils pour les réacteurs ?", ordre=ORDRE)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["kind"], "attente")
        self.assertEqual(self.appels, [])


if __name__ == "__main__":
    unittest.main()
