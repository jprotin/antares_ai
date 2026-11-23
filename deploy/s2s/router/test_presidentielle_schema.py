"""Schéma de la base « Présidentielle 2027 » (presidentielle_schema.py) : un test par
règle, sur une copie du jeu fictif (fixtures/presidentielle/demo) dans un dossier
temporaire ; les cas en défaut de fixtures/presidentielle/cas/ sont rejoués un par un.

python -m unittest test_presidentielle_schema (dans router/, cf. README).
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle
import presidentielle_schema as schema

FIXTURES = Path(__file__).parent / "fixtures" / "presidentielle"
DEMO = FIXTURES / "demo"
CAS = FIXTURES / "cas"
ALINE = "candidats/aline-fictiva.yaml"
BRUNO = "candidats/bruno-demonstra.yaml"
GRILLE = "quiz/grille.yaml"
RATTACHEMENTS = "quiz/rattachements.yaml"


class Jeu(unittest.TestCase):
    """Copie jetable du jeu fictif, modifiée fichier par fichier."""

    def setUp(self):
        self.dossier = Path(tempfile.mkdtemp()) / "base"
        shutil.copytree(DEMO, self.dossier)
        self.addCleanup(shutil.rmtree, self.dossier.parent)

    def lire(self, rel: str):
        return yaml.safe_load((self.dossier / rel).read_text(encoding="utf-8"))

    def ecrire(self, rel: str, data) -> None:
        text = yaml.safe_dump(
            data, explicit_start=True, sort_keys=False, allow_unicode=True, width=120
        )
        (self.dossier / rel).write_text(text, encoding="utf-8")

    def modifier(self, rel: str, change) -> None:
        data = self.lire(rel)
        change(data)
        self.ecrire(rel, data)

    def grille_modifiee(self, change) -> None:
        """Modifie la grille et refait le gel (empreinte dans la grille et la ligne
        gel_grille du journal) : seul le défaut visé reste."""
        empreinte = {}

        def avec_gel(data):
            change(data)
            empreinte["valeur"] = data["gel"]["empreinte"] = schema.empreinte_grille(
                schema.Grille.model_validate(data)
            )

        def journal(data):
            for entree in data["entrees"]:
                if entree["objet"] == "gel_grille":
                    entree["empreinte"] = empreinte["valeur"]

        self.modifier(GRILLE, avec_gel)
        self.modifier("journal.yaml", journal)

    def erreurs(self) -> list[schema.Erreur]:
        return presidentielle.controle_ensemble(self.dossier)

    def assertRefus(self, attendu: str, fichier: str | None = None) -> None:
        erreurs = self.erreurs()
        self.assertTrue(erreurs, f"aucune erreur, « {attendu} » attendu")
        for erreur in erreurs:
            self.assertIn(attendu, erreur.message, erreurs)
            if fichier:
                self.assertEqual(erreur.fichier, fichier)

    def assertValide(self) -> None:
        self.assertEqual(self.erreurs(), [])


class Fiches(Jeu):
    def test_jeu_demo_valide(self):
        self.assertValide()
        etat = presidentielle.charger(self.dossier)
        self.assertEqual(len(etat.fiches), 4)
        self.assertEqual(etat.base.jeu, "demonstration")
        for source in etat.sources.values():
            self.assertTrue(schema.domaine_fictif(source.url), source.url)

    def test_fiche_six_lignes_phares_refusee(self):
        lignes = [{"texte": f"Ligne {i}", "source_id": "aline-site"} for i in range(6)]
        self.modifier(ALINE, lambda d: d.update(lignes_phares=lignes[:5]))
        self.assertValide()
        self.modifier(ALINE, lambda d: d.update(lignes_phares=lignes))
        self.assertRefus("lignes_phares", ALINE)

    def test_description_301_caracteres_refusee(self):
        # 300 caractères dont un émoji (4 octets) : accepté ; 301 : refusé
        self.modifier(BRUNO, lambda d: d["description"].update(texte="é" * 299 + "😀"))
        self.assertValide()
        self.modifier(BRUNO, lambda d: d["description"].update(texte="é" * 300 + "😀"))
        self.assertRefus("description.texte", BRUNO)

    def test_description_nature_imposee(self):
        self.modifier(BRUNO, lambda d: d["description"].update(nature="candidat"))
        self.assertRefus("description.nature", BRUNO)

    def test_candidat_sans_declaration_refuse(self):
        self.modifier(BRUNO, lambda d: d.pop("declaration"))
        self.assertRefus("declaration", BRUNO)

    def test_statut_inconnu_refuse(self):
        self.modifier(BRUNO, lambda d: d.update(statut="pressenti"))
        self.assertRefus("statut", BRUNO)
        for statut in ("declare", "officiel", "retire", "non_qualifie"):
            self.modifier(BRUNO, lambda d: d.update(statut=statut))
            self.assertValide()

    def test_mesure_source_vote_reel_refusee(self):
        self.modifier(ALINE, lambda d: d["mesures"][0].update(source_id="aline-votes"))
        self.assertRefus("« vote_reel » interdit", ALINE)

    def test_vote_source_candidat_refuse(self):
        self.modifier(
            ALINE, lambda d: d["votes"][0].update(source_id="aline-programme")
        )
        self.assertRefus("« candidat » interdit", ALINE)

    def test_mesure_source_autre_candidat_refusee(self):
        self.modifier(
            ALINE, lambda d: d["mesures"][0].update(source_id="bruno-programme")
        )
        self.assertRefus("d'un autre candidat", ALINE)

    def test_reference_inconnue_refusee(self):
        self.modifier(ALINE, lambda d: d["mesures"][0].update(source_id="src-absente"))
        self.assertRefus("src-absente", ALINE)

    def test_reference_mesure_inconnue_refusee(self):
        self.modifier(
            RATTACHEMENTS,
            lambda d: d["rattachements"][0].update(mesure_id="mesure-absente"),
        )
        self.assertRefus("mesure-absente", RATTACHEMENTS)

    def test_fiche_publiee_a_verifier_refusee(self):
        self.modifier(BRUNO, lambda d: d["mesures"][0].update(a_verifier=True))
        self.assertRefus("a_verifier", BRUNO)

    def test_identifiant_different_du_fichier_refuse(self):
        self.modifier(BRUNO, lambda d: d.update(id="aline-fictiva"))
        self.assertRefus("différent du nom du fichier", BRUNO)

    def test_identifiant_dangereux_refuse(self):
        for ident in ("../x", "Bruno-Demonstra", "bruno demonstra", "p27:bruno", ""):
            with self.subTest(ident=ident):
                self.modifier(BRUNO, lambda d: d.update(id=ident))
                self.assertRefus("id :", BRUNO)

    def test_votes_sans_mandat_refuses(self):
        self.modifier(ALINE, lambda d: d.update(parlementaire=False))
        self.assertRefus("non parlementaire", ALINE)


class Sources(Jeu):
    def ajouter_source(self, **change):
        source = {
            "id": "source-en-trop",
            "titre": "Source ajoutée",
            "url": "https://etat.exemple.invalid/x",
            "niveau": "officiel_etat",
            "consulte_le": "2026-11-20",
            **change,
        }
        self.modifier("sources.yaml", lambda d: d["sources"].append(source))

    def test_niveau_presse_ou_reperage_refuse(self):
        for niveau in ("presse", "reperage", "repérage", "sondage"):
            with self.subTest(niveau=niveau):
                self.setUp()
                self.ajouter_source(niveau=niveau)
                self.assertRefus("niveau", "sources.yaml")

    def test_adresse_non_https_refusee(self):
        for url in (
            "http://etat.exemple.invalid/x",
            "javascript:alert(1)",
            "data:text/html,x",
            "/documents/x.pdf",
            "https:///x",
        ):
            with self.subTest(url=url):
                self.setUp()
                self.ajouter_source(url=url)
                self.assertRefus("non https", "sources.yaml")

    def test_source_candidat_sans_candidat_refusee(self):
        self.ajouter_source(niveau="candidat")
        self.assertRefus("niveau candidat sans candidat", "sources.yaml")

    def test_source_en_defaut_n_ecarte_que_ses_fiches(self):
        self.modifier(
            "sources.yaml",
            lambda d: d["sources"][1].update(url="http://aline.exemple.invalid/x"),
        )
        etat = presidentielle.charger(self.dossier)
        self.assertNotIn("aline-fictiva", etat.fiches)
        self.assertEqual(len(etat.fiches), 3)

    def test_jeu_demo_adresse_reelle_refusee(self):
        self.ajouter_source(url="https://www.example.org/programme.pdf")
        self.assertRefus("hors exemple.invalid", "sources.yaml")
        # Sous-domaine trompeur : refusé aussi
        self.setUp()
        self.ajouter_source(url="https://exemple.invalid.example.org/x")
        self.assertRefus("hors exemple.invalid", "sources.yaml")

    def test_jeu_reel_fiche_fictive_refusee(self):
        self.modifier("base.yaml", lambda d: d.update(jeu="reel"))
        erreurs = self.erreurs()
        self.assertEqual(len(erreurs), 4)
        for erreur in erreurs:
            self.assertIn("fiche fictive interdite", erreur.message)

    def test_jeu_demo_fiche_non_fictive_refusee(self):
        self.modifier(BRUNO, lambda d: d.update(fictif=False))
        self.assertRefus("fictif: true", BRUNO)


class Grille(Jeu):
    def options(self, n: int) -> list[dict]:
        ordinaires = [
            {"id": f"economie-1-{c}", "libelle": f"Option {c}", "pole": "mixte"}
            for c in "abcdefg"[:n]
        ]
        return ordinaires + [
            {"id": "aucune", "libelle": "Aucune de ces propositions"},
            {"id": "sans-avis", "libelle": "Sans avis"},
        ]

    def test_grille_options_hors_bornes_refusee(self):
        for n, ok in ((2, False), (3, True), (5, True), (6, False)):
            with self.subTest(options=n):
                self.setUp()

                def change(d, n=n):
                    d["themes"][0]["questions"][0]["options"] = self.options(n)

                if ok:
                    # Les rattachements aux options a, b et c restent valides
                    self.grille_modifiee(change)
                    self.assertValide()
                else:
                    self.modifier(GRILLE, change)
                    self.assertRefus(f"{n} options", GRILLE)

    def test_grille_sans_options_speciales_refusee(self):
        for special in ("sans-avis", "aucune"):
            with self.subTest(option=special):
                self.setUp()
                self.modifier(
                    GRILLE,
                    lambda d: d["themes"][0]["questions"][0].update(
                        options=[
                            o
                            for o in d["themes"][0]["questions"][0]["options"]
                            if o["id"] != special
                        ]
                    ),
                )
                self.assertRefus(special, GRILLE)

    def test_option_speciale_libelle_impose(self):
        self.modifier(
            GRILLE,
            lambda d: d["themes"][0]["questions"][0]["options"][-1].update(
                libelle="Je ne sais pas"
            ),
        )
        self.assertRefus("imposé", GRILLE)

    def test_grille_dix_themes_deux_questions(self):
        self.modifier(GRILLE, lambda d: d.update(themes=d["themes"][:9]))
        grille = [e.message for e in self.erreurs() if e.fichier == GRILLE]
        self.assertEqual(len(grille), 1)
        self.assertIn("9 thèmes", grille[0])
        self.setUp()

        def trois(d):
            extra = json.loads(json.dumps(d["themes"][0]["questions"][1]))
            extra["id"] = "economie-3"
            for option in extra["options"]:
                option["id"] = option["id"].replace("economie-2", "economie-3")
            d["themes"][0]["questions"].append(extra)

        self.modifier(GRILLE, trois)
        self.assertRefus("3 questions", GRILLE)

    def test_enonce_nom_candidat_refuse(self):
        for texte in (
            "Que propose Aline Fictiva sur l'impôt ?",
            "Que propose FICTIVA sur l'impôt ?",
            "Que propose DEMONSTRA sur l'impôt ?",  # sans accent, casse changée
            "Que propose A. Fictiva sur l'impôt ?",  # alias
            "Que propose AF sur l'impôt ?",  # initiales
            "Que propose le Mouvement Fictivien ?",  # parti
            "Que propose le MFV ?",  # sigle du parti
            "Que propose l'alliance démonstrative ?",  # parti, casse changée
        ):
            with self.subTest(texte=texte):
                self.setUp()
                self.grille_modifiee(
                    lambda d: d["themes"][0]["questions"][0].update(enonce=texte)
                )
                self.assertRefus("nom de candidat ou de parti interdit", GRILLE)

    def test_option_nom_candidat_refusee(self):
        self.grille_modifiee(
            lambda d: d["themes"][0]["questions"][0]["options"][0].update(
                libelle="Comme Fictorin"
            )
        )
        self.assertRefus("option economie-1-a", GRILLE)

    def test_enonce_mot_proche_accepte(self):
        def martin(d):
            d["nom_affiche"] = "Bruno Martin"
            d["initiales"] = "LM"

        self.modifier(BRUNO, martin)
        self.grille_modifiee(
            lambda d: d["themes"][0]["questions"][0].update(
                enonce="Faut-il une fiscalité propre à la Martinique, au sens du LMD ?"
            )
        )
        self.assertValide()

    def test_grille_gelee_rattachement_modifiable(self):
        self.modifier(
            RATTACHEMENTS,
            lambda d: d["rattachements"][0].update(option="economie-1-c"),
        )
        self.assertValide()

    def test_grille_gelee_enonce_modifie_sans_correction_refuse(self):
        texte = "Comment changer l'impôt sur le revenu ?"
        self.modifier(
            GRILLE, lambda d: d["themes"][0]["questions"][0].update(enonce=texte)
        )
        self.assertRefus("sans ligne de correction", GRILLE)
        # Ligne de correction au journal, avec la nouvelle empreinte : acceptée
        nouvelle = schema.empreinte_grille(
            schema.Grille.model_validate(self.lire(GRILLE))
        )
        self.modifier(
            "journal.yaml",
            lambda d: d["entrees"].append(
                {
                    "date": "2027-02-01",
                    "objet": "correction_grille",
                    "motif": "Énoncé reformulé",
                    "empreinte": nouvelle,
                }
            ),
        )
        self.assertValide()

    def test_empreinte_grille_stable(self):
        grille = schema.Grille.model_validate(self.lire(GRILLE))
        self.assertEqual(grille.gel.empreinte, schema.empreinte_grille(grille))
        # Le statut des axes et le gel n'entrent pas dans l'empreinte
        autre = grille.model_copy(update={"axes_statut": "brouillon", "gel": None})
        self.assertEqual(schema.empreinte_grille(autre), grille.gel.empreinte)

    def test_axes_brouillon_barres_masquees(self):
        data = self.lire(GRILLE)
        for statut, visible in (
            ("brouillon", False),
            ("validee", False),
            ("gelee", True),
        ):
            data["axes_statut"] = statut
            self.assertEqual(
                schema.Grille.model_validate(data).barres_visibles, visible, statut
            )

    def test_rattachement_deux_options_refuse(self):
        self.modifier(
            RATTACHEMENTS,
            lambda d: d["rattachements"].append(
                {
                    "question": "economie-1",
                    "candidat": "aline-fictiva",
                    "option": "economie-1-c",
                    "mesure_id": "eco-dette",
                }
            ),
        )
        self.assertRefus("deux options", RATTACHEMENTS)

    def test_rattachement_mesure_autre_candidat_refuse(self):
        self.modifier(
            RATTACHEMENTS,
            lambda d: d["rattachements"].append(
                {
                    "question": "education-1",
                    "candidat": "bruno-demonstra",
                    "option": "education-1-b",
                    "mesure_id": "educ-classes",
                }
            ),
        )
        self.assertRefus("absente de la fiche bruno-demonstra", RATTACHEMENTS)

    def test_rattachement_mesure_autre_theme_refuse(self):
        self.modifier(
            RATTACHEMENTS,
            lambda d: d["rattachements"].append(
                {
                    "question": "travail-1",
                    "candidat": "aline-fictiva",
                    "option": "travail-1-a",
                    "mesure_id": "eco-impot",
                }
            ),
        )
        self.assertRefus("du thème economie", RATTACHEMENTS)

    def test_rattachement_option_speciale_refuse(self):
        self.modifier(
            RATTACHEMENTS,
            lambda d: d["rattachements"][0].update(option="aucune"),
        )
        self.assertRefus("option « aucune » invalide", RATTACHEMENTS)


class Lecture(Jeu):
    def test_cle_en_double_detectee(self):
        path = self.dossier / BRUNO
        path.write_text(
            path.read_text(encoding="utf-8") + "statut: officiel\n", encoding="utf-8"
        )
        self.assertRefus("clé en double « statut »", BRUNO)

    def test_yaml_illisible_erreur_claire(self):
        (self.dossier / BRUNO).write_text("id: [bruno\nstatut: : :\n", encoding="utf-8")
        erreurs = self.erreurs()
        self.assertEqual(len(erreurs), 1)
        self.assertEqual(erreurs[0].fichier, BRUNO)
        self.assertIn("YAML invalide", erreurs[0].message)
        (self.dossier / BRUNO).write_bytes(b"\xff\xfe\x00")
        self.assertRefus("illisible", BRUNO)

    def test_liste_blanche_entree_hors_gemma_refusee(self):
        for name in (
            "claude/sonnet",
            "olala-mini",
            "local-gemma",
            "ollama/gemma4:e4b-long",
            "gemma4:e4b",
            "Ollama/gemma4:e4b",
        ):
            with self.subTest(modele=name):
                self.modifier(
                    "base.yaml",
                    lambda d: d["assistant"].update(modeles_autorises=[name]),
                )
                self.assertRefus("seul <fournisseur>/gemma4:e4b", "base.yaml")
        self.modifier(
            "base.yaml",
            lambda d: d["assistant"].update(modeles_autorises=["ollama/gemma4:e4b"]),
        )
        self.assertValide()

    def test_liste_blanche_par_defaut(self):
        self.modifier("base.yaml", lambda d: d.pop("assistant"))
        etat = presidentielle.charger(self.dossier)
        self.assertEqual(
            etat.base.assistant.modeles_autorises, schema.MODELES_PAR_DEFAUT
        )

    def test_cle_inconnue_refusee(self):
        self.modifier(BRUNO, lambda d: d.update(couleur="rouge"))
        self.assertRefus("couleur", BRUNO)


class Pieges(Jeu):
    """YAML piégé : erreur nommée, jamais d'exception."""

    def test_cle_non_hashable_refusee(self):
        (self.dossier / BRUNO).write_text("? [a, b]\n: 1\n", encoding="utf-8")
        self.assertRefus("clé non hashable", BRUNO)
        etat = presidentielle.charger(self.dossier)
        self.assertEqual(len(etat.fiches), 3)

    def test_imbrication_excessive_refusee(self):
        (self.dossier / "journal.yaml").write_text(
            "[" * 5000 + "]" * 5000 + "\n", encoding="utf-8"
        )
        erreurs = self.erreurs()
        journal = [e for e in erreurs if e.fichier == "journal.yaml"]
        self.assertEqual(len(journal), 1)
        self.assertIn("structure refusée", journal[0].message)
        # Sans journal, le gel n'est plus prouvé : grille refusée, fiches servies
        self.assertIsNone(presidentielle.charger(self.dossier).grille)
        self.assertEqual(len(presidentielle.charger(self.dossier).fiches), 4)

    def test_lire_yaml_attrape_les_erreurs_de_construction(self):
        path = self.dossier / "x.yaml"
        for texte in ("? {a: 1}\n: 2\n", "a: !!python/object:os.system x\n"):
            with self.subTest(texte=texte):
                path.write_text(texte, encoding="utf-8")
                with self.assertRaises(schema.ErreurFichier):
                    schema.lire_yaml(path, "x.yaml")


class Gel(Jeu):
    def test_axes_geles_sans_gel_refuses(self):
        self.modifier(GRILLE, lambda d: d.pop("gel"))
        self.assertRefus("axes_statut gelee sans gel", GRILLE)
        self.modifier(GRILLE, lambda d: d.update(axes_statut="validee"))
        self.assertValide()

    def test_gel_sans_ligne_gel_grille_refuse(self):
        self.modifier(
            "journal.yaml",
            lambda d: d.update(
                entrees=[e for e in d["entrees"] if e["objet"] != "gel_grille"]
            ),
        )
        self.assertRefus("gel sans ligne gel_grille", GRILLE)

    def test_gel_grille_empreinte_differente_refusee(self):
        def autre(d):
            for entree in d["entrees"]:
                if entree["objet"] == "gel_grille":
                    entree["empreinte"] = "sha256:" + "0" * 64

        self.modifier("journal.yaml", autre)
        self.assertRefus("gel sans ligne gel_grille", GRILLE)

    def test_gel_grille_sans_empreinte_refuse(self):
        def sans(d):
            for entree in d["entrees"]:
                entree.pop("empreinte", None)

        self.modifier("journal.yaml", sans)
        erreurs = self.erreurs()
        self.assertIn("gel_grille sans empreinte", erreurs[0].message)
        self.assertEqual(erreurs[0].fichier, "journal.yaml")

    def test_correction_datee_avant_le_gel_ignoree(self):
        texte = "Comment changer l'impôt sur le revenu ?"
        self.modifier(
            GRILLE, lambda d: d["themes"][0]["questions"][0].update(enonce=texte)
        )
        nouvelle = schema.empreinte_grille(
            schema.Grille.model_validate(self.lire(GRILLE))
        )
        # Gel le 2026-11-20 : une correction du même jour ou d'avant ne compte pas
        for date in ("2026-11-19", "2026-11-20"):
            with self.subTest(date=date):
                self.setUp()
                self.modifier(
                    GRILLE,
                    lambda d: d["themes"][0]["questions"][0].update(enonce=texte),
                )
                self.modifier(
                    "journal.yaml",
                    lambda d, date=date: d["entrees"].append(
                        {
                            "date": date,
                            "objet": "correction_grille",
                            "motif": "Antidatée",
                            "empreinte": nouvelle,
                        }
                    ),
                )
                self.assertRefus("sans ligne de correction", GRILLE)


class NomsInterdits(Jeu):
    def test_nom_d_une_fiche_ecartee_interdit(self):
        # Fiche en défaut (statut inconnu) : son nom reste interdit dans la grille
        self.modifier(BRUNO, lambda d: d.update(statut="pressenti"))
        self.grille_modifiee(
            lambda d: d["themes"][0]["questions"][0].update(
                enonce="Que propose Démonstra sur l'impôt ?"
            )
        )
        messages = [e.message for e in self.erreurs() if e.fichier == GRILLE]
        self.assertEqual(len(messages), 1)
        self.assertIn("nom de candidat ou de parti interdit", messages[0])

    def test_nom_d_une_fiche_illisible_interdit_si_lisible(self):
        path = self.dossier / BRUNO
        path.write_text(
            path.read_text(encoding="utf-8").replace("version: 1", "version: zero"),
            encoding="utf-8",
        )
        self.grille_modifiee(
            lambda d: d["themes"][0]["questions"][0].update(enonce="Comme BD ?")
        )
        self.assertTrue(
            any(
                "interdit (BD)" in e.message
                for e in self.erreurs()
                if e.fichier == GRILLE
            )
        )

    def test_libelles_poles_et_mots_cles_controles(self):
        for champ, change in (
            ("libellé", lambda d: d["themes"][0].update(libelle="Économie Fictiva")),
            ("pôle A", lambda d: d["themes"][0]["axe"].update(pole_a="comme Fictorin")),
            ("pôle B", lambda d: d["themes"][0]["axe"].update(pole_b="comme le MFV")),
            ("mot-clé", lambda d: d["themes"][0]["mots_cles"].append("Exemplia")),
        ):
            with self.subTest(champ=champ):
                self.setUp()
                self.grille_modifiee(change)
                self.assertRefus(f"thème economie, {champ}", GRILLE)

    def test_prenom_seul_accepte_nom_de_famille_refuse(self):
        """Choix : seuls le nom complet, le nom de famille (dernier mot), les alias et
        les initiales sont interdits ; un prénom seul est un mot courant."""
        self.modifier(BRUNO, lambda d: d.update(nom_affiche="Marine Exemplaire"))
        self.grille_modifiee(
            lambda d: d["themes"][9]["questions"][0].update(
                enonce="Quel rôle pour la Marine nationale en Europe ?"
            )
        )
        self.assertValide()
        self.grille_modifiee(
            lambda d: d["themes"][9]["questions"][0].update(
                enonce="Que veut Exemplaire pour l'Europe ?"
            )
        )
        self.assertRefus("interdit (Exemplaire)", GRILLE)


class ThemesSansGrille(Jeu):
    def test_grille_en_defaut_themes_relus(self):
        # Grille en défaut mais lisible : ses thèmes servent encore à vérifier les mesures
        self.modifier(
            GRILLE, lambda d: d["themes"][0]["questions"][0].update(options=[])
        )
        self.modifier(BRUNO, lambda d: d["mesures"][0].update(theme="theme-invente"))
        erreurs = self.erreurs()
        self.assertTrue(
            any(e.fichier == BRUNO and "theme-invente" in e.message for e in erreurs)
        )

    def test_grille_absente_verification_signalee(self):
        (self.dossier / GRILLE).unlink()
        erreurs = self.erreurs()
        self.assertEqual(
            [(e.fichier, "non vérifiés" in e.message) for e in erreurs],
            [(GRILLE, True)],
        )
        self.assertEqual(len(presidentielle.charger(self.dossier).fiches), 4)


class LiensSymboliques(Jeu):
    def test_lien_symbolique_ignore(self):
        dehors = self.dossier.parent / "dehors.yaml"
        dehors.write_text(
            (self.dossier / BRUNO)
            .read_text(encoding="utf-8")
            .replace("bruno-demonstra", "zoe-lien"),
            encoding="utf-8",
        )
        (self.dossier / "candidats" / "zoe-lien.yaml").symlink_to(dehors)
        (self.dossier / "candidats" / "bruno-bis.yaml").symlink_to(self.dossier / BRUNO)
        etat = presidentielle.charger(self.dossier)
        self.assertNotIn("zoe-lien", etat.fiches)
        self.assertEqual(len(etat.fiches), 4)
        refuses = sorted(
            e.fichier for e in etat.erreurs if "lien symbolique" in e.message
        )
        self.assertEqual(
            refuses, ["candidats/bruno-bis.yaml", "candidats/zoe-lien.yaml"]
        )
        self.assertNotIn(
            "candidats/zoe-lien.yaml", presidentielle.fichiers_publies(self.dossier)
        )

    def test_fichier_de_base_hors_du_dossier_ignore(self):
        (self.dossier / "journal.yaml").unlink()
        (self.dossier / "journal.yaml").symlink_to(DEMO / "journal.yaml")
        etat = presidentielle.charger(self.dossier)
        self.assertIn("journal.yaml", [e.fichier for e in etat.erreurs])
        self.assertEqual(etat.journal, [])


class Cas(unittest.TestCase):
    def test_chaque_cas_donne_l_erreur_attendue(self):
        attendus = yaml.safe_load((CAS / "attendus.yaml").read_text(encoding="utf-8"))
        listes = {c["fichier"] for c in attendus["cas"]}
        # Les pièges que les hooks YAML refuseraient sont en .txt
        presents = {p.name for p in [*CAS.glob("*.yaml"), *CAS.glob("*.txt")]}
        presents -= {"attendus.yaml"}
        self.assertEqual(listes, presents)
        for cas in attendus["cas"]:
            with self.subTest(cas=cas["fichier"]):
                dossier = Path(tempfile.mkdtemp()) / "base"
                self.addCleanup(shutil.rmtree, dossier.parent)
                shutil.copytree(DEMO, dossier)
                shutil.copyfile(CAS / cas["fichier"], dossier / cas["cible"])
                erreurs = presidentielle.controle_ensemble(dossier)
                self.assertTrue(erreurs)
                # Jeu réel : l'erreur porte sur chaque fiche fictive, pas sur base.yaml
                fichier = cas.get("erreur_dans", cas["cible"])
                # Conséquences attendues ailleurs (ex. gel invérifiable sans journal)
                ignorer = tuple(cas.get("ignorer", []))
                visees = [e for e in erreurs if not e.fichier.startswith(ignorer)]
                self.assertTrue(visees)
                for erreur in visees:
                    self.assertTrue(erreur.fichier.startswith(fichier), erreur)
                    self.assertIn(cas["erreur"], erreur.message)


class SchemasJson(unittest.TestCase):
    def test_schemas_json_synchronises(self):
        attendus = schema.schemas_json()
        dossier = FIXTURES / "schemas"
        presents = {p.name for p in dossier.glob("*.schema.json")}
        self.assertEqual(presents, {f"{nom}.schema.json" for nom in attendus})
        for nom, attendu in attendus.items():
            with self.subTest(schema=nom):
                ecrit = json.loads(
                    (dossier / f"{nom}.schema.json").read_text(encoding="utf-8")
                )
                self.assertEqual(
                    ecrit,
                    attendu,
                    "schéma JSON périmé : python presidentielle_schema.py",
                )


if __name__ == "__main__":
    unittest.main()
