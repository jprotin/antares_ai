"""Votes réels à l'Assemblée nationale (presidentielle_votes.py, commandes « scrutins »
et « votes » de presidentielle_tool.py) sur un petit extrait d'archive au format des
données ouvertes, avec des députés et des scrutins inventés
(fixtures/presidentielle/assemblee/). Aucun accès réseau, aucun git.

python -m unittest test_presidentielle_votes (dans router/, cf. README).
"""

import copy
import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from pathlib import Path
from unittest import mock

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle_schema as schema
import presidentielle_tool as tool
import presidentielle_votes as votes_an

FIXTURES = Path(__file__).parent / "fixtures" / "presidentielle"
DEMO = FIXTURES / "demo"
MODELE = json.loads(
    (FIXTURES / "assemblee" / "VTANR5L17V9001.json").read_text(encoding="utf-8")
)
AUJOURD_HUI = date(2026, 11, 23)
# Députés inventés : PA900001 (pour, puis contre), PA900004 (contre, puis absent)
ALINE, BRUNO = "PA900001", "PA900004"
LISTE = """---
# Scrutins retenus (jeu de test), choisis avant de regarder les candidats
scrutins:
  - id: energie-l17-9001
    theme: ecologie
    legislature: 17
    numero: 9001
    date: 2025-03-12
    titre: Projet de loi fictif sur l'énergie
    url: https://assemblee.exemple.invalid/dyn/17/scrutins/9001
  - id: sante-l17-9002
    theme: sante
    legislature: 17
    numero: 9002
    date: 2025-10-28
    titre: Proposition de loi fictive sur la santé
    url: https://assemblee.exemple.invalid/dyn/17/scrutins/9002
"""


def scrutin(numero: int, jour: str, votants: dict[str, str]) -> dict:
    """Scrutin au format de l'Assemblée : un seul groupe, positions données."""
    data = copy.deepcopy(MODELE)
    s = data["scrutin"]
    s.update(uid=f"VTANR5L17V{numero}", numero=str(numero), dateScrutin=jour)
    listes: dict[str, list] = {}
    cles = {"pour": "pours", "contre": "contres", "abstention": "abstentions"}
    for acteur, position in votants.items():
        listes.setdefault(cles[position], []).append(
            {"acteurRef": acteur, "mandatRef": "PM9", "parDelegation": "false"}
        )
    nominatif: dict = {"nonVotants": None, "nonVotantsVolontaires": None}
    for cle in cles.values():
        votant = listes.get(cle)
        # Votant seul : objet ; aucun : null (particularités du format)
        nominatif[cle] = (
            None
            if not votant
            else {"votant": votant[0] if len(votant) == 1 else votant}
        )
    groupe = {"organeRef": "PO900001", "vote": {"decompteNominatif": nominatif}}
    s["ventilationVotes"]["organe"]["groupes"] = {"groupe": groupe}
    return data


def ecrire_archive(path: Path, scrutins: list[dict]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for data in scrutins:
            uid = data["scrutin"]["uid"]
            archive.writestr(f"json/{uid}.json", json.dumps(data, ensure_ascii=False))
    return path


class Format(unittest.TestCase):
    def test_extrait_au_format_reel(self):
        octets = json.dumps(MODELE).encode("utf-8")
        decompte = votes_an.lire_decompte(octets, "VTANR5L17V9001")
        self.assertEqual(
            decompte.positions,
            {
                "PA900001": "pour",
                "PA900002": "pour",
                "PA900003": "abstention",
                "PA900004": "contre",
                "PA900005": "non_votant",
            },
        )
        self.assertEqual((decompte.numero, decompte.legislature), (9001, 17))
        self.assertEqual(decompte.date, date(2025, 3, 12))
        self.assertRegex(decompte.sha256, r"^[0-9a-f]{64}$")

    def test_fichier_d_un_autre_scrutin_refuse(self):
        octets = json.dumps(MODELE).encode("utf-8")
        with self.assertRaisesRegex(votes_an.ErreurArchive, "contient le scrutin"):
            votes_an.lire_decompte(octets, "VTANR5L17V9002")

    def test_fichier_illisible_refuse(self):
        for octets in (b"{", b'{"scrutin": {}}', b"[]"):
            with self.subTest(octets=octets):
                with self.assertRaises(votes_an.ErreurArchive):
                    votes_an.lire_decompte(octets, "VTANR5L17V9001")

    def test_votant_dans_deux_listes_refuse(self):
        data = copy.deepcopy(MODELE)
        groupe = data["scrutin"]["ventilationVotes"]["organe"]["groupes"]["groupe"][0]
        groupe["vote"]["decompteNominatif"]["contres"] = {
            "votant": {"acteurRef": "PA900001"}
        }
        with self.assertRaisesRegex(votes_an.ErreurArchive, "deux listes"):
            votes_an.lire_decompte(json.dumps(data).encode(), "VTANR5L17V9001")

    def test_ancien_mode_de_publication_refuse(self):
        data = copy.deepcopy(MODELE)
        data["scrutin"]["modePublicationDesVotes"] = "DecompteDissidentsPositionGroupe"
        with self.assertRaisesRegex(votes_an.ErreurArchive, "non gérée"):
            votes_an.lire_decompte(json.dumps(data).encode(), "VTANR5L17V9001")

    def test_structure_inattendue_refusee(self):
        for chemin, valeur in (
            ("vote", "x"),
            ("decompteNominatif", []),
            ("pours", "x"),
        ):
            data = copy.deepcopy(MODELE)
            groupe = data["scrutin"]["ventilationVotes"]["organe"]["groupes"]["groupe"][
                0
            ]
            if chemin == "vote":
                groupe["vote"] = valeur
            elif chemin == "decompteNominatif":
                groupe["vote"]["decompteNominatif"] = valeur
            else:
                groupe["vote"]["decompteNominatif"]["pours"] = valeur
            with self.subTest(chemin=chemin):
                with self.assertRaises(votes_an.ErreurArchive):
                    votes_an.lire_decompte(json.dumps(data).encode(), "VTANR5L17V9001")

    def test_acteur(self):
        self.assertTrue(votes_an.acteur_valide("PA123456"))
        for valeur in ("", "PA", "pa1", "PA1; rm", "PO123", "PA1234567890"):
            self.assertFalse(votes_an.acteur_valide(valeur), valeur)


class Commandes(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.dossier = self.tmp / "donnees"
        shutil.copytree(DEMO, self.dossier)
        for patcher in (
            mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": str(self.dossier)}),
            mock.patch.object(tool, "aujourd_hui", lambda: AUJOURD_HUI),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.archive = ecrire_archive(
            self.tmp / "Scrutins.json.zip",
            [
                MODELE,
                scrutin(9002, "2025-10-28", {ALINE: "contre", "PA900002": "pour"}),
                # Hors de la liste : jamais lu
                scrutin(9003, "2025-11-04", {ALINE: "pour", BRUNO: "pour"}),
            ],
        )
        (self.dossier / "quiz" / "scrutins.yaml").write_text(LISTE, encoding="utf-8")

    def lancer(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = tool.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def geler(self) -> None:
        code, out, err = self.lancer("scrutins", "geler")
        self.assertEqual(code, 0, out + err)

    def importer(self, candidat: str, acteur: str) -> tuple[int, str, str]:
        return self.lancer(
            "votes",
            "importer",
            candidat,
            "--acteur",
            acteur,
            "--archive",
            str(self.archive),
        )

    def brouillon(self, slug: str) -> dict:
        path = self.dossier / "brouillons" / f"{slug}.yaml"
        return yaml.safe_load(path.read_text(encoding="utf-8"))

    def instantane(self) -> dict[str, bytes]:
        return {
            str(p.relative_to(self.dossier)): p.read_bytes()
            for p in sorted(self.dossier.rglob("*"))
            if p.is_file()
        }

    def test_votes_scrutins_listes_seulement(self):
        self.geler()
        code, out, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 0, out + err)
        votes = self.brouillon("aline-fictiva")["votes"]
        self.assertEqual(
            [(v["id"], v["position"]) for v in votes],
            [
                ("scrutin-energie-l17-9001", "pour"),
                ("scrutin-sante-l17-9002", "contre"),
            ],
        )
        self.assertNotIn("9003", json.dumps(votes, default=str))
        # Anciens votes du jeu fictif, hors de la liste : retirés et signalés
        self.assertIn("vote-energie", out)
        vote = votes[0]
        self.assertEqual(vote["theme"], "ecologie")
        self.assertEqual(vote["date"], date(2025, 3, 12))
        self.assertIn("Scrutin n° 9001 (17e législature)", vote["scrutin"])

    def test_votes_meme_liste_pour_tous(self):
        self.geler()
        self.assertEqual(self.importer("aline-fictiva", ALINE)[0], 0)
        code, out, err = self.importer("bruno-demonstra", BRUNO)
        self.assertEqual(code, 0, out + err)
        aline = self.brouillon("aline-fictiva")["votes"]
        bruno = self.brouillon("bruno-demonstra")
        self.assertTrue(bruno["parlementaire"])
        self.assertEqual([v["id"] for v in aline], [v["id"] for v in bruno["votes"]])
        # Absence comprise : la ligne existe, sans position inventée
        self.assertEqual(
            [v["position"] for v in bruno["votes"]], ["contre", "sans_vote"]
        )

    def test_votes_ecrit_un_brouillon(self):
        self.geler()
        avant = self.instantane()
        code, out, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 0, out + err)
        apres = self.instantane()
        changes = {k for k in apres if avant.get(k) != apres[k]}
        self.assertEqual(changes, {"brouillons/aline-fictiva.yaml", "sources.yaml"})
        self.assertFalse(any(k.startswith("candidats/") for k in changes))
        # Sources de niveau vote_reel, empreinte du fichier du scrutin
        sources = yaml.safe_load((self.dossier / "sources.yaml").read_text())
        ajoutees = {s["id"]: s for s in sources["sources"]}
        source = ajoutees["scrutin-energie-l17-9001"]
        self.assertEqual(source["niveau"], "vote_reel")
        self.assertEqual(source["publie_le"], date(2025, 3, 12))
        self.assertRegex(source["sha256"], r"^[0-9a-f]{64}$")
        # Second import : sources déjà là, rien de plus dans sources.yaml
        texte = (self.dossier / "sources.yaml").read_text()
        self.assertEqual(self.importer("aline-fictiva", ALINE)[0], 0)
        self.assertEqual((self.dossier / "sources.yaml").read_text(), texte)

    def test_brouillon_verifie_puis_publie(self):
        self.geler()
        self.importer("aline-fictiva", ALINE)
        code, out, err = self.lancer("verifier", "brouillons/aline-fictiva.yaml")
        self.assertEqual(code, 0, out + err)
        with mock.patch.object(tool, "demander_index", lambda: None):
            code, out, err = self.lancer("publier", "aline-fictiva")
        self.assertEqual(code, 0, out + err)
        fiche = schema.charger_fiche(
            self.dossier / "candidats" / "aline-fictiva.yaml", "aline"
        )
        self.assertEqual([v.position for v in fiche.votes], ["pour", "contre"])
        code, out, err = self.lancer("verifier")
        self.assertEqual(code, 0, out + err)

    def test_liste_non_gelee_refusee(self):
        avant = self.instantane()
        code, _, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 2)
        self.assertIn("non gelée", err)
        self.assertEqual(self.instantane(), avant)

    def test_liste_modifiee_apres_gel_refusee(self):
        self.geler()
        path = self.dossier / "quiz" / "scrutins.yaml"
        path.write_text(
            path.read_text(encoding="utf-8").replace("numero: 9002", "numero: 9003"),
            encoding="utf-8",
        )
        code, _, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 2)
        self.assertIn("modifiée depuis son gel", err)
        code, out, _ = self.lancer("verifier")
        self.assertEqual(code, 1)
        self.assertIn("modifiée depuis son gel", out)

    def test_geler_journalise_l_empreinte(self):
        self.geler()
        liste = schema.charger(
            schema.Scrutins, self.dossier / "quiz" / "scrutins.yaml", "scrutins"
        )
        self.assertEqual(liste.gelee_le, AUJOURD_HUI)
        journal = yaml.safe_load((self.dossier / "journal.yaml").read_text())
        derniere = journal["entrees"][-1]
        self.assertEqual((derniere["objet"], derniere["cible"]), ("base", "scrutins"))
        self.assertEqual(derniere["empreinte"], votes_an.empreinte(liste.scrutins))
        # En-tête du fichier gardé
        texte = (self.dossier / "quiz" / "scrutins.yaml").read_text()
        self.assertIn("# Scrutins retenus", texte)
        # Fiche publiée d'Aline : votes de l'ancienne liste, signalés
        code, out, _ = self.lancer("verifier")
        self.assertIn("votes différents de la liste gelée", out)
        code, out, _ = self.lancer("scrutins", "verifier")
        self.assertEqual(code, 0, out)
        self.assertIn("2 scrutin(s) retenu(s), liste gelée le 2026-11-23", out)

    def test_scrutin_absent_de_l_archive_refuse(self):
        self.geler()
        ecrire_archive(self.archive, [MODELE])
        avant = self.instantane()
        code, _, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 2)
        self.assertIn("absent des archives", err)
        self.assertEqual(self.instantane(), avant)

    def test_une_archive_par_legislature(self):
        self.geler()
        premiere = ecrire_archive(self.tmp / "a.zip", [MODELE])
        seconde = ecrire_archive(
            self.tmp / "b.zip", [scrutin(9002, "2025-10-28", {ALINE: "contre"})]
        )
        code, out, err = self.lancer(
            "votes",
            "importer",
            "aline-fictiva",
            "--acteur",
            ALINE,
            "--archive",
            str(premiere),
            "--archive",
            str(seconde),
        )
        self.assertEqual(code, 0, out + err)
        self.assertEqual(
            [v["position"] for v in self.brouillon("aline-fictiva")["votes"]],
            ["pour", "contre"],
        )

    def test_date_differente_refusee(self):
        self.geler()
        ecrire_archive(
            self.archive, [MODELE, scrutin(9002, "2025-10-29", {ALINE: "contre"})]
        )
        code, _, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 2)
        self.assertIn("date", err)

    def test_depute_inconnu_refuse(self):
        self.geler()
        code, _, err = self.importer("aline-fictiva", "PA999999")
        self.assertEqual(code, 2)
        self.assertIn("ne figure dans aucun", err)
        self.assertFalse((self.dossier / "brouillons" / "aline-fictiva.yaml").exists())

    def test_acteur_et_archive_invalides(self):
        self.geler()
        code, _, err = self.lancer(
            "votes", "importer", "aline-fictiva", "--acteur", "PO1", "--archive", "x"
        )
        self.assertEqual(code, 2)
        self.assertIn("PA… attendu", err)
        (self.tmp / "pas-un-zip").write_text("x", encoding="utf-8")
        code, _, err = self.lancer(
            "votes",
            "importer",
            "aline-fictiva",
            "--acteur",
            ALINE,
            "--archive",
            str(self.tmp / "pas-un-zip"),
        )
        self.assertEqual(code, 2)
        self.assertIn("illisible", err)

    def test_membre_trop_volumineux_refuse(self):
        self.geler()
        with mock.patch.object(votes_an, "MEMBRE_MAX_OCTETS", 100):
            code, _, err = self.importer("aline-fictiva", ALINE)
        self.assertEqual(code, 2)
        self.assertIn("trop volumineux", err)

    def test_jeu_et_domaine(self):
        path = self.dossier / "quiz" / "scrutins.yaml"
        path.write_text(
            LISTE.replace(
                "https://assemblee.exemple.invalid",
                "https://www.assemblee-nationale.fr",
            ),
            encoding="utf-8",
        )
        code, _, err = self.lancer("scrutins", "geler")
        self.assertEqual(code, 2)
        self.assertIn("jeu demonstration", err)
        with self.assertRaises(Exception):
            schema.ScrutinRetenu.model_validate(
                {
                    "id": "x",
                    "theme": "sante",
                    "legislature": 17,
                    "numero": 1,
                    "date": "2025-01-01",
                    "titre": "t",
                    "url": "https://tiers.example/scrutin",
                }
            )

    def test_theme_inconnu_refuse(self):
        path = self.dossier / "quiz" / "scrutins.yaml"
        path.write_text(LISTE.replace("theme: sante", "theme: inconnu"), "utf-8")
        code, _, err = self.lancer("scrutins", "geler")
        self.assertEqual(code, 2)
        self.assertIn("thème « inconnu » inconnu", err)


if __name__ == "__main__":
    unittest.main()
