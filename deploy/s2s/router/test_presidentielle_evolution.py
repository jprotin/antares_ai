"""Vue « Évolution » de la présidentielle : lignée des documents (remplace), copies
figées des fiches (historique/), textes versionnés (textes/), comparaison mot pour mot,
routes GET /api/presidentielle/evolution/… et gestes de l'outil de saisie (source
ajouter --remplace, textes reconstruire, copies écrites à la publication).

python -m unittest test_presidentielle_evolution (dans router/, cf. README).
"""

import hashlib
import json
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path
from typing import Any
from unittest import mock

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle
import presidentielle_evolution as evolution
import presidentielle_schema as schema
import presidentielle_tool as tool

# Modules importés, pas leurs classes : la découverte relancerait leurs tests ici
import test_presidentielle_routes as routes_tests
import test_presidentielle_tool as tool_tests

DEMO = Path(__file__).parent / "fixtures" / "presidentielle" / "demo"
CARLA = "candidats/carla-exemplia.yaml"


def source(**champs) -> schema.Source:
    base = {
        "titre": "Document fictif",
        "url": "https://exemple.invalid/doc",
        "niveau": "candidat",
        "consulte_le": "2026-11-20",
        "candidat": "carla-exemplia",
    }
    return schema.Source.model_validate({**base, **champs})


class Lignee(unittest.TestCase):
    def test_se_remplacer_soi_meme_refuse(self):
        with self.assertRaisesRegex(ValueError, "se remplace elle-même"):
            source(id="a", remplace="a")

    def test_lignee_valide(self):
        sources = [
            source(id="a"),
            source(id="b", remplace="a"),
            source(id="c", remplace="b"),
        ]
        self.assertEqual(schema.controler_lignee(sources), [])
        chaines = schema.lignees(sources, "carla-exemplia")
        self.assertEqual([[s.id for s in c] for c in chaines], [["a", "b", "c"]])
        self.assertEqual(schema.lignees(sources, "aline-fictiva"), [])

    def test_source_seule_hors_lignee(self):
        self.assertEqual(schema.lignees([source(id="a")], "carla-exemplia"), [])

    def test_remplace_inconnue(self):
        problemes = schema.controler_lignee([source(id="b", remplace="absente")])
        self.assertEqual([i for i, _ in problemes], ["b"])
        self.assertIn("inconnue", problemes[0][1])

    def test_remplace_autre_candidat(self):
        problemes = schema.controler_lignee(
            [source(id="a", candidat="aline-fictiva"), source(id="b", remplace="a")]
        )
        self.assertEqual([i for i, _ in problemes], ["b"])
        self.assertIn("autre candidat", problemes[0][1])

    def test_deux_remplacantes_refusees(self):
        problemes = schema.controler_lignee(
            [source(id="a"), source(id="b", remplace="a"), source(id="c", remplace="a")]
        )
        self.assertEqual(sorted(i for i, _ in problemes), ["b", "c"])
        self.assertIn("déjà remplacée", problemes[0][1])

    def test_boucle_refusee(self):
        problemes = schema.controler_lignee(
            [source(id="a", remplace="b"), source(id="b", remplace="a")]
        )
        self.assertEqual(sorted(i for i, _ in problemes), ["a", "b"])
        self.assertTrue(all("boucle" in m for _, m in problemes))


class Base(unittest.TestCase):
    """Copie du jeu fictif (historique et textes de Carla Exemplia compris)."""

    def setUp(self):
        self.dossier = Path(tempfile.mkdtemp()) / "presidentielle"
        shutil.copytree(DEMO, self.dossier)
        self.addCleanup(shutil.rmtree, self.dossier.parent)

    def ecrire(self, rel: str, data) -> None:
        path = self.dossier / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.safe_dump(
                data, explicit_start=True, sort_keys=False, allow_unicode=True
            ),
            encoding="utf-8",
        )

    def lire(self, rel: str):
        return yaml.safe_load((self.dossier / rel).read_text(encoding="utf-8"))

    def etat(self) -> presidentielle.Etat:
        return presidentielle.relire(self.dossier)

    def evolution(self, slug: str = "carla-exemplia") -> dict:
        etat = self.etat()
        return evolution.evolution(etat, etat.fiches[slug])


class Lecture(Base):
    def test_jeu_fictif_sans_erreur(self):
        self.assertEqual(self.etat().erreurs, [])

    def test_lignee_en_defaut_ecarte_la_source(self):
        data = self.lire("sources.yaml")
        data["sources"][-1]["remplace"] = "absente"
        self.ecrire("sources.yaml", data)
        etat = self.etat()
        self.assertNotIn(data["sources"][-1]["id"], etat.sources)
        self.assertTrue(
            any("remplace une source inconnue" in e.message for e in etat.erreurs)
        )

    def test_frise_de_carla(self):
        versions = self.evolution()["versions"]
        self.assertEqual([v["version"] for v in versions], [2, 1])
        v2, v1 = versions
        self.assertEqual(v2["motif"], "Ajout d'une mesure sur les institutions")
        self.assertEqual(v2["comparee_a"], 1)
        changements = v2["changements"]
        self.assertEqual(
            [m["id"] for m in changements["mesures_ajoutees"]],
            ["institutions-referendum"],
        )
        self.assertEqual(changements["mesures_retirees"], [])
        [reformulee] = changements["mesures_reformulees"]
        self.assertEqual(reformulee["id"], "sante-centres")
        self.assertTrue(reformulee["citation_modifiee"])
        self.assertEqual(
            reformulee["avant"]["citation"],
            "Chaque canton aura son centre de santé public",
        )
        self.assertEqual(reformulee["apres"]["source"]["id"], "carla-programme")
        self.assertIsNone(changements["statut"])
        self.assertEqual(v1["date"], "2026-11-19")
        self.assertIsNone(v1["changements"])
        self.assertTrue(v1["conservee"])

    def test_sans_historique_la_fiche_publiee_sert_de_copie(self):
        [version] = self.evolution("aline-fictiva")["versions"]
        self.assertEqual(version["version"], 1)
        self.assertTrue(version["conservee"])
        self.assertEqual(version["motif"], "Publication de la fiche fictive")

    def test_version_au_journal_sans_copie_non_conservee(self):
        (self.dossier / "historique/carla-exemplia/v1.yaml").unlink()
        versions = self.evolution()["versions"]
        self.assertEqual([v["conservee"] for v in versions], [True, False])
        self.assertEqual(versions[1]["motif"], "Publication de la fiche fictive")
        self.assertIsNone(versions[0]["changements"])

    def test_copie_illisible_ou_trompeuse_ignoree(self):
        path = self.dossier / "historique/carla-exemplia/v1.yaml"
        data = self.lire("historique/carla-exemplia/v1.yaml")
        data["id"] = "aline-fictiva"
        self.ecrire("historique/carla-exemplia/v1.yaml", data)
        fiches, erreurs = evolution.versions_figees(self.dossier, "carla-exemplia")
        self.assertEqual(sorted(fiches), [2])
        self.assertIn("différente du chemin", erreurs[0])
        path.write_text("{{{", encoding="utf-8")
        fiches, erreurs = evolution.versions_figees(self.dossier, "carla-exemplia")
        self.assertEqual(sorted(fiches), [2])
        self.assertIn("YAML invalide", erreurs[0])

    def test_lien_symbolique_ignore(self):
        cible = self.dossier.parent / "dehors.yaml"
        shutil.copyfile(self.dossier / "historique/carla-exemplia/v1.yaml", cible)
        (self.dossier / "historique/carla-exemplia/v1.yaml").unlink()
        (self.dossier / "historique/carla-exemplia/v1.yaml").symlink_to(cible)
        fiches, _ = evolution.versions_figees(self.dossier, "carla-exemplia")
        self.assertEqual(sorted(fiches), [2])

    def test_version_posterieure_a_la_fiche_ignoree(self):
        data = self.lire(CARLA)
        data["version"] = 9
        self.ecrire("historique/carla-exemplia/v9.yaml", data)
        self.assertEqual([v["version"] for v in self.evolution()["versions"]], [2, 1])

    def test_statut_et_nouvelle_source(self):
        data = self.lire(CARLA)
        data.update(version=3, statut="officiel", mise_a_jour="2026-11-21")
        data["mesures"].append(
            {
                "id": "educ-bibliotheque",
                "theme": "education",
                "citation": "Chaque école fictive aura une bibliothèque ouverte aux familles.",
                "source_id": "carla-programme-2",
                "page": 5,
                "ajoutee_le": "2026-11-21",
            }
        )
        data["mesures"] = [
            m for m in data["mesures"] if m["id"] != "immigration-titres"
        ]
        self.ecrire(CARLA, data)
        self.ecrire("historique/carla-exemplia/v3.yaml", data)
        v3 = self.evolution()["versions"][0]
        self.assertEqual(v3["version"], 3)
        self.assertIsNone(v3["motif"])
        changements = v3["changements"]
        self.assertEqual(changements["statut"]["avant"], "declare")
        self.assertEqual(changements["statut"]["apres"], "officiel")
        self.assertEqual(
            [s["id"] for s in changements["nouvelles_sources"]], ["carla-programme-2"]
        )
        self.assertEqual(changements["nouvelles_sources"][0]["publie_le"], "2026-11-19")
        self.assertEqual(
            [m["id"] for m in changements["mesures_retirees"]], ["immigration-titres"]
        )
        self.assertEqual(
            [m["id"] for m in changements["mesures_ajoutees"]], ["educ-bibliotheque"]
        )
        # Première apparition dans la version révisée du programme
        parcours = {
            m["mesure"]["id"]: m for m in self.evolution()["programmes"][0]["mesures"]
        }
        self.assertEqual(parcours["educ-bibliotheque"]["premiere"], "carla-programme-2")
        self.assertEqual(parcours["educ-bibliotheque"]["page_premiere"], 5)
        self.assertIsNone(parcours["educ-bibliotheque"]["disparue"])

    def retirer_pour_erreur(self, version: int, mesure_id: str) -> dict:
        """Version `version` de Carla sans `mesure_id`, retirée pour erreur au
        journal (comme publier --retrait-erreur) ; renvoie la fiche écrite."""
        data = self.lire(CARLA)
        data.update(version=version, mise_a_jour="2026-11-21")
        data["mesures"] = [m for m in data["mesures"] if m["id"] != mesure_id]
        self.ecrire(CARLA, data)
        self.ecrire(f"historique/carla-exemplia/v{version}.yaml", data)
        journal = self.lire("journal.yaml")
        journal["entrees"].append(
            {
                "date": "2026-11-21",
                "objet": "fiche",
                "cible": "carla-exemplia",
                "version": version,
                "motif": "Correction d'une erreur de saisie",
                "retraits_erreur": [mesure_id],
            }
        )
        self.ecrire("journal.yaml", journal)
        rattachements = self.lire("quiz/rattachements.yaml")
        rattachements["rattachements"] = [
            r for r in rattachements["rattachements"] if r["mesure_id"] != mesure_id
        ]
        self.ecrire("quiz/rattachements.yaml", rattachements)
        return data

    def test_retrait_pour_erreur_masque_le_texte_dans_toute_la_frise(self):
        # sante-centres : v1, reformulée en v2, retirée pour erreur en v3
        citations = [
            "Chaque canton aura son centre de santé public",
            "médecins salariés",
        ]
        self.assertIn(citations[1], self.texte_json())
        self.retirer_pour_erreur(3, "sante-centres")
        self.assertEqual(self.etat().erreurs, [])
        masquee = {"id": "sante-centres", "retrait_erreur": "2026-11-21"}
        v3, v2, v1 = self.evolution()["versions"]
        self.assertEqual(v3["changements"]["mesures_retirees"], [masquee])
        self.assertEqual(v3["motif"], "Correction d'une erreur de saisie")
        [reformulee] = v2["changements"]["mesures_reformulees"]
        self.assertEqual((reformulee["avant"], reformulee["apres"]), (masquee, masquee))
        self.assertIsNone(v1["changements"])
        # Les autres mesures gardent leur texte et leur source
        [ajoutee] = v2["changements"]["mesures_ajoutees"]
        self.assertEqual(ajoutee["id"], "institutions-referendum")
        self.assertIn("citation", ajoutee)
        self.assertIsNotNone(ajoutee["source"])
        texte = self.texte_json()
        for citation in citations:
            self.assertNotIn(citation, texte)
        # Copies figées inchangées (traçabilité dans git)
        self.assertIn(
            citations[0],
            (self.dossier / "historique/carla-exemplia/v1.yaml").read_text("utf-8"),
        )

    def test_source_citee_seulement_par_la_mesure_retiree_jamais_montree(self):
        data = self.lire(CARLA)
        data.update(version=3, mise_a_jour="2026-11-21")
        data["mesures"].append(
            {
                "id": "mesure-erronee",
                "theme": "education",
                "citation": "Citation fictive attribuée par erreur.",
                "source_id": "carla-programme-2",
                "page": 5,
                "ajoutee_le": "2026-11-21",
            }
        )
        self.ecrire(CARLA, data)
        self.ecrire("historique/carla-exemplia/v3.yaml", data)
        self.retirer_pour_erreur(4, "mesure-erronee")
        v4, v3, _, _ = self.evolution()["versions"]
        masquee = {"id": "mesure-erronee", "retrait_erreur": "2026-11-21"}
        self.assertEqual(v3["changements"]["mesures_ajoutees"], [masquee])
        self.assertEqual(v3["changements"]["nouvelles_sources"], [])
        self.assertEqual(v4["changements"]["mesures_retirees"], [masquee])
        self.assertEqual(v4["changements"]["nouvelles_sources"], [])
        self.assertNotIn("attribuée par erreur", self.texte_json())

    def test_retrait_ordinaire_garde_le_texte(self):
        data = self.retirer_pour_erreur(3, "sante-centres")
        journal = self.lire("journal.yaml")
        del journal["entrees"][-1]["retraits_erreur"]
        self.ecrire("journal.yaml", journal)
        self.assertEqual(data["version"], 3)
        v3 = self.evolution()["versions"][0]
        [retiree] = v3["changements"]["mesures_retirees"]
        self.assertIn("médecins salariés", retiree["citation"])

    def test_mesure_reprise_apres_retrait_pour_erreur_visible_ensuite(self):
        retiree = next(
            m for m in self.lire(CARLA)["mesures"] if m["id"] == "sante-centres"
        )
        data = self.retirer_pour_erreur(3, "sante-centres")
        reprise = {**retiree, "citation": "Un centre de santé fictif par canton."}
        data.update(version=4, mesures=[*data["mesures"], reprise])
        self.ecrire(CARLA, data)
        self.ecrire("historique/carla-exemplia/v4.yaml", data)
        v4, v3, _, _ = self.evolution()["versions"]
        [ajoutee] = v4["changements"]["mesures_ajoutees"]
        self.assertEqual(ajoutee["citation"], "Un centre de santé fictif par canton.")
        self.assertEqual(
            v3["changements"]["mesures_retirees"],
            [{"id": "sante-centres", "retrait_erreur": "2026-11-21"}],
        )

    def texte_json(self) -> str:
        return json.dumps(self.evolution(), ensure_ascii=False)

    def test_programmes_premiere_apparition_et_disparition(self):
        [programme] = self.evolution()["programmes"]
        self.assertEqual(
            [v["id"] for v in programme["versions"]],
            ["carla-programme", "carla-programme-2"],
        )
        self.assertTrue(all(v["texte"] for v in programme["versions"]))
        parcours = {m["mesure"]["id"]: m for m in programme["mesures"]}
        self.assertEqual(parcours["eco-bareme"]["premiere"], "carla-programme")
        self.assertEqual(parcours["eco-bareme"]["page_premiere"], 2)
        self.assertIsNone(parcours["eco-bareme"]["disparue"])
        self.assertEqual(
            parcours["immigration-titres"]["disparue"], "carla-programme-2"
        )
        self.assertFalse(
            parcours["immigration-titres"]["presences"]["carla-programme-2"]["presente"]
        )
        # Aucun programme en plusieurs versions : liste vide, même gabarit
        self.assertEqual(self.evolution("aline-fictiva")["programmes"], [])

    def couper_eco_bareme(self) -> None:
        """Citation eco-bareme de carla-programme coupée par un saut de page, avec pied
        « 2 » et en-tête « - 3 - » (texte versionné du jeu fictif, copie de test)."""
        sha = next(
            s["sha256"]
            for s in self.lire("sources.yaml")["sources"]
            if s["id"] == "carla-programme"
        )
        path = self.dossier / "textes" / f"{sha}.txt"
        pages = path.read_text(encoding="utf-8").split("\f")
        pages[1] = pages[1].replace(
            "sur le revenu ne sera pas", "sur le revenu\n\n2\n\f- 3 -\nne sera pas"
        )
        path.write_text("\f".join(pages), encoding="utf-8")

    def test_citation_a_cheval_presente_page_de_debut(self):
        self.couper_eco_bareme()
        [programme] = self.evolution()["programmes"]
        parcours = {m["mesure"]["id"]: m for m in programme["mesures"]}
        eco = parcours["eco-bareme"]
        self.assertEqual(
            eco["presences"]["carla-programme"], {"presente": True, "page": 2}
        )
        self.assertEqual(
            (eco["premiere"], eco["page_premiere"]), ("carla-programme", 2)
        )
        self.assertIsNone(eco["disparue"])

    def test_presence_meme_regle_que_le_controle(self):
        controle = evolution.common.texte_de_controle(
            ["Une phrase fictive\n\n- 4 -\n", "5/9\ncoupée en deux.", "Autre."]
        )
        self.assertEqual(
            evolution.presence(controle, "Une phrase fictive coupée en deux."),
            {"presente": True, "page": 1},
        )
        self.assertEqual(
            evolution.presence(controle, "coupée en deux. Autre."),
            {"presente": True, "page": 2},
        )
        self.assertEqual(
            evolution.presence(controle, "fictive 4 coupée"),
            {"presente": False, "page": None},
        )
        self.assertEqual(
            evolution.presence(None, "x"), {"presente": None, "page": None}
        )

    def test_presence_titre_courant_ignore_au_saut_de_page(self):
        pages = [
            f"Programme fictif\nPage {mot}.\nwww.fictif.invalid"
            for mot in ("une", "deux", "trois")
        ]
        pages[1] = "Programme fictif\nUne phrase fictive\nwww.fictif.invalid"
        pages[2] = "Programme fictif\ncoupée en deux.\nwww.fictif.invalid"
        controle = evolution.common.texte_de_controle(pages)
        self.assertEqual(
            evolution.presence(controle, "Une phrase fictive coupée en deux."),
            {"presente": True, "page": 2},
        )

    def test_texte_absent_presence_inconnue(self):
        for path in (self.dossier / "textes").glob("*.txt"):
            path.unlink()
        [programme] = self.evolution()["programmes"]
        self.assertFalse(any(v["texte"] for v in programme["versions"]))
        for parcours in programme["mesures"]:
            self.assertIsNone(parcours["premiere"])
            self.assertIsNone(parcours["presences"]["carla-programme"]["presente"])


class Comparaison(Base):
    def comparer(self, de="carla-programme", a="carla-programme-2") -> dict:
        etat = self.etat()
        return evolution.comparaison(etat, etat.fiches["carla-exemplia"], de, a)

    def test_blocs_dans_l_ordre_avec_les_pages(self):
        resultat = self.comparer()
        types = [
            (b["type"], b["page_avant"], b["page_apres"]) for b in resultat["blocs"]
        ]
        self.assertIn(("ajoute", None, 5), types)
        modifie = next(
            b for b in resultat["blocs"] if b["avant"] and "trois mois" in b["avant"]
        )
        self.assertEqual(modifie["type"], "modifie")
        self.assertEqual((modifie["page_avant"], modifie["page_apres"]), (11, 10))
        self.assertIn({"type": "retire", "texte": "trois"}, modifie["mots"])
        self.assertIn({"type": "ajoute", "texte": "deux"}, modifie["mots"])
        self.assertGreater(resultat["inchanges"], 0)
        self.assertFalse(resultat["tronque"])
        self.assertEqual(resultat["de"]["publie_le"], "2026-11-05")

    def test_sens_inverse(self):
        resultat = self.comparer("carla-programme-2", "carla-programme")
        self.assertIn(
            ("retire", 5), [(b["type"], b["page_avant"]) for b in resultat["blocs"]]
        )

    def test_meme_version_refusee(self):
        with self.assertRaisesRegex(evolution.ComparaisonImpossible, "différentes"):
            self.comparer("carla-programme", "carla-programme")

    def test_hors_lignee_refusee(self):
        with self.assertRaises(evolution.ComparaisonImpossible) as ctx:
            self.comparer("carla-programme", "aline-programme")
        self.assertEqual(ctx.exception.statut, 404)

    def test_texte_manquant(self):
        etat = self.etat()
        sha = etat.sources["carla-programme-2"].sha256
        (self.dossier / f"textes/{sha}.txt").unlink()
        with self.assertRaisesRegex(evolution.ComparaisonImpossible, "non disponible"):
            self.comparer()

    def test_texte_trop_long(self):
        with mock.patch.object(evolution, "TEXTE_MAX", 100):
            with self.assertRaisesRegex(evolution.ComparaisonImpossible, "trop long"):
                self.comparer()

    def test_blocs_bornes(self):
        with mock.patch.object(evolution, "BLOCS_MAX", 2):
            resultat = self.comparer()
        self.assertEqual(len(resultat["blocs"]), 2)
        self.assertTrue(resultat["tronque"])

    def test_paragraphes_de_pdf_sans_ligne_vide(self):
        pages = [
            "Une phrase coupée\nen deux lignes.\nUne autre phrase\nsans fin",
            "Page deux.",
        ]
        self.assertEqual(
            evolution.paragraphes(pages),
            [
                (1, "Une phrase coupée en deux lignes."),
                (1, "Une autre phrase sans fin"),
                (2, "Page deux."),
            ],
        )

    def test_mots_apostrophes_typographiques_egales(self):
        segments = evolution.mots("L’impôt baissera.", "L'impôt baissera.")
        self.assertEqual([s["type"] for s in segments], ["egal"])


class Revue(Base):
    """Cas relevés à la revue : exactitude des dates d'apparition, charge des invités."""

    def comparer(self, **kwargs) -> dict:
        etat = self.etat()
        return evolution.comparaison(
            etat, etat.fiches["carla-exemplia"], "carla-programme", "carla-programme-2",
            **kwargs,
        )  # fmt: skip

    def test_premiere_incertaine_si_texte_anterieur_absent(self):
        ids = ["v1", "v2", "v3"]
        presences = {
            "v1": {"presente": None, "page": None},
            "v2": {"presente": True, "page": 4},
            "v3": {"presente": True, "page": 4},
        }
        parcours = evolution.parcours_citation(ids, presences)
        self.assertEqual(parcours["premiere"], "v2")
        self.assertTrue(parcours["premiere_incertaine"])
        presences["v1"] = {"presente": False, "page": None}
        self.assertFalse(
            evolution.parcours_citation(ids, presences)["premiere_incertaine"]
        )

    def test_disparition_puis_retour(self):
        ids = ["v1", "v2", "v3"]
        presences = {
            "v1": {"presente": True, "page": 1},
            "v2": {"presente": False, "page": None},
            "v3": {"presente": True, "page": 2},
        }
        parcours = evolution.parcours_citation(ids, presences)
        self.assertEqual(parcours["disparue"], "v2")
        self.assertEqual(parcours["reapparue"], "v3")

    def test_calcul_occupe_503_sans_attente_infinie(self):
        evolution.vider_cache()
        with mock.patch.object(evolution, "ATTENTE_CALCUL", 0.01):
            evolution._verrou_calcul.acquire()
            try:
                with self.assertRaises(evolution.ComparaisonImpossible) as ctx:
                    self.comparer()
            finally:
                evolution._verrou_calcul.release()
        self.assertEqual(ctx.exception.statut, 503)

    def test_appel_en_cours_409_hors_cache_seulement(self):
        evolution.vider_cache()
        with self.assertRaises(evolution.ComparaisonImpossible) as ctx:
            self.comparer(appel_en_cours=lambda: True)
        self.assertEqual(ctx.exception.statut, 409)
        premier = self.comparer()
        # En cache : servie même pendant un appel, sans nouveau calcul
        with mock.patch.object(
            evolution, "comparer_textes", side_effect=AssertionError
        ):
            self.assertEqual(self.comparer(appel_en_cours=lambda: True), premier)

    def test_appel_qui_commence_pendant_le_calcul_l_arrete(self):
        evolution.vider_cache()
        # Libre au premier contrôle, appel commencé ensuite : 409, rien de gardé
        # (contrôle avant le calcul, puis premier contrôle du calcul)
        reponses = iter([False, False])
        with self.assertRaises(evolution.ComparaisonImpossible) as ctx:
            with mock.patch.object(evolution, "VERIFICATION_APPEL", 0):
                self.comparer(appel_en_cours=lambda: next(reponses, True))
        self.assertEqual(ctx.exception.statut, 409)
        self.assertFalse(evolution._verrou_calcul.locked())
        self.assertFalse([c for c in evolution._cache if c[0] == "comparaison"])
        self.assertIn("blocs", self.comparer())

    def test_calcul_trop_long_arrete_et_memorise(self):
        evolution.vider_cache()
        with mock.patch.object(evolution, "DUREE_CALCUL_MAX", -1):
            with self.assertRaises(evolution.ComparaisonImpossible) as ctx:
                self.comparer()
        self.assertEqual(ctx.exception.statut, 422)
        self.assertIn("trop longue", str(ctx.exception))
        # Mémorisé : aucun nouveau calcul pour ces deux textes
        with mock.patch.object(
            evolution, "comparer_textes", side_effect=AssertionError
        ):
            with self.assertRaises(evolution.ComparaisonImpossible):
                self.comparer()
        # Deux heures plus tard, marque périmée (une heure) : nouveau calcul
        horloge = evolution.time.monotonic
        with mock.patch.object(evolution.time, "monotonic", lambda: horloge() + 7_200):
            self.assertIn("blocs", self.comparer())
        evolution.vider_cache()

    def test_cache_borne_en_taille_totale(self):
        evolution.vider_cache()
        with mock.patch.object(evolution, "CACHE_CARACTERES_MAX", 1_000):
            evolution._ranger_cache(("texte", "a"), ["x" * 600])
            evolution._ranger_cache(("comparaison", "b"), {"blocs": ["y" * 300]})
            self.assertEqual(len(evolution._cache_textes), 1)
            # Au-delà de la taille totale : le texte le plus ancien sort
            evolution._ranger_cache(("texte", "c"), ["z" * 600])
            self.assertNotIn(("texte", "a"), evolution._cache_textes)
            self.assertIn(("texte", "c"), evolution._cache_textes)
            self.assertLessEqual(evolution._total_cache, 1_000)
            # Valeur plus lourde que la borne : jamais gardée
            evolution._ranger_cache(("texte", "d"), ["w" * 2_000])
            self.assertNotIn(("texte", "d"), evolution._cache_textes)
        evolution.vider_cache()
        self.assertEqual(evolution._total_cache, 0)

    def test_reponse_bornee_en_caracteres(self):
        evolution.vider_cache()
        with mock.patch.object(evolution, "REPONSE_MAX", 150):
            resultat = self.comparer()
        evolution.vider_cache()
        self.assertTrue(resultat["tronque"])
        self.assertLessEqual(
            sum(
                len(b["avant"] or "") + len(b["apres"] or "") for b in resultat["blocs"]
            ),
            150,
        )

    def test_paragraphes_trop_longs_jamais_apparies(self):
        long_a = " ".join(["mot"] * 50)
        long_b = " ".join(["mot"] * 49 + ["autre"])
        with mock.patch.object(evolution, "MOTS_MAX", 10):
            self.assertEqual(evolution.apparier([long_a], [long_b]), [])
        self.assertEqual(evolution.apparier([long_a], [long_b]), [(0, 0)])

    def test_cesure_recollee(self):
        self.assertEqual(
            evolution.paragraphes(["La croissance de l'écono-\nmie sera soutenue."]),
            [(1, "La croissance de l'économie sera soutenue.")],
        )

    def test_copie_en_defaut_distinguee(self):
        (self.dossier / "historique/carla-exemplia/v1.yaml").write_text(
            "{{{", encoding="utf-8"
        )
        v1 = self.evolution()["versions"][1]
        self.assertFalse(v1["conservee"])
        self.assertTrue(v1["copie_en_defaut"])

    def test_fiche_publiee_fait_foi_pour_sa_version(self):
        data = self.lire("historique/carla-exemplia/v2.yaml")
        data["mesures"] = data["mesures"][:1]
        self.ecrire("historique/carla-exemplia/v2.yaml", data)
        v2 = self.evolution()["versions"][0]
        self.assertEqual(v2["mesures"], 4)


class RoutesEvolution(routes_tests.Base):
    client: Any
    router: Any

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.router = routes_tests.routeur()
        cls.client = TestClient(cls.router.app, headers={"x-antares": "1"})

    def setUp(self):
        super().setUp()
        self.addCleanup(self.router.SHARING_FLAG.unlink, missing_ok=True)
        patch = mock.patch.object(self.router, "SHARE_OWNER_EMAIL", routes_tests.OWNER)
        patch.start()
        self.addCleanup(patch.stop)

    def get(self, path: str, headers=None) -> dict:
        response = self.client.get(f"/api/presidentielle{path}", headers=headers or {})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_evolution_ouverte_aux_invites(self):
        self.router.SHARING_FLAG.touch()
        body = self.get("/evolution/carla-exemplia", headers=routes_tests.GUEST)
        self.assertEqual([v["version"] for v in body["versions"]], [2, 1])
        self.assertEqual(len(body["programmes"]), 1)
        comparaison = self.get(
            "/evolution/carla-exemplia/comparaison?de=carla-programme&a=carla-programme-2",
            headers=routes_tests.GUEST,
        )
        self.assertTrue(comparaison["blocs"])

    def test_evolution_citation_a_cheval_sur_un_saut_de_page(self):
        sha = next(
            s["sha256"]
            for s in yaml.safe_load(
                (self.dossier / "sources.yaml").read_text(encoding="utf-8")
            )["sources"]
            if s["id"] == "carla-programme"
        )
        path = self.dossier / "textes" / f"{sha}.txt"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                "sur le revenu ne sera pas", "sur le revenu\n\n2\n\f3\nne sera pas"
            ),
            encoding="utf-8",
        )
        [programme] = self.get("/evolution/carla-exemplia")["programmes"]
        eco = next(m for m in programme["mesures"] if m["mesure"]["id"] == "eco-bareme")
        self.assertEqual(
            eco["presences"]["carla-programme"], {"presente": True, "page": 2}
        )

    def test_candidat_inconnu_404(self):
        for slug in ("inconnu", "Carla", "a" * 81):
            response = self.client.get(f"/api/presidentielle/evolution/{slug}")
            self.assertEqual(response.status_code, 404, slug)

    def test_comparaison_parametres_controles(self):
        for query in ("de=carla-programme", "de=../x&a=carla-programme-2", ""):
            response = self.client.get(
                f"/api/presidentielle/evolution/carla-exemplia/comparaison?{query}"
            )
            self.assertEqual(response.status_code, 422, query)
        response = self.client.get(
            "/api/presidentielle/evolution/carla-exemplia/comparaison"
            "?de=carla-programme&a=aline-programme"
        )
        self.assertEqual(response.status_code, 404)

    def test_entre_tours_deux_qualifies_seulement(self):
        def entre_tours(data):
            data.update(
                liste="officielle",
                liste_source="etat-declarations",
                phase="entre_tours",
                qualifies=["aline-fictiva", "bruno-demonstra"],
            )

        self.modifier("base.yaml", entre_tours)
        for slug in ("aline-fictiva", "bruno-demonstra"):
            self.modifier(
                f"candidats/{slug}.yaml", lambda d: d.update(statut="officiel")
            )
        self.assertEqual(
            self.client.get("/api/presidentielle/evolution/carla-exemplia").status_code,
            404,
        )
        self.assertEqual(
            self.get("/evolution/aline-fictiva")["candidat"], "aline-fictiva"
        )

    def test_aucune_ecriture(self):
        avant = sorted(str(p) for p in self.dossier.rglob("*"))
        self.get("/evolution/carla-exemplia")
        self.assertEqual(sorted(str(p) for p in self.dossier.rglob("*")), avant)


PROGRAMME_V1 = (
    "Économie\n\nNous créerons une taxe fictive sur les yachts de démonstration.\n"
)
PROGRAMME_V2 = (
    "Économie\n\nNous créerons une taxe fictive sur les yachts de démonstration.  \r\n"
    "\fSanté\n\nChaque village fictif aura une maison de santé.\n\n\n"
)


class Outil(tool_tests.Saisie):
    def ajouter(self, texte: str, nom: str, *options: str, candidat="aline-fictiva"):
        return self.lancer(
            "source", "ajouter", candidat, str(self.fichier(nom, texte)),
            "--niveau", "candidat", "--titre", "Programme fictif",
            "--url", f"https://{candidat}.exemple.invalid/{nom}", *options,
        )  # fmt: skip

    def test_source_ajouter_ecrit_le_texte_versionne(self):
        code, out, err = self.ajouter(PROGRAMME_V2, "v2.txt")
        self.assertEqual(code, 0, err)
        empreinte = hashlib.sha256(PROGRAMME_V2.encode("utf-8")).hexdigest()
        texte = self.texte(f"textes/{empreinte}.txt")
        self.assertTrue(texte.endswith("maison de santé.\n"))
        self.assertNotIn("\r", texte)
        self.assertNotIn(" \n", texte)
        self.assertEqual(len(texte.split("\f")), 2)
        self.assertIn(f"textes/{empreinte}.txt", out)
        self.assertIn("git", out)

    def test_source_ajouter_remplace(self):
        code, _, err = self.ajouter(PROGRAMME_V1, "v1.txt", "--id", "aline-prog-1")
        self.assertEqual(code, 0, err)
        code, out, err = self.ajouter(
            PROGRAMME_V2, "v2.txt", "--id", "aline-prog-2", "--remplace", "aline-prog-1"
        )
        self.assertEqual(code, 0, err)
        self.assertIn("Nouvelle version du document aline-prog-1", out)
        entree = self.lire("sources.yaml")["sources"][-1]
        self.assertEqual(entree["remplace"], "aline-prog-1")
        self.assertEqual(entree["consulte_le"], tool_tests.AUJOURD_HUI)
        etat = presidentielle.relire(self.dossier)
        self.assertEqual(etat.erreurs, [])
        chaines = schema.lignees(etat.sources.values(), "aline-fictiva")
        self.assertEqual(
            [[s.id for s in c] for c in chaines], [["aline-prog-1", "aline-prog-2"]]
        )
        # Une seule remplaçante par source
        code, _, err = self.ajouter(
            "Autre texte fictif de démonstration.\n",
            "v3.txt",
            "--remplace",
            "aline-prog-1",
        )
        self.assertEqual(code, 2)
        self.assertIn("déjà remplacée", err)

    def test_remplace_refusee_sans_rien_ecrire(self):
        avant = self.texte("sources.yaml")
        cas = (
            (("--remplace", "inconnue"), "inconnue"),
            (("--remplace", "bruno-programme"), "autre candidat"),
        )
        for options, attendu in cas:
            code, _, err = self.ajouter(PROGRAMME_V1, "v1.txt", *options)
            self.assertEqual(code, 2, options)
            self.assertIn(attendu, err)
            self.assertEqual(self.texte("sources.yaml"), avant)
        self.assertFalse((self.dossier / "documents").exists())

    def test_textes_reconstruire(self):
        code, _, _ = self.ajouter(PROGRAMME_V1, "v1.txt")
        self.assertEqual(code, 0)
        empreinte = hashlib.sha256(PROGRAMME_V1.encode("utf-8")).hexdigest()
        (self.dossier / f"textes/{empreinte}.txt").unlink()
        code, out, _ = self.lancer("verifier")
        self.assertIn("texte non versionné", out)
        code, out, _ = self.lancer("textes", "reconstruire")
        self.assertEqual(code, 0)
        self.assertIn("1 écrit(s)", out)
        self.assertTrue((self.dossier / f"textes/{empreinte}.txt").is_file())
        code, out, _ = self.lancer("textes", "reconstruire")
        self.assertIn("0 écrit(s)", out)

    def test_texte_versionne_sert_au_controle(self):
        code, _, _ = self.ajouter(PROGRAMME_V1, "v1.txt", "--id", "aline-prog-1")
        self.assertEqual(code, 0)
        shutil.rmtree(self.dossier / "documents")
        pages = tool.texte_source(
            self.dossier, presidentielle.relire(self.dossier).sources["aline-prog-1"]
        )
        self.assertIn("yachts", pages[0])

    def test_publier_ecrit_les_copies_figees(self):
        brouillon = self.lire(CARLA)
        brouillon["description"]["texte"] = "Description fictive, troisième version."
        tool.ecrire_yaml(self.dossier / "brouillons/carla-exemplia.yaml", brouillon)
        code, out, err = self.lancer("publier", "carla-exemplia")
        self.assertEqual(code, 0, err)
        copie = self.lire("historique/carla-exemplia/v3.yaml")
        self.assertEqual(copie, self.lire(CARLA))
        self.assertIn("historique/carla-exemplia/v3.yaml", out)

    def test_publier_fige_aussi_la_version_precedente(self):
        brouillon = self.lire("candidats/bruno-demonstra.yaml")
        avant = self.texte("candidats/bruno-demonstra.yaml")
        tool.ecrire_yaml(self.dossier / "brouillons/bruno-demonstra.yaml", brouillon)
        code, out, err = self.lancer("publier", "bruno-demonstra")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.texte("historique/bruno-demonstra/v1.yaml"), avant)
        self.assertEqual(self.lire("historique/bruno-demonstra/v2.yaml")["version"], 2)
        self.assertIn("historique/bruno-demonstra/v1.yaml", out)
        etat = presidentielle.relire(self.dossier)
        versions = evolution.frise(etat, etat.fiches["bruno-demonstra"])
        self.assertEqual([v["version"] for v in versions], [2, 1])
        self.assertEqual(versions[0]["changements"]["mesures_ajoutees"], [])

    def brouillon_sans(self, *retirees: str) -> None:
        brouillon = self.lire(CARLA)
        brouillon["mesures"] = [
            m for m in brouillon["mesures"] if m["id"] not in retirees
        ]
        tool.ecrire_yaml(self.dossier / "brouillons/carla-exemplia.yaml", brouillon)

    def test_publier_retrait_erreur_refuse_sans_rien_ecrire(self):
        avant = {p: p.read_bytes() for p in self.dossier.rglob("*.yaml")}
        cas = (
            ((), ("inconnue",), "inconnue absente(s) de la version 2"),
            ((), ("sante-centres",), "sante-centres encore dans le brouillon"),
            (("sante-centres",), ("Sante",), "mesure invalide"),
            (("sante-centres",), ("sante-centres", "eco"), "eco absente(s)"),
        )
        for retirees, options, attendu in cas:
            with self.subTest(options=options):
                self.brouillon_sans(*retirees)
                brouillon = self.texte("brouillons/carla-exemplia.yaml")
                code, _, err = self.lancer(
                    "publier", "carla-exemplia", "--retrait-erreur", *options
                )
                self.assertEqual(code, 2, err)
                self.assertIn(attendu, err)
                self.assertEqual(
                    self.texte("brouillons/carla-exemplia.yaml"), brouillon
                )
                apres = {
                    p: p.read_bytes()
                    for p in self.dossier.rglob("*.yaml")
                    if "brouillons" not in p.parts
                }
                self.assertEqual(apres, avant)

    def test_publier_retrait_erreur_inscrit_au_journal(self):
        copies = {n: self.texte(f"historique/carla-exemplia/v{n}.yaml") for n in (1, 2)}
        self.brouillon_sans("sante-centres")
        self.modifier(
            "quiz/rattachements.yaml",
            lambda d: d.update(
                rattachements=[
                    r for r in d["rattachements"] if r["mesure_id"] != "sante-centres"
                ]
            ),
        )
        code, out, err = self.lancer(
            "publier", "carla-exemplia", "--motif", "Erreur de saisie corrigée",
            "--retrait-erreur", "sante-centres", "sante-centres",
        )  # fmt: skip
        self.assertEqual(code, 0, err)
        self.assertIn("Retrait pour erreur inscrit au journal : sante-centres", out)
        self.assertEqual(
            self.journal_fin(),
            {
                "date": tool_tests.AUJOURD_HUI,
                "objet": "fiche",
                "cible": "carla-exemplia",
                "version": 3,
                "motif": "Erreur de saisie corrigée",
                "retraits_erreur": ["sante-centres"],
            },
        )
        # Copies figées intactes ; texte masqué dans toute la frise
        for n, texte in copies.items():
            self.assertEqual(self.texte(f"historique/carla-exemplia/v{n}.yaml"), texte)
        etat = presidentielle.relire(self.dossier)
        self.assertEqual(etat.erreurs, [])
        versions = evolution.frise(etat, etat.fiches["carla-exemplia"])
        self.assertEqual(
            versions[0]["changements"]["mesures_retirees"],
            [{"id": "sante-centres", "retrait_erreur": "2026-11-23"}],
        )
        self.assertNotIn("centre de santé public", str(versions))

    def test_restaurer_mesure_retiree_pour_erreur_avertit(self):
        depuis = self.dossier / "brouillons" / "restaurer.yaml"
        depuis.parent.mkdir(exist_ok=True)
        shutil.copyfile(self.dossier / "historique/carla-exemplia/v2.yaml", depuis)
        self.test_publier_retrait_erreur_inscrit_au_journal()
        code, out, err = self.lancer(
            "restaurer", "carla-exemplia", "abc123", "--depuis", str(depuis)
        )
        self.assertEqual(code, 0, err)
        self.assertIn("sante-centres déjà retirée(s) pour erreur", out)

    def journal_fin(self) -> dict:
        return self.lire("journal.yaml")["entrees"][-1]

    def test_restaurer_ecrit_la_copie(self):
        depuis = self.dossier / "brouillons" / "restaurer.yaml"
        depuis.parent.mkdir(exist_ok=True)
        shutil.copyfile(self.dossier / "historique/carla-exemplia/v1.yaml", depuis)
        code, _, err = self.lancer(
            "restaurer", "carla-exemplia", "abc123", "--depuis", str(depuis)
        )
        self.assertEqual(code, 0, err)
        copie = self.lire("historique/carla-exemplia/v3.yaml")
        self.assertEqual(copie["version"], 3)
        self.assertEqual(len(copie["mesures"]), 3)

    def test_liste_officielle_ecrit_les_copies(self):
        code, out, err = self.lancer(
            "liste-officielle", "--source", "etat-declarations",
            "--officiels", "aline-fictiva", "bruno-demonstra", "carla-exemplia",
        )  # fmt: skip
        self.assertEqual(code, 0, err)
        self.assertEqual(
            self.lire("historique/aline-fictiva/v2.yaml")["statut"], "officiel"
        )
        self.assertEqual(
            self.lire("historique/aline-fictiva/v1.yaml")["statut"], "declare"
        )
        etat = presidentielle.relire(self.dossier)
        [v2, _] = evolution.frise(etat, etat.fiches["aline-fictiva"])
        self.assertEqual(v2["changements"]["statut"]["apres"], "officiel")

    def test_textes_permis_en_archive(self):
        with mock.patch.object(tool, "aujourd_hui", lambda: date(2027, 5, 3)):
            code, out, err = self.lancer("textes", "reconstruire")
        self.assertEqual(code, 0, err)


if __name__ == "__main__":
    unittest.main()
