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


# Texte de source fictif : phrase à cheval sur deux, puis trois pages, avec pieds et
# en-têtes de page faits d'un numéro (pdftotext : « …fin de page\n\n12\n\f… »)
PAGES_A_CHEVAL = [
    "Programme fictif.\nNous créerons une taxe fictive sur les yachts\n\n12\n",
    "- 13 -\nde démonstration avant la fin du\n\n13/40\n",
    "14 / 40\nquinquennat. L'éco-\n",
    "nomie fictive suivra.\n  - 15 -  \n",
]


class CitationACheval(unittest.TestCase):
    def setUp(self):
        self.controle = common.texte_de_controle(PAGES_A_CHEVAL)

    def pages(self, citation: str) -> list[int]:
        return common.pages_de_citation(self.controle, citation)

    def test_citation_dans_une_page(self):
        self.assertEqual(self.pages("Programme fictif. Nous créerons une taxe"), [1])

    def test_citation_sur_deux_pages_page_de_debut(self):
        self.assertEqual(
            self.pages("une taxe fictive sur les yachts de démonstration avant la fin"),
            [1],
        )

    def test_citation_sur_trois_pages(self):
        self.assertEqual(
            self.pages(
                "Nous créerons une taxe fictive sur les yachts de démonstration avant"
                " la fin du quinquennat."
            ),
            [1],
        )
        self.assertEqual(self.pages("avant la fin du quinquennat."), [2])

    def test_cesure_a_cheval(self):
        self.assertEqual(self.pages("L'économie fictive suivra."), [3])

    def test_numeros_de_page_ignores_seulement_au_bord(self):
        # Le numéro de pied de page n'appartient pas au texte de contrôle...
        self.assertEqual(self.pages("les yachts 12 de démonstration"), [])
        self.assertNotIn("13/40", self.controle.texte)
        # ... mais reste dans la page elle-même (rien n'est retiré du texte stocké)
        self.assertEqual(self.pages("les yachts 12"), [1])
        self.assertIn("12", PAGES_A_CHEVAL[0])

    def test_nombre_au_milieu_d_une_page_garde(self):
        controle = common.texte_de_controle(["Avant\n2030\napres le saut\n", "Suite."])
        self.assertEqual(common.pages_de_citation(controle, "Avant 2030 apres"), [1])
        self.assertEqual(
            common.pages_de_citation(controle, "Avant 2030 apres le saut Suite."), [1]
        )

    def test_page_vide_et_citation_introuvable(self):
        controle = common.texte_de_controle(["Fin de la\n", "\n7\n", "phrase ici."])
        self.assertEqual(
            common.pages_de_citation(controle, "Fin de la phrase ici."), [1]
        )
        self.assertEqual(common.pages_de_citation(controle, "phrase ici."), [3])
        self.assertEqual(common.pages_de_citation(controle, "Absente du texte"), [])
        self.assertEqual(common.pages_de_citation(controle, "  "), [])

    def test_plusieurs_occurrences(self):
        controle = common.texte_de_controle(["Une phrase.\n", "1\nUne phrase."])
        self.assertEqual(common.pages_de_citation(controle, "Une phrase."), [1, 2])

    def test_annee_ou_montant_en_bord_de_page_garde(self):
        # Au-delà du nombre de pages + MARGE_NUMERO : pas un numéro de page
        controle = common.texte_de_controle(["Le SMIC sera porté à\n", "1600\neuros."])
        self.assertEqual(common.pages_de_citation(controle, "porté à euros."), [])
        self.assertEqual(common.pages_de_citation(controle, "porté à 1600 euros."), [1])
        controle = common.texte_de_controle(["Objectif\n", "2030\nzéro carbone."])
        self.assertEqual(
            common.pages_de_citation(controle, "Objectif 2030 zéro carbone."), [1]
        )

    def test_cesure_avant_une_page_vide_debuts_tries(self):
        controle = common.texte_de_controle(
            ["Une forte écono-\n", "\n", "mie fictive."]
        )
        self.assertEqual(list(controle.debuts), sorted(controle.debuts))
        self.assertEqual(common.pages_de_citation(controle, "économie fictive."), [1])
        self.assertEqual(common.pages_de_citation(controle, "mie fictive."), [3])

    def test_numeros_de_page_reconnus(self):
        for ligne in ("12", " - 12 - ", "12/40", "12 / 40", "\u2013 3 \u2013"):
            with self.subTest(ligne=ligne):
                controle = common.texte_de_controle([f"Début\n{ligne}\n", "fin."])
                self.assertEqual(controle.texte, "Début fin.")
        for ligne in ("Page 12", "12 mesures", "2027-2032"):
            with self.subTest(ligne=ligne):
                controle = common.texte_de_controle([f"Début\n{ligne}\n", "fin."])
                self.assertIn(common.normaliser(ligne), controle.texte)


def livret(pages: list[str], tete: str = "", pied: str = "") -> list[str]:
    """Pages d'un livret fictif, avec en-tête et pied de page répétés (numéro en fin)."""
    return [
        (f"{tete} {n}\n" if tete else "") + page + (f"\n{pied}\n{n}\n" if pied else "")
        for n, page in enumerate(pages, 1)
    ]


# Contenu propre à chaque page (sans chiffre : « page # » ferait un titre courant)
MOTS = ["un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix"]


class TitreCourant(unittest.TestCase):
    PAGES = [f"Contenu fictif {mot}." for mot in MOTS[:8]]
    A_CHEVAL = "Contenu fictif deux. Contenu fictif trois."

    def pages(self, pages: list[str], citation: str) -> list[int]:
        return common.pages_de_citation(common.texte_de_controle(pages), citation)

    def test_titre_courant_en_pied_ignore(self):
        pages = livret(self.PAGES, pied=f"L{APOSTROPHE}IA au service des Français")
        self.assertEqual(self.pages(pages, self.A_CHEVAL), [2])
        # Le titre courant reste dans chaque page (texte stocké intact)
        self.assertEqual(
            self.pages(pages, "fictif deux. L'IA au service des Français"), [2]
        )
        self.assertNotIn("Français", common.texte_de_controle(pages).texte)

    def test_titre_courant_en_tete_avec_numero_ignore(self):
        # « Programme fictif 2027 - page 3 » : le numéro change d'une page à l'autre
        pages = livret(self.PAGES, tete="Programme fictif 2027 - page")
        self.assertEqual(self.pages(pages, self.A_CHEVAL), [2])

    def test_titre_courant_en_tete_et_en_pied(self):
        pages = livret(self.PAGES, tete="Mouvement fictif", pied="www.fictif.invalid")
        self.assertEqual(self.pages(pages, self.A_CHEVAL), [2])

    def test_petit_document_trente_pour_cent(self):
        # 5 pages : 2 pages suffisent (30 % arrondi au-dessus, jamais moins de 2)
        pages = livret(self.PAGES[:5], pied="Livret fictif")
        self.assertEqual(self.pages(pages, self.A_CHEVAL), [2])
        pages = [
            "Livret fictif\nContenu fictif un.",
            "Contenu fictif deux.\nLivret fictif",
            *self.PAGES[2:5],
        ]
        self.assertEqual(self.pages(pages, self.A_CHEVAL), [2])

    def test_ligne_repetee_deux_fois_seulement_gardee(self):
        # 10 pages : seuil de 3 pages ; une ligne de bord vue 2 fois reste du contenu
        pages = [f"Contenu fictif {mot}." for mot in MOTS]
        pages[1] += "\nNote fictive"
        pages[5] += "\nNote fictive"
        self.assertEqual(self.pages(pages, self.A_CHEVAL), [])
        self.assertEqual(
            self.pages(pages, "fictif deux. Note fictive Contenu fictif trois."), [2]
        )

    def test_ligne_de_contenu_repetee_au_milieu_gardee(self):
        # Même ligne au milieu de chaque page (au-delà des 3 lignes de bord) : gardée
        pages = [
            f"Début {mot}.\nSuite {mot}.\nAutre {mot}.\nMesure fictive répétée\n"
            f"Encore {mot}.\nPresque {mot}.\nFin {mot}."
            for mot in MOTS[:8]
        ]
        controle = common.texte_de_controle(pages)
        self.assertEqual(controle.texte.count("Mesure fictive répétée"), 8)
        self.assertEqual(self.pages(pages, "Fin deux. Début trois."), [2])

    def test_titre_courant_seulement_au_bord(self):
        # Le titre courant cité au milieu d'une page reste trouvé à cette page
        pages = livret(self.PAGES, pied="Livret fictif")
        pages[3] = "Début.\nLivret fictif\nFin.\nLivret fictif\n4\n"
        controle = common.texte_de_controle(pages)
        self.assertIn("Début. Livret fictif Fin.", controle.texte)
        self.assertEqual(
            common.pages_de_citation(controle, "Début. Livret fictif Fin."), [4]
        )

    def test_numeros_seuls_restent_bornes(self):
        # Une ligne sans lettre n'est jamais un titre courant : le bornage s'applique
        pages = [f"Phrase {mot} coupée\n2030\n" for mot in MOTS[:5]]
        controle = common.texte_de_controle(pages)
        self.assertEqual(controle.texte.count("2030"), 5)
        for mot in MOTS[:5]:
            self.assertIn(f"Phrase {mot} coupée", controle.texte)

    def test_pied_d_une_page_et_tete_de_la_suivante_gardes(self):
        # Tête et pied comptés à part : même ligne en pied de 1 et en tête de 2, gardée
        pages = [
            "Intro.\nNous investirons 1 milliard",
            "Nous investirons 2 milliards\nFin.",
        ]
        controle = common.texte_de_controle(pages)
        self.assertEqual(
            controle.texte,
            "Intro. Nous investirons 1 milliard Nous investirons 2 milliards Fin.",
        )

    def test_grand_nombre_pas_un_numero_de_page(self):
        # Au-delà du nombre de pages + MARGE_NUMERO, un nombre distingue les lignes
        pages = [
            f"Contenu fictif {mot}.\nEnveloppe de {n}00 euros"
            for n, mot in zip(range(1, 6), MOTS)
        ]
        controle = common.texte_de_controle(pages)
        self.assertIn("Enveloppe de 300 euros", controle.texte)

    def test_page_faite_d_un_titre_et_cesure_a_travers(self):
        pages = livret(["Une forte écono-", "", "mie fictive."], tete="Livret fictif")
        controle = common.texte_de_controle(pages)
        self.assertEqual(controle.texte, "Une forte économie fictive.")
        self.assertEqual(list(controle.debuts), sorted(controle.debuts))
        self.assertEqual(common.pages_de_citation(controle, "forte économie"), [1])


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
