"""Textes de la veille (texts.py) : renvois retirés, une seule phrase, clés de titre."""

import unittest

import texts


class CleanRefs(unittest.TestCase):
    def test_exemples_de_la_spec(self):
        known = ["c3", "c7", "c12"]
        self.assertEqual(texts.clean_refs("Utile (a11).", known), "Utile.")
        self.assertEqual(texts.clean_refs("Voir [c3, c7] ici", known), "Voir ici")
        self.assertEqual(
            texts.clean_refs("Utile (cf. c12) pour Antares", known),
            "Utile pour Antares",
        )
        self.assertEqual(
            texts.clean_refs("la version a10 corrige", known), "la version a10 corrige"
        )

    def test_renvoi_isole_connu_retire(self):
        self.assertEqual(
            texts.clean_refs("Comme c3, la voix", ["c3"]), "Comme, la voix"
        )
        self.assertEqual(texts.clean_refs("Selon c3.", ["c3"]), "Selon.")

    def test_ponctuation_orpheline(self):
        self.assertEqual(
            texts.clean_refs("Utile [a1] , rapide (a2) .", []), "Utile, rapide."
        )
        self.assertEqual(texts.clean_refs("(c1) Début", ["c1"]), "Début")

    def test_texte_ordinaire_inchange(self):
        for text in ("Version 3.2 (stable) publiée.", "Le modèle a 8 milliards."):
            self.assertEqual(texts.clean_refs(text, ["c1"]), text)


class OneSentence(unittest.TestCase):
    def test_premiere_phrase(self):
        self.assertEqual(
            texts.one_sentence("Phrase un. Phrase deux.", 220), "Phrase un."
        )
        self.assertEqual(
            texts.one_sentence("Gemma 4.1 arrive ! Elle est rapide.", 220),
            "Gemma 4.1 arrive !",
        )

    def test_point_ajoute(self):
        self.assertEqual(texts.one_sentence("Sans point", 220), "Sans point.")

    def test_version_et_abreviation_gardees(self):
        self.assertEqual(
            texts.one_sentence("Python 3.13 sort, plus rapide.", 220),
            "Python 3.13 sort, plus rapide.",
        )

    def test_longueur_bornee_au_mot(self):
        text = texts.one_sentence("mot " * 100, 50)
        self.assertLessEqual(len(text), 50)
        self.assertTrue(text.endswith("mot…"))

    def test_vide(self):
        self.assertEqual(texts.one_sentence("  ", 220), "")


class Keys(unittest.TestCase):
    def test_title_key(self):
        self.assertEqual(
            texts.title_key("Ajout d'un cache pour le RAG !"), "ajout cache rag"
        )
        self.assertEqual(texts.title_key("Écran Été"), "ecran ete")

    def test_title_words(self):
        self.assertEqual(
            texts.title_words("AWS lance 2026 Lambda, le GPU et l'IA en 10 Go"),
            ["aws", "lance", "lambda", "gpu"],
        )
        self.assertEqual(
            len(texts.title_words(" ".join(f"mot{i}" for i in range(20)))), 8
        )

    def test_overlap(self):
        self.assertAlmostEqual(
            texts.overlap(
                "Sélecteur de modèles Ollama",
                "Connexions : fournisseurs Ollama, modèle et repli choisis",
            ),
            2 / 3,
        )
        self.assertEqual(texts.overlap("", "x"), 0.0)


class OffTopic(unittest.TestCase):
    MIT = (
        "Building trustworthy AI by fencing it in, not predicting it. Researchers "
        "argue for strict guardrails around model behaviour instead of forecasts."
    )

    def test_resume_fidele_garde(self):
        source = "Dax Raad rebuilt his browser tool in Rust for $60. Memory fell 97%."
        sentence = (
            "Dax Raad réécrit son outil de navigateur en Rust et divise sa mémoire."
        )
        self.assertIsNone(texts.off_topic(sentence, source))

    def test_traduction_et_noms_generiques(self):
        source = "US tightens AI chip export controls on China"
        sentence = "Les États-Unis durcissent le contrôle des exportations de puces IA vers la Chine."
        self.assertIsNone(texts.off_topic(sentence, source))

    def test_nom_invente_ecarte(self):
        sentence = (
            "Des agents OpenAI désactivent leur propre sécurité pendant les tests."
        )
        reason = texts.off_topic(sentence, self.MIT)
        self.assertIsNotNone(reason)
        self.assertIn("OpenAI", reason or "")

    def test_aucun_mot_commun_ecarte(self):
        reason = texts.off_topic("Une recette de gâteau aux pommes.", self.MIT)
        self.assertEqual(reason, "aucun mot commun avec l'article")

    def test_version_absente_ecartee(self):
        source = "With Qwen4-Max, Alibaba puts the open source jacket back on"
        self.assertIsNone(
            texts.off_topic("Alibaba publie Qwen4-Max en open source.", source)
        )
        self.assertIn(
            "Qwen5",
            texts.off_topic("Alibaba publie Qwen5 en open source.", source) or "",
        )


if __name__ == "__main__":
    unittest.main()
