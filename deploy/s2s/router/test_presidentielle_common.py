"""Contrôles communs de la présidentielle (presidentielle_common.py) : normalisation des
textes, liste blanche du modèle, détection d'un appel vocal (heure injectée).

python -m unittest test_presidentielle_common (dans router/, cf. README).
"""

import tempfile
import unittest
from pathlib import Path

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle_common as common

FIXTURES = Path(__file__).parent / "fixtures" / "presidentielle"
APOSTROPHE = chr(0x2019)
INSECABLE, FINE = chr(0x00A0), chr(0x202F)
LIGATURE_FI, LIGATURE_FL = chr(0xFB01), chr(0xFB02)
CESURE_DOUCE = chr(0x00AD)


class Normaliser(unittest.TestCase):
    def test_normaliser_apostrophes_guillemets(self):
        self.assertEqual(common.normaliser(f"l{APOSTROPHE}impôt"), "l'impôt")
        self.assertEqual(
            common.normaliser(f"«{INSECABLE}vingt élèves{FINE}»"), '"vingt élèves"'
        )
        self.assertEqual(
            common.normaliser(chr(0x201C) + "texte" + chr(0x201D)), '"texte"'
        )

    def test_normaliser_ligatures_espaces(self):
        texte = f"{LIGATURE_FI}scalité\tet{INSECABLE}con{LIGATURE_FL}it{FINE}:  fin "
        self.assertEqual(common.normaliser(texte), "fiscalité et conflit : fin")
        self.assertEqual(common.normaliser(f"écono{CESURE_DOUCE}mie"), "économie")

    def test_normaliser_coupure_de_ligne(self):
        # Règle : tiret en fin de ligne suivi d'une minuscule = césure, retirée
        self.assertEqual(common.normaliser("l'écono-\nmie"), "l'économie")
        self.assertEqual(common.normaliser("porte-\nparole"), "porteparole")
        # Majuscule après le tiret, ou fin de ligne simple : une espace
        self.assertEqual(common.normaliser("Jean-\nPierre"), "Jean- Pierre")
        self.assertEqual(common.normaliser("deux\r\nlignes"), "deux lignes")

    def test_normaliser_idempotent(self):
        textes = [(FIXTURES / "source_courte.txt").read_text(encoding="utf-8")]
        for path in sorted((FIXTURES / "demo" / "candidats").glob("*.yaml")):
            fiche = yaml.safe_load(path.read_text(encoding="utf-8"))
            textes += [m["citation"] for m in fiche["mesures"]]
        textes += ["", "  ", "a-\n-\nb", "« »", "l’« x »\n-\nmie"]
        for texte in textes:
            with self.subTest(texte=texte[:30]):
                once = common.normaliser(texte)
                self.assertEqual(common.normaliser(once), once)

    def test_normaliser_garde_la_negation(self):
        texte = f"Nous ne supprimerons{INSECABLE}pas les aides."
        mots = common.normaliser(texte).split()
        self.assertIn("ne", mots)
        self.assertIn("pas", mots)
        self.assertEqual(common.normaliser("ne … pas"), "ne ... pas")

    def test_citation_retrouvee_dans_la_source(self):
        """Une citation saisie à la main se retrouve mot pour mot dans le texte du PDF."""
        source = common.normaliser(
            (FIXTURES / "source_courte.txt").read_text(encoding="utf-8")
        )
        for citation in (
            "Nous créerons deux tranches d'impôt supplémentaires pour les revenus les"
            " plus élevés.",
            "Le déficit sera réduit par une hausse ciblée de certains impôts",
            "La croissance de l'économie ne sera pas sacrifiée",
            '"Aucune classe de primaire ne dépassera vingt élèves."',
            "Nous recruterons dix mille policiers",
        ):
            with self.subTest(citation=citation[:30]):
                self.assertIn(common.normaliser(citation), source)


class ListeBlanche(unittest.TestCase):
    AUTORISES = ["litellm-ai-to-boost/gemma4:e4b", "ollama/gemma4:e4b"]

    def test_modele_autorise_exact(self):
        for name in self.AUTORISES:
            self.assertTrue(common.modele_autorise(name, self.AUTORISES))

    def test_modele_autorise_variantes_refusees(self):
        for name in (
            "gemma4:e4b",
            "ollama/gemma4:e4b-long",
            "gemma4:e4b-long",
            "local-gemma",
            "litellm-ai-to-boost/local-gemma",
            "olala-mini",
            "litellm-ai-to-boost/olala-mini",
            "claude:sonnet",
            "claude/opus",
            "OLLAMA/GEMMA4:E4B",
            "GEMMA4:E4B",
            " ollama/gemma4:e4b",
            "ollama/gemma4:e4b ",
            "ollama/gemma4:e4b:latest",
            "ollama/gemma4:e4b/../x",
            "",
            None,
            42,
        ):
            with self.subTest(modele=name):
                self.assertFalse(common.modele_autorise(name, self.AUTORISES))

    def test_modele_autorise_liste_vide(self):
        for name in self.AUTORISES + [""]:
            self.assertFalse(common.modele_autorise(name, []))


class AppelEnCours(unittest.TestCase):
    NOW = 1_800_000_000.0

    def test_appel_en_cours_bornes(self):
        for ecart, attendu in ((0, True), (119, True), (120, False), (121, False)):
            with self.subTest(ecart=ecart):
                self.assertEqual(
                    common.appel_en_cours(self.NOW, self.NOW - ecart, 120), attendu
                )
        # Jamais de tour vocal
        self.assertFalse(common.appel_en_cours(self.NOW, 0.0, 120))
        self.assertFalse(common.appel_en_cours(self.NOW, None, 120))

    def test_appel_en_cours_delai_des_reglages(self):
        path = Path(tempfile.mkdtemp()) / "tasks.yaml"
        self.addCleanup(path.unlink, missing_ok=True)
        path.write_text("call:\n  idle_seconds: 60\n", encoding="utf-8")
        delai = common.delai_appel(path)
        self.assertEqual(delai, 60)
        self.assertTrue(common.appel_en_cours(self.NOW, self.NOW - 59, delai))
        self.assertFalse(common.appel_en_cours(self.NOW, self.NOW - 60, delai))

    def test_appel_en_cours_reglages_absents(self):
        dossier = Path(tempfile.mkdtemp())
        self.assertEqual(common.delai_appel(dossier / "absent.yaml"), 120)
        (dossier / "sans_call.yaml").write_text("categories: []\n", encoding="utf-8")
        self.assertEqual(common.delai_appel(dossier / "sans_call.yaml"), 120)
        (dossier / "casse.yaml").write_text("call: [\n", encoding="utf-8")
        self.assertEqual(common.delai_appel(dossier / "casse.yaml"), 120)


if __name__ == "__main__":
    unittest.main()
