"""Outil de saisie de la présidentielle (presidentielle_tool.py) : choix du dossier de
données, écriture YAML, commandes (sources, extraction par un routeur simulé,
vérification, publication, rattachements, restauration côté conteneur, double lecture,
gestes du calendrier). Le jeu fictif est copié dans un dossier temporaire ; aucun appel
réseau, aucun git (la partie git de la restauration : presidentielle-test-restaurer.sh).

python -m unittest test_presidentielle_tool (dans router/, cf. README).
"""

import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from pathlib import Path
from unittest import mock

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook

import presidentielle_schema as schema
import presidentielle_tool as tool

DEMO = Path(__file__).parent / "fixtures" / "presidentielle" / "demo"
AUJOURD_HUI = date(2026, 11, 23)
ALINE = "candidats/aline-fictiva.yaml"
BRUNO = "candidats/bruno-demonstra.yaml"


class Racine(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def _racine(self, valeur: str) -> Path:
        with mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": valeur}):
            return tool.racine()

    def test_racine_variable_vide_refusee(self):
        for valeur in ("", "  "):
            with self.assertRaisesRegex(tool.Refus, "vide"):
                self._racine(valeur)

    def test_racine_dossier_absent_refuse(self):
        with self.assertRaisesRegex(tool.Refus, "introuvable"):
            self._racine(str(self.tmp / "absent"))

    def test_racine_jeu_fictif_refuse(self):
        with self.assertRaisesRegex(tool.Refus, "code d'antares_ai"):
            self._racine(str(DEMO))

    def test_racine_code_refuse(self):
        with self.assertRaisesRegex(tool.Refus, "code d'antares_ai"):
            self._racine(str(tool.CODE))

    def test_racine_sans_base_refusee(self):
        with self.assertRaisesRegex(tool.Refus, "base.yaml absent"):
            self._racine(str(self.tmp))

    def test_racine_depot_accepte(self):
        (self.tmp / "base.yaml").write_text("---\n", encoding="utf-8")
        self.assertEqual(self._racine(str(self.tmp)), self.tmp.resolve())


class EcrireYaml(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_yaml_ecrit_entete_et_accents(self):
        path = self.tmp / "sous" / "f.yaml"
        data = {"titre": "Égalité, écologie « réelle »", "liste": ["a", "b"]}
        tool.ecrire_yaml(path, data, entete="Première ligne\nSeconde ligne")
        texte = path.read_text(encoding="utf-8")
        self.assertTrue(texte.startswith("---\n# Première ligne\n# Seconde ligne\n"))
        self.assertIn("Égalité, écologie « réelle »", texte)
        self.assertNotIn("\\u", texte)
        self.assertEqual(yaml.safe_load(texte), data)

    def test_page_web_texte_visible_seulement(self):
        html = (
            "<!DOCTYPE html><html><head><title>Aline &amp; la page</title>"
            '<meta property="og:description" content="Je suis candidate.">'
            "<script>var jeton = 1;</script><style>p{}</style></head>"
            "<body><p>Premier   paragraphe</p><div>Second<br>bloc</div>"
            "<noscript>Activez JavaScript</noscript><p>Premier paragraphe</p></body></html>"
        )
        self.assertEqual(
            tool.texte_de_page_web(html),
            "Aline & la page\nJe suis candidate.\nPremier paragraphe\nSecond\nbloc",
        )

    def test_yaml_sans_ancre_pour_une_date_partagee(self):
        path = self.tmp / "f.yaml"
        jour = date(2026, 11, 23)
        tool.ecrire_yaml(path, {"mise_a_jour": jour, "relue_le": jour})
        self.assertEqual(
            path.read_text(encoding="utf-8"),
            "---\nmise_a_jour: 2026-11-23\nrelue_le: 2026-11-23\n",
        )

    def test_yaml_ordre_des_cles_garde(self):
        path = self.tmp / "f.yaml"
        tool.ecrire_yaml(path, {"z": 1, "a": 2})
        self.assertEqual(path.read_text(encoding="utf-8"), "---\nz: 1\na: 2\n")

    def test_yaml_echec_laisse_le_fichier_intact(self):
        path = self.tmp / "f.yaml"
        path.write_text("---\nancien: 1\n", encoding="utf-8")
        with self.assertRaises(yaml.representer.RepresenterError):
            tool.ecrire_yaml(path, {"objet": object()})
        self.assertEqual(path.read_text(encoding="utf-8"), "---\nancien: 1\n")
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ["f.yaml"])


class Commandes(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        shutil.copytree(DEMO, self.tmp / "donnees")
        env = {"PRESIDENTIELLE_DIR": str(self.tmp / "donnees")}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _lancer(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = tool.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_etat_resume_la_base(self):
        code, out, _ = self._lancer("etat")
        self.assertEqual(code, 0)
        self.assertIn("jeu demonstration", out)
        self.assertIn("4 fiche(s)", out)

    def test_refus_code_de_sortie_2(self):
        with mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": ""}):
            code, _, err = self._lancer("etat")
        self.assertEqual(code, 2)
        self.assertIn("REFUS", err)

    def test_commande_inconnue(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            tool.main(["inconnue"])

    def test_commande_git_affichee(self):
        commande = tool.commande_git(
            "Fiche publiée", ["candidats/x.yaml", "journal.yaml"]
        )
        self.assertIn("candidats/x.yaml journal.yaml", commande)
        self.assertIn("commit -m 'Fiche publiée'", commande)
        # Message copié dans un shell : jamais interprété
        commande = tool.commande_git('a"; echo $(id) `y`', ["f.yaml"])
        self.assertIn("""commit -m 'a"; echo $(id) `y`'""", commande)

    def test_appeler_en_tete_maison_sans_origin_ni_proxy(self):
        vues = []

        class Reponse(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def ouvrir(ouvreur, requete, timeout=None):
            vues.append((ouvreur, requete, timeout))
            return Reponse(b'{"kind": "ok"}')

        with (
            mock.patch.dict(os.environ, {"PRESIDENTIELLE_ROUTEUR": "http://routeur:1"}),
            mock.patch.object(tool.urllib.request.OpenerDirector, "open", ouvrir),
        ):
            self.assertEqual(
                tool.appeler(tool.CHEMIN_EXTRAIRE, {"type": "relecture"}),
                (200, {"kind": "ok"}),
            )
        ouvreur, requete, timeout = vues[0]
        self.assertEqual(
            requete.full_url, "http://routeur:1/api/presidentielle/extraire"
        )
        self.assertEqual(requete.get_method(), "POST")
        self.assertEqual(requete.get_header("X-antares"), "1")
        self.assertIsNone(requete.get_header("Origin"))
        self.assertEqual(json.loads(requete.data), {"type": "relecture"})
        self.assertEqual(timeout, tool.DELAI_HTTP)
        proxys = [
            h
            for h in ouvreur.handlers
            if isinstance(h, tool.urllib.request.ProxyHandler)
        ]
        self.assertTrue(all(not h.proxies for h in proxys))


class Routeur:
    """Routeur simulé : réponses successives de la route d'extraction ; l'index répond
    202. Chaque appel est gardé (chemin, corps)."""

    def __init__(self, *reponses):
        self.reponses = list(reponses)
        self.appels: list[tuple[str, dict]] = []

    def __call__(self, chemin: str, corps: dict) -> tuple[int, dict]:
        self.appels.append((chemin, corps))
        if chemin == tool.CHEMIN_INDEX:
            return 202, {}
        reponse = self.reponses.pop(0)
        return reponse(corps) if callable(reponse) else reponse

    @property
    def extractions(self) -> list[dict]:
        return [c for p, c in self.appels if p == tool.CHEMIN_EXTRAIRE]


def mesures(*items: dict) -> tuple[int, dict]:
    return 200, {"kind": "ok", "reponse": json.dumps({"mesures": list(items)})}


class Saisie(unittest.TestCase):
    """Copie du jeu fictif, date fixe, routeur simulé, aucune attente réelle."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.dossier = self.tmp / "donnees"
        shutil.copytree(DEMO, self.dossier)
        self.routeur = Routeur()
        self.attentes: list[float] = []
        for patch in (
            mock.patch.dict(os.environ, {"PRESIDENTIELLE_DIR": str(self.dossier)}),
            mock.patch.object(tool, "aujourd_hui", lambda: AUJOURD_HUI),
            mock.patch.object(tool, "appeler", self.routeur),
            mock.patch.object(tool, "attendre", self.attentes.append),
            # L'outil ne lance jamais git ni aucun programme
            mock.patch("subprocess.run", side_effect=AssertionError("subprocess")),
            mock.patch("subprocess.Popen", side_effect=AssertionError("subprocess")),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def lancer(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = tool.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def lire(self, rel: str):
        return yaml.safe_load((self.dossier / rel).read_text(encoding="utf-8"))

    def texte(self, rel: str) -> str:
        return (self.dossier / rel).read_text(encoding="utf-8")

    def modifier(self, rel: str, change) -> None:
        data = self.lire(rel)
        change(data)
        tool.ecrire_yaml(self.dossier / rel, data)

    def fichier(self, nom: str, contenu: str | bytes) -> Path:
        path = self.tmp / nom
        if isinstance(contenu, str):
            contenu = contenu.encode("utf-8")
        path.write_bytes(contenu)
        return path

    def ajouter_source(
        self, texte: str, candidat: str = "aline-fictiva", nom: str = "programme.txt"
    ) -> str:
        code, out, err = self.lancer(
            "source",
            "ajouter",
            candidat,
            str(self.fichier(nom, texte)),
            "--niveau",
            "candidat",
            "--titre",
            "Programme fictif",
            "--url",
            f"https://{candidat}.exemple.invalid/{nom}",
            "--publie-le",
            "2026-11-01",
        )
        self.assertEqual(code, 0, out + err)
        return self.lire("sources.yaml")["sources"][-1]["id"]

    def journal(self) -> list[dict]:
        return self.lire("journal.yaml")["entrees"]

    def assertInchange(self, rel: str, avant: str) -> None:
        self.assertEqual(self.texte(rel), avant)


PROGRAMME = (
    "Page 1 : économie\nNous créerons une taxe fictive sur les yachts de démonstration.\n"
    "\f"
    "Page 2 : santé\nChaque village fictif aura une maison de santé d’ici 2030.\n"
    "\f"
    "Page 3 : constats\nLe monde change vite.\n"
)


# Phrase à cheval sur deux pages (pied de page « 1 », en-tête « - 2 - »)
PROGRAMME_A_CHEVAL = (
    "Économie\nNous créerons une taxe fictive sur les yachts\n\n1\n"
    "\f"
    "- 2 -\nde démonstration dès la première année.\nSanté\nRien de fictif.\n"
)
CITATION_A_CHEVAL = (
    "Nous créerons une taxe fictive sur les yachts de démonstration dès la première "
    "année."
)
_RUN, _POPEN = subprocess.run, subprocess.Popen


def pdftotext_seul(args, *autres, **options):
    """subprocess.Popen réel pour pdftotext seulement (Saisie interdit tout programme)."""
    if not args or args[0] != "pdftotext":
        raise AssertionError(f"programme refusé : {args}")
    return _POPEN(args, *autres, **options)


def pdf_fictif(pages: list[list[tuple[int, int, str]]]) -> bytes:
    """PDF minimal (Helvetica) : chaque page est une liste de (x, y, texte) dans
    l'ordre du flux du PDF, qui peut différer de l'ordre de lecture."""
    objets: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding /WinAnsiEncoding >>",
    ]
    enfants = []
    for lignes in pages:
        flux = "".join(
            f"BT /F1 11 Tf {x} {y} Td ({texte}) Tj ET\n" for x, y, texte in lignes
        ).encode("cp1252")
        objets.append(
            f"<< /Length {len(flux)} >>\nstream\n".encode() + flux + b"endstream"
        )
        objets.append(
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources "
                f"<< /Font << /F1 3 0 R >> >> /Contents {len(objets)} 0 R >>"
            ).encode()
        )
        enfants.append(f"{len(objets)} 0 R")
    objets[1] = (
        f"<< /Type /Pages /Kids [{' '.join(enfants)}] /Count {len(enfants)} >>"
    ).encode()
    sortie = bytearray(b"%PDF-1.4\n")
    positions = []
    for numero, corps in enumerate(objets, 1):
        positions.append(len(sortie))
        sortie += f"{numero} 0 obj\n".encode() + corps + b"\nendobj\n"
    xref = len(sortie)
    sortie += f"xref\n0 {len(objets) + 1}\n0000000000 65535 f \n".encode()
    for position in positions:
        sortie += f"{position:010d} 00000 n \n".encode()
    sortie += (
        f"trailer\n<< /Size {len(objets) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(sortie)


# Deux colonnes écrites colonne par colonne dans le flux du PDF : l'ordre de lecture
# (pdftotext sans -raw) mêle les lignes des deux colonnes, la lecture brute non
PDF_COLONNES = pdf_fictif(
    [
        [
            (50, 800, "Nous fermerons les mines fictives"),
            (50, 780, "de la vallee de demonstration."),
            (320, 800, "Chaque village fictif aura"),
            (320, 780, "une maison de sante."),
        ],
        [(50, 800, "Fin du programme fictif."), (290, 40, "2")],
    ]
)
CITATION_COLONNE = "Nous fermerons les mines fictives de la vallee de demonstration."


class SourceAjouter(Saisie):
    def test_source_ajouter_empreinte(self):
        source_id = self.ajouter_source(PROGRAMME)
        empreinte = hashlib.sha256(PROGRAMME.encode("utf-8")).hexdigest()
        entree = self.lire("sources.yaml")["sources"][-1]
        self.assertEqual(entree["sha256"], empreinte)
        self.assertEqual(source_id, f"aline-fictiva-{empreinte[:8]}")
        self.assertEqual(entree["candidat"], "aline-fictiva")
        self.assertEqual(entree["consulte_le"], AUJOURD_HUI)
        self.assertEqual(entree["publie_le"], date(2026, 11, 1))
        texte = self.texte(f"documents/{empreinte}.txt")
        self.assertEqual(len(texte.split("\f")), 3)
        original = self.dossier / "documents" / f"{empreinte}.original.txt"
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), empreinte)
        # En-tête de sources.yaml gardé ; le schéma accepte le manifeste
        self.assertIn("# Documents inventés", self.texte("sources.yaml"))
        self.assertNotIn(
            "sources.yaml",
            [e.fichier for e in tool.base_presidentielle.relire(self.dossier).erreurs],
        )

    def test_source_ajouter_deux_fois_idempotent(self):
        self.ajouter_source(PROGRAMME)
        avant = self.texte("sources.yaml")
        code, out, _ = self.lancer(
            "source", "ajouter", "aline-fictiva", str(self.tmp / "programme.txt"),
            "--niveau", "candidat", "--titre", "Autre titre",
            "--url", "https://aline-fictiva.exemple.invalid/autre.txt",
        )  # fmt: skip
        self.assertEqual(code, 0)
        self.assertIn("déjà inscrit", out)
        self.assertInchange("sources.yaml", avant)

    def test_source_trop_grosse_signalee(self):
        path = self.tmp / "gros.pdf"
        with path.open("wb") as handle:
            handle.truncate(15 * 1024 * 1024 + 1)
        avant = self.texte("sources.yaml")
        code, _, err = self.lancer(
            "source", "ajouter", "aline-fictiva", str(path), "--niveau", "candidat",
            "--titre", "Gros", "--url", "https://aline-fictiva.exemple.invalid/g.pdf",
        )  # fmt: skip
        self.assertEqual(code, 2)
        self.assertIn("trop volumineux", err)
        self.assertIn("15 Mo", err)
        self.assertInchange("sources.yaml", avant)
        self.assertFalse((self.dossier / "documents").exists())

    def test_source_refus_adresse_hors_jeu_fictif(self):
        code, _, err = self.lancer(
            "source", "ajouter", "aline-fictiva", str(self.fichier("p.txt", PROGRAMME)),
            "--niveau", "candidat", "--titre", "P", "--url", "https://exemple.fr/p.txt",
        )  # fmt: skip
        self.assertEqual(code, 2)
        self.assertIn("exemple.invalid", err)

    def test_source_refus_adresse_http(self):
        code, _, err = self.lancer(
            "source", "ajouter", "aline-fictiva", str(self.fichier("p.txt", PROGRAMME)),
            "--niveau", "candidat", "--titre", "P",
            "--url", "http://aline-fictiva.exemple.invalid/p.txt",
        )  # fmt: skip
        self.assertEqual(code, 2)
        self.assertIn("https", err)


class SourceLecture(Saisie):
    """Lecture d'un PDF (ordre, brute) : source ajouter --lecture, source lecture,
    textes reconstruire ; pdftotext réel sur un PDF fictif généré."""

    def setUp(self):
        super().setUp()
        for patch in (
            mock.patch("subprocess.run", _RUN),
            mock.patch("subprocess.Popen", side_effect=pdftotext_seul),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.sha = hashlib.sha256(PDF_COLONNES).hexdigest()

    def ajouter_pdf(self, *options: str) -> tuple[int, str, str]:
        return self.lancer(
            "source", "ajouter", "aline-fictiva",
            str(self.fichier("colonnes.pdf", PDF_COLONNES)),
            "--niveau", "candidat", "--titre", "Programme en colonnes",
            "--url", "https://aline-fictiva.exemple.invalid/colonnes.pdf",
            "--id", "aline-colonnes", *options,
        )  # fmt: skip

    def entree(self) -> dict:
        return next(
            s
            for s in self.lire("sources.yaml")["sources"]
            if s["id"] == "aline-colonnes"
        )

    def trouvee(self, rel: str) -> bool:
        controle = tool.common.texte_de_controle(self.texte(rel).split("\f"))
        return bool(tool.common.pages_de_citation(controle, CITATION_COLONNE))

    def test_lecture_ordre_par_defaut_colonnes_melees(self):
        code, out, err = self.ajouter_pdf()
        self.assertEqual(code, 0, out + err)
        self.assertNotIn("lecture", self.entree())
        self.assertFalse(self.trouvee(f"textes/{self.sha}.txt"))

    def test_source_ajouter_lecture_brute(self):
        code, out, err = self.ajouter_pdf("--lecture", "brute")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(self.entree()["lecture"], "brute")
        self.assertTrue(self.trouvee(f"documents/{self.sha}.txt"))
        self.assertTrue(self.trouvee(f"textes/{self.sha}.txt"))
        self.assertEqual(len(self.texte(f"textes/{self.sha}.txt").split("\f")), 2)
        self.assertNotIn(
            "sources.yaml",
            [e.fichier for e in tool.base_presidentielle.relire(self.dossier).erreurs],
        )

    def test_lecture_brute_reservee_aux_pdf(self):
        avant = self.texte("sources.yaml")
        code, _, err = self.lancer(
            "source", "ajouter", "aline-fictiva", str(self.fichier("p.txt", PROGRAMME)),
            "--niveau", "candidat", "--titre", "P", "--lecture", "brute",
            "--url", "https://aline-fictiva.exemple.invalid/p.txt",
        )  # fmt: skip
        self.assertEqual(code, 2)
        self.assertIn("réservée à un PDF", err)
        self.assertInchange("sources.yaml", avant)

    def test_source_ajouter_deja_inscrite_autre_lecture_refusee(self):
        self.assertEqual(self.ajouter_pdf()[0], 0)
        code, _, err = self.ajouter_pdf("--lecture", "brute")
        self.assertEqual(code, 2)
        self.assertIn("source lecture aline-colonnes brute", err)

    def test_source_lecture_brute_regenere_et_journalise(self):
        self.assertEqual(self.ajouter_pdf()[0], 0)
        entrees = len(self.journal())
        code, out, err = self.lancer("source", "lecture", "aline-colonnes", "brute")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(self.entree()["lecture"], "brute")
        self.assertTrue(self.trouvee(f"documents/{self.sha}.txt"))
        self.assertTrue(self.trouvee(f"textes/{self.sha}.txt"))
        [entree] = self.journal()[entrees:]
        self.assertEqual((entree["objet"], entree["cible"]), ("base", "sources"))
        self.assertIn("aline-colonnes en lecture brute", entree["motif"])
        self.assertIn("pdftotext -raw", entree["motif"])
        self.assertIn(f"textes/{self.sha}.txt", out)
        self.assertIn("git", out)
        # Déjà en lecture brute : rien à faire ; retour à l'ordre : clé retirée
        avant = self.texte("journal.yaml")
        code, out, _ = self.lancer("source", "lecture", "aline-colonnes", "brute")
        self.assertEqual(code, 0)
        self.assertIn("rien à faire", out)
        self.assertInchange("journal.yaml", avant)
        code, out, err = self.lancer("source", "lecture", "aline-colonnes", "ordre")
        self.assertEqual(code, 0, out + err)
        self.assertNotIn("lecture", self.entree())
        self.assertFalse(self.trouvee(f"textes/{self.sha}.txt"))

    def test_source_lecture_refusee_si_citation_publiee_perdue(self):
        self.assertEqual(self.ajouter_pdf()[0], 0)
        # Fiche publiée qui cite le texte en ordre de lecture (lignes mêlées)
        citation = "Nous fermerons les mines fictives Chaque village fictif aura"
        self.assertTrue(
            tool.common.pages_de_citation(
                tool.common.texte_de_controle(
                    self.texte(f"textes/{self.sha}.txt").split("\f")
                ),
                citation,
            )
        )
        self.modifier(
            ALINE,
            lambda d: d["mesures"][0].update(
                source_id="aline-colonnes", citation=citation, page=1
            ),
        )
        avant = [
            self.texte(rel)
            for rel in (
                "sources.yaml",
                "journal.yaml",
                f"textes/{self.sha}.txt",
                f"documents/{self.sha}.txt",
            )
        ]
        code, _, err = self.lancer("source", "lecture", "aline-colonnes", "brute")
        self.assertEqual(code, 2)
        self.assertIn("lecture brute refusée", err)
        mesure_id = self.lire(ALINE)["mesures"][0]["id"]
        self.assertIn(f"candidats/aline-fictiva.yaml : mesure {mesure_id}", err)
        self.assertEqual(
            [
                self.texte(rel)
                for rel in (
                    "sources.yaml",
                    "journal.yaml",
                    f"textes/{self.sha}.txt",
                    f"documents/{self.sha}.txt",
                )
            ],
            avant,
        )

    def test_source_lecture_brouillon_averti(self):
        self.assertEqual(self.ajouter_pdf()[0], 0)
        brouillon = self.lire(ALINE)
        brouillon["mesures"][0].update(
            source_id="aline-colonnes",
            citation="Nous fermerons les mines fictives Chaque village fictif aura",
        )
        tool.ecrire_yaml(self.dossier / "brouillons/aline-fictiva.yaml", brouillon)
        code, out, err = self.lancer("source", "lecture", "aline-colonnes", "brute")
        self.assertEqual(code, 0, out + err)
        self.assertIn(
            "AVERTISSEMENT : brouillons/aline-fictiva.yaml : mesure "
            f"{brouillon['mesures'][0]['id']} : citation introuvable",
            out,
        )

    def test_source_lecture_refus(self):
        code, _, err = self.lancer("source", "lecture", "inconnue", "brute")
        self.assertEqual(code, 2)
        self.assertIn("source inconnue", err)
        # Document original absent de documents/ (autre poste)
        self.assertEqual(self.ajouter_pdf()[0], 0)
        (self.dossier / "documents" / f"{self.sha}.pdf").unlink()
        code, _, err = self.lancer("source", "lecture", "aline-colonnes", "brute")
        self.assertEqual(code, 2)
        self.assertIn("document original", err)
        self.assertNotIn("lecture", self.entree())

    def test_textes_reconstruire_respecte_la_lecture(self):
        self.assertEqual(self.ajouter_pdf()[0], 0)
        self.assertEqual(
            self.lancer("source", "lecture", "aline-colonnes", "brute")[0], 0
        )
        # Texte versionné perdu, texte de documents/ d'une autre lecture (ordre)
        ordre = "\f".join(tool.pages_du_document("c.pdf", PDF_COLONNES))
        (self.dossier / "documents" / f"{self.sha}.txt").write_text(ordre, "utf-8")
        (self.dossier / "textes" / f"{self.sha}.txt").unlink()
        code, out, err = self.lancer("textes", "reconstruire")
        self.assertEqual(code, 0, out + err)
        self.assertTrue(self.trouvee(f"textes/{self.sha}.txt"))
        # Sans le PDF original, une source en lecture brute n'est pas reconstruite
        (self.dossier / "textes" / f"{self.sha}.txt").unlink()
        (self.dossier / "documents" / f"{self.sha}.pdf").unlink()
        code, out, _ = self.lancer("textes", "reconstruire")
        self.assertEqual(code, 0)
        self.assertIn("aline-colonnes : documents/ sans texte extrait", out)
        self.assertFalse((self.dossier / "textes" / f"{self.sha}.txt").exists())

    def test_correction_apres_la_sous_commande(self):
        # --correction reste accepté après les arguments (base non archivée : refus)
        code, _, err = self.lancer(
            "source", "lecture", "aline-colonnes", "brute", "--correction", "motif"
        )
        self.assertEqual(code, 2)
        self.assertIn("--correction réservé à une base archivée", err)


class Tranches(unittest.TestCase):
    def test_extraire_tranches_sur_sauts_de_page(self):
        # 20 pages d'environ 1 000 jetons : 20 000 jetons
        page = ("Une phrase de programme fictif. " * 110).strip()
        pages = [f"{page} Fin de la page {n}." for n in range(1, 21)]
        resultat = tool.tranches(pages)
        self.assertEqual(len(resultat), 3)
        vues = [n for t in resultat for n in t.pages]
        self.assertEqual(vues, list(range(1, 21)))
        for tranche in resultat:
            jetons = tool.documents.estimate_tokens(tranche.texte)
            self.assertLessEqual(jetons, tool.TRANCHE_JETONS)
            self.assertEqual(
                tranche.pages, list(range(tranche.pages[0], tranche.pages[-1] + 1))
            )
            for n in tranche.pages:
                self.assertIn(f"[page {n}]\n", tranche.texte)
        self.assertGreater(tool.documents.estimate_tokens(resultat[0].texte), 6_000)

    def test_extraire_page_plus_longue_qu_une_tranche(self):
        page = "\n".join(
            f"Ligne {n} du programme fictif, assez longue." for n in range(1, 4000)
        )
        self.assertGreater(tool.documents.estimate_tokens(page), 12_000)
        resultat = tool.tranches([page])
        self.assertGreaterEqual(len(resultat), 2)
        for tranche in resultat:
            self.assertEqual(tranche.pages, [1])
            jetons = tool.documents.estimate_tokens(tranche.texte)
            self.assertLessEqual(jetons, tool.TRANCHE_JETONS)
            self.assertLess(jetons, tool.CONTEXTE_JETONS)
        recolle = " ".join(t.texte.replace("[page 1]\n", "") for t in resultat).split()
        self.assertEqual(recolle, page.split())

    def test_ligne_sans_fin_coupee_entre_les_mots(self):
        page = "mot " * 40_000
        resultat = tool.tranches([page])
        self.assertGreaterEqual(len(resultat), 2)
        for tranche in resultat:
            self.assertLessEqual(
                tool.documents.estimate_tokens(tranche.texte), tool.TRANCHE_JETONS
            )


class Extraire(Saisie):
    def setUp(self):
        super().setUp()
        self.source = self.ajouter_source(PROGRAMME)

    def extraire(self) -> tuple[int, str, str]:
        return self.lancer("extraire", "aline-fictiva", self.source)

    def brouillon(self) -> dict:
        return self.lire("brouillons/aline-fictiva.yaml")

    def nouvelles(self) -> list[dict]:
        return [m for m in self.brouillon()["mesures"] if m["source_id"] == self.source]

    def test_extraire_citation_controlee(self):
        self.routeur.reponses.append(
            mesures(
                {
                    "theme": "economie",
                    "citation": "Nous créerons une taxe fictive sur les yachts de démonstration.",
                    "page": 1,
                    "resume": "Taxe sur les yachts.",
                }
            )
        )
        code, out, err = self.extraire()
        self.assertEqual(code, 0, out + err)
        [mesure] = self.nouvelles()
        self.assertEqual(mesure["id"], "economie-1")
        self.assertFalse(mesure["a_verifier"])
        self.assertEqual(mesure["page"], 1)
        self.assertEqual(mesure["ajoutee_le"], AUJOURD_HUI)
        # Le brouillon part de la fiche publiée : ses mesures sont gardées
        self.assertIn("eco-impot", [m["id"] for m in self.brouillon()["mesures"]])
        corps = self.routeur.extractions[0]
        self.assertEqual(corps["type"], "extraction")
        self.assertEqual(corps["candidat"], "aline-fictiva")
        self.assertIn("economie", corps["themes"])
        self.assertIn("[page 1]", corps["texte"])
        # Le brouillon n'est jamais lu par le routeur (fichier hors de la base publiée)
        self.assertNotIn(
            "brouillons",
            " ".join(tool.base_presidentielle.fichiers_publies(self.dossier)),
        )

    def test_extraire_citation_inventee_a_verifier(self):
        self.routeur.reponses.append(
            mesures(
                {"theme": "economie", "citation": "Nous raserons gratis.", "page": 1}
            )
        )
        self.assertEqual(self.extraire()[0], 0)
        [mesure] = self.nouvelles()
        self.assertTrue(mesure["a_verifier"])

    def test_extraire_citation_typographique_acceptee(self):
        # Apostrophe droite côté modèle, typographique dans le document
        self.routeur.reponses.append(
            mesures(
                {
                    "theme": "sante",
                    "citation": "Chaque village fictif aura une maison de santé d'ici 2030.",
                    "page": 1,
                }
            )
        )
        self.assertEqual(self.extraire()[0], 0)
        [mesure] = self.nouvelles()
        self.assertFalse(mesure["a_verifier"])
        # Page corrigée : celle où la citation figure
        self.assertEqual(mesure["page"], 2)

    def test_extraire_citation_a_cheval_page_de_debut(self):
        # Phrase coupée par un saut de page, pied « 1 » et en-tête « - 2 - » : la page
        # retenue est celle où la citation commence, pas celle proposée par le modèle
        self.source = self.ajouter_source(PROGRAMME_A_CHEVAL, nom="cheval.txt")
        self.routeur.reponses.append(
            mesures(
                {
                    "theme": "economie",
                    "citation": CITATION_A_CHEVAL,
                    "page": 2,
                }
            )
        )
        self.assertEqual(self.extraire()[0], 0)
        [mesure] = self.nouvelles()
        self.assertFalse(mesure["a_verifier"])
        self.assertEqual(mesure["page"], 1)

    def test_extraire_theme_hors_grille_a_verifier(self):
        self.routeur.reponses.append(
            mesures(
                {"theme": "Culture !", "citation": "Le monde change vite.", "page": 3},
                {
                    "theme": "numerique",
                    "citation": "Nous créerons une taxe fictive sur les yachts de démonstration.",
                },
            )
        )
        self.assertEqual(self.extraire()[0], 0)
        a_classer, hors_grille = self.nouvelles()
        self.assertEqual(a_classer["theme"], tool.THEME_A_CLASSER)
        self.assertTrue(a_classer["a_verifier"])
        self.assertEqual(hors_grille["theme"], "numerique")
        self.assertTrue(hors_grille["a_verifier"])

    def test_extraire_theme_hors_quiz_accepte(self):
        # ADR 0016 : thèmes de la grille puis thèmes hors quiz proposés au modèle ; une
        # mesure culture citée mot pour mot n'est pas à vérifier
        self.routeur.reponses.append(
            mesures(
                {
                    "theme": "culture",
                    "citation": "Nous créerons une taxe fictive sur les yachts de démonstration.",
                    "page": 1,
                }
            )
        )
        self.assertEqual(self.extraire()[0], 0)
        [mesure] = self.nouvelles()
        self.assertEqual(mesure["theme"], "culture")
        self.assertFalse(mesure["a_verifier"])
        themes = self.routeur.extractions[0]["themes"]
        self.assertEqual(themes[-2:], ["culture", "solidarites"])
        self.assertEqual(len(themes), 12)

    def test_extraire_sans_grille_themes_de_reference(self):
        (self.dossier / "quiz" / "grille.yaml").unlink()
        self.routeur.reponses.append(mesures())
        self.assertEqual(self.extraire()[0], 0)
        self.assertEqual(
            self.routeur.extractions[0]["themes"], list(tool.THEMES_REFERENCE)
        )
        self.assertEqual(tool.THEMES_REFERENCE[-2:], ("culture", "solidarites"))

    def test_extraire_citation_trop_courte_a_verifier(self):
        self.routeur.reponses.append(
            mesures({"theme": "economie", "citation": "Nous créerons", "page": 1})
        )
        self.assertEqual(self.extraire()[0], 0)
        [mesure] = self.nouvelles()
        self.assertTrue(mesure["a_verifier"])

    def test_extraire_reponse_illisible(self):
        self.routeur.reponses.append((200, {"kind": "ok", "reponse": "{pas du json"}))
        code, out, _ = self.extraire()
        self.assertEqual(code, 0)
        self.assertIn("illisible", out)
        passage = self.brouillon()["extraction"][-1]
        self.assertEqual(
            passage["tranches_illisibles"], [{"tranche": 1, "pages": "1-3"}]
        )
        self.assertEqual(passage["pages_non_couvertes"], [1, 2, 3])

    def test_extraire_pages_non_couvertes_listees(self):
        self.routeur.reponses.append(
            mesures(
                {
                    "theme": "economie",
                    "citation": "Nous créerons une taxe fictive sur les yachts de démonstration.",
                }
            )
        )
        self.assertEqual(self.extraire()[0], 0)
        passage = self.brouillon()["extraction"][-1]
        self.assertEqual(passage["source_id"], self.source)
        self.assertEqual(passage["pages_non_couvertes"], [2, 3])

    def test_extraire_plusieurs_tranches_illisible_sans_arret(self):
        # Environ 5 000 jetons par longue page : deux tranches (1, puis 2 et 3)
        longue = ("Phrase fictive de remplissage. " * 580).strip()
        texte = "\f".join([longue, longue, "Nous fermerons les mines fictives."])
        self.source = self.ajouter_source(texte, nom="long.txt")
        self.routeur.reponses += [
            (200, {"kind": "ok", "reponse": "pas du json"}),
            mesures(
                {"theme": "ecologie", "citation": "Nous fermerons les mines fictives."}
            ),
        ]
        code, _, _ = self.extraire()
        self.assertEqual(code, 0)
        self.assertEqual(len(self.routeur.extractions), 2)
        self.assertEqual(len(self.nouvelles()), 1)

    def test_extraire_reprend_la_tranche_apres_attente(self):
        attente = (409, {"kind": "attente", "retry_after": 30})
        self.routeur.reponses += [attente, attente, mesures()]
        code, out, _ = self.extraire()
        self.assertEqual(code, 0)
        self.assertEqual(self.attentes, [30, 30])
        textes = [c["texte"] for c in self.routeur.extractions]
        self.assertEqual(len(textes), 3)
        self.assertEqual(len(set(textes)), 1)
        self.assertIn("Appel vocal en cours", out)

    def test_extraire_modele_refuse_arret(self):
        self.routeur.reponses.append(
            (503, {"detail": "modèle non autorisé pour cette page"})
        )
        code, _, err = self.extraire()
        self.assertEqual(code, 2)
        self.assertIn("non autorisé", err)
        self.assertFalse((self.dossier / "brouillons").exists())

    def test_extraire_routeur_injoignable(self):
        def injoignable(chemin, corps):
            raise OSError("refusé")

        with mock.patch.object(tool, "appeler", injoignable):
            code, _, err = self.extraire()
        self.assertEqual(code, 2)
        self.assertIn("injoignable", err)

    def test_extraire_source_autre_candidat_refusee(self):
        code, _, err = self.lancer("extraire", "bruno-demonstra", self.source)
        self.assertEqual(code, 2)
        self.assertIn("autre candidat", err)
        self.assertEqual(self.routeur.appels, [])

    def test_extraire_sans_texte_refusee(self):
        for dossier in ("documents", "textes"):
            for path in (self.dossier / dossier).glob("*.txt"):
                path.unlink()
        code, _, err = self.extraire()
        self.assertEqual(code, 2)
        self.assertIn("texte de la source", err)

    def test_extraire_connections_jamais_lu(self):
        # L'outil passe par le routeur : ni Connexions ni fournisseur appelé directement
        code = Path(tool.__file__).read_text(encoding="utf-8")
        for interdit in ("connections", "providers", "httpx"):
            self.assertNotRegex(code, rf"(?m)^(import|from) {interdit}\b")
        self.assertNotIn('connections.json"', code)

    def test_extraire_nouveau_candidat_squelette(self):
        self.source = self.ajouter_source(
            "Nous planterons des arbres fictifs.", candidat="zoe-nouvelle", nom="z.txt"
        )
        self.routeur.reponses.append(mesures())
        code, _, _ = self.lancer("extraire", "zoe-nouvelle", self.source)
        self.assertEqual(code, 0)
        brouillon = self.lire("brouillons/zoe-nouvelle.yaml")
        self.assertEqual(brouillon["id"], "zoe-nouvelle")
        self.assertTrue(brouillon["fictif"])
        self.assertEqual(brouillon["statut_source"], tool.A_COMPLETER)
        self.assertTrue(
            self.texte("brouillons/zoe-nouvelle.yaml").startswith("---\n# Brouillon")
        )


class Verifier(Saisie):
    def test_verifier_sans_texte_source_avertit(self):
        code, out, _ = self.lancer("verifier")
        self.assertEqual(code, 0, out)
        self.assertIn("contrôle mot pour mot non fait", out)
        self.assertIn("0 erreur(s)", out)
        self.assertIn("Équilibre : aline-fictiva", out)

    def ecrire_texte_source(self, source_id: str, texte: str) -> None:
        sha = next(
            s for s in self.lire("sources.yaml")["sources"] if s["id"] == source_id
        )["sha256"]
        (self.dossier / "documents").mkdir(exist_ok=True)
        (self.dossier / "documents" / f"{sha}.txt").write_text(texte, encoding="utf-8")

    def test_verifier_citation_mot_pour_mot(self):
        citations = [m["citation"] for m in self.lire(BRUNO)["mesures"]]
        self.ecrire_texte_source("bruno-programme", "\n".join(citations))
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 0, out)
        self.assertNotIn("bruno-programme absent", out)
        # Une citation retouchée n'est plus trouvée : erreur
        self.ecrire_texte_source("bruno-programme", "\n".join(citations[1:]))
        code, out, _ = self.lancer("verifier")
        self.assertEqual(code, 1)
        self.assertIn("mesure eco-impot : citation introuvable", out)

    def test_verifier_citation_a_cheval_sur_des_sauts_de_page(self):
        mesures_bruno = self.lire(BRUNO)["mesures"]
        eco = mesures_bruno[0]
        self.assertEqual((eco["id"], eco["page"]), ("eco-impot", 3))
        debut, fin = eco["citation"].split(" de dix ")
        autres = "\n".join(m["citation"] for m in mesures_bruno[1:])
        pages = [
            "Page fictive.\n",
            "Page fictive.\n",
            f"Introduction fictive.\n{debut}\n\n3\n",
            "- 4 -\nde dix pour cent\n\n4/12\n",
            f"5 / 12\n{fin.removeprefix('pour cent ')}\n{autres}\n",
        ]
        texte = "\f".join(pages)
        self.ecrire_texte_source("bruno-programme", texte)
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 0, out)
        self.assertNotIn("eco-impot : citation", out)
        # Page de la mesure : celle où la citation commence, pas la suivante
        self.modifier(BRUNO, lambda d: d["mesures"][0].update(page=4))
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 0, out)
        self.assertIn("mesure eco-impot : citation trouvée, mais pas à la page 4", out)
        # Le texte stocké n'est jamais retouché
        sha = next(
            s
            for s in self.lire("sources.yaml")["sources"]
            if s["id"] == "bruno-programme"
        )["sha256"]
        self.assertEqual(self.texte(f"documents/{sha}.txt"), texte)

    def test_verifier_citation_a_cheval_malgre_un_titre_courant(self):
        mesures_bruno = self.lire(BRUNO)["mesures"]
        debut, fin = mesures_bruno[0]["citation"].split(" de dix ")
        autres = "\n".join(m["citation"] for m in mesures_bruno[1:])
        titre, site = "Livret fictif : la France de demain", "www.fictif.invalid"
        pages = [
            f"{titre}\nPage fictive une.\n{site}\n1\n",
            f"{titre}\nPage fictive deux.\n{site}\n2\n",
            f"{titre}\nIntroduction fictive.\n{debut}\n{site}\n3\n",
            f"{titre}\nde dix {fin}\n{autres}\n{site}\n4\n",
        ]
        self.ecrire_texte_source("bruno-programme", "\f".join(pages))
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 0, out)
        self.assertNotIn("eco-impot : citation", out)
        # Titre courant vu sur 2 pages seulement d'un document de 10 : gardé
        pages = [
            f"Page fictive {mot}.\n" for mot in ("a", "b", "c", "d", "e", "f", "g")
        ]
        pages[2] = f"Introduction fictive.\n{debut}\n{titre}\n"
        pages.insert(3, f"de dix {fin}\n{autres}\n")
        pages.insert(0, f"{titre}\nPage fictive zéro.\n")
        pages.append("Page fictive finale.\n")
        self.assertEqual(len(pages), 10)
        self.ecrire_texte_source("bruno-programme", "\f".join(pages))
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 1, out)
        self.assertIn("mesure eco-impot : citation introuvable", out)

    def test_verifier_lit_textes_avant_documents(self):
        # documents/ (hors git) peut dater d'une autre lecture : textes/ fait foi
        citations = [m["citation"] for m in self.lire(BRUNO)["mesures"]]
        self.ecrire_texte_source("bruno-programme", "Texte d'une autre lecture.")
        sha = next(
            s
            for s in self.lire("sources.yaml")["sources"]
            if s["id"] == "bruno-programme"
        )["sha256"]
        (self.dossier / "textes").mkdir(exist_ok=True)
        (self.dossier / "textes" / f"{sha}.txt").write_text(
            "\n".join(citations), encoding="utf-8"
        )
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 0, out)
        self.assertNotIn("citation introuvable", out)

    def test_verifier_citation_coupee_par_autre_chose_qu_un_numero(self):
        mesures_bruno = self.lire(BRUNO)["mesures"]
        debut, fin = mesures_bruno[0]["citation"].split(" de dix ")
        autres = "\n".join(m["citation"] for m in mesures_bruno[1:])
        texte = f"{debut}\nNote fictive\n\fde dix {fin}\n{autres}\n"
        self.ecrire_texte_source("bruno-programme", texte)
        code, out, _ = self.lancer("verifier", BRUNO)
        self.assertEqual(code, 1, out)
        self.assertIn("mesure eco-impot : citation introuvable", out)

    def test_verifier_brouillon_themes_hors_quiz(self):
        # ADR 0016 : mesures et votes culture ou solidarites admis, autre thème refusé
        brouillon = self.lire(ALINE)
        brouillon["votes"][0]["theme"] = "culture"
        tool.ecrire_yaml(self.dossier / "brouillons/aline-fictiva.yaml", brouillon)
        code, out, _ = self.lancer("verifier", "brouillons/aline-fictiva.yaml")
        self.assertEqual(code, 0, out)
        self.assertNotIn("inconnu", out)
        brouillon["mesures"][0]["theme"] = "numerique"
        tool.ecrire_yaml(self.dossier / "brouillons/aline-fictiva.yaml", brouillon)
        code, out, _ = self.lancer("verifier", "brouillons/aline-fictiva.yaml")
        self.assertEqual(code, 1)
        self.assertIn("thème « numerique » inconnu", out)

    def test_verifier_grille_modifiee_apres_gel(self):
        self.modifier(
            "quiz/grille.yaml",
            lambda d: d["themes"][0]["questions"][0].update(
                enonce="Énoncé changé après le gel ?"
            ),
        )
        code, out, _ = self.lancer("verifier")
        self.assertEqual(code, 1)
        self.assertIn("grille modifiée après le gel", out)

    def test_verifier_base_reelle_vide_sans_avertissement(self):
        for rel in ("quiz/grille.yaml", "quiz/rattachements.yaml"):
            (self.dossier / rel).unlink()
        for path in (self.dossier / "candidats").glob("*.yaml"):
            path.unlink()
        tool.ecrire_yaml(self.dossier / "sources.yaml", {"sources": []})
        self.modifier("base.yaml", lambda d: d.update(jeu="reel", partis=[]))
        code, out, _ = self.lancer("verifier")
        self.assertEqual(code, 0, out)
        self.assertNotIn("AVERTISSEMENT", out)
        self.assertIn("0 fiche(s)", out)

    def test_verifier_brouillon_nom_dans_la_grille(self):
        brouillon = self.lire(ALINE)
        brouillon.update(
            id="jean-retraites", nom_affiche="Jean Retraites", initiales="JR"
        )
        for cle in ("mesures", "lignes_phares", "votes"):
            brouillon[cle] = []
        brouillon["parlementaire"] = False
        tool.ecrire_yaml(self.dossier / "brouillons/jean-retraites.yaml", brouillon)
        code, out, _ = self.lancer("verifier", "brouillons/jean-retraites.yaml")
        self.assertEqual(code, 1)
        self.assertIn("interdit (Retraites)", out)

    def test_verifier_brouillon_a_verifier_erreur(self):
        brouillon = self.lire(ALINE)
        brouillon["mesures"][0]["a_verifier"] = True
        tool.ecrire_yaml(self.dossier / "brouillons/aline-fictiva.yaml", brouillon)
        code, out, _ = self.lancer("verifier", "brouillons/aline-fictiva.yaml")
        self.assertEqual(code, 1)
        self.assertIn("a_verifier", out)

    def test_verifier_fichier_hors_depot_refuse(self):
        code, _, err = self.lancer("verifier", str(DEMO / ALINE))
        self.assertEqual(code, 2)
        self.assertIn("hors du dépôt", err)


class Publier(Saisie):
    def setUp(self):
        super().setUp()
        self.brouillon = self.lire(ALINE)
        self.brouillon["description"]["texte"] = "Description relue pour la version 2."
        self.brouillon["extraction"] = [
            {"source_id": "aline-programme", "pages_non_couvertes": [2]}
        ]

    def ecrire(self) -> None:
        tool.ecrire_yaml(self.dossier / "brouillons/aline-fictiva.yaml", self.brouillon)

    def test_publier_refuse_a_verifier(self):
        self.brouillon["mesures"][0]["a_verifier"] = True
        self.ecrire()
        avant = self.texte(ALINE), self.texte("journal.yaml")
        code, _, err = self.lancer("publier", "aline-fictiva")
        self.assertEqual(code, 2)
        self.assertIn("à vérifier", err)
        self.assertEqual((self.texte(ALINE), self.texte("journal.yaml")), avant)
        self.assertTrue((self.dossier / "brouillons/aline-fictiva.yaml").is_file())

    def test_publier_refuse_source_manquante(self):
        self.brouillon["mesures"][0]["source_id"] = "source-absente"
        self.ecrire()
        avant = self.texte(ALINE)
        code, _, err = self.lancer("publier", "aline-fictiva")
        self.assertEqual(code, 2)
        self.assertIn("source-absente", err)
        self.assertInchange(ALINE, avant)

    def test_publier_version_journal_relue_le(self):
        self.ecrire()
        code, out, err = self.lancer("publier", "aline-fictiva")
        self.assertEqual(code, 0, out + err)
        fiche = self.lire(ALINE)
        self.assertEqual(fiche["version"], 2)
        self.assertEqual(fiche["relue_le"], AUJOURD_HUI)
        self.assertEqual(fiche["mise_a_jour"], AUJOURD_HUI)
        self.assertNotIn("extraction", fiche)
        self.assertEqual(
            self.journal()[-1],
            {
                "date": AUJOURD_HUI,
                "objet": "fiche",
                "cible": "aline-fictiva",
                "version": 2,
                "motif": "Mise à jour de la fiche",
            },
        )
        self.assertFalse((self.dossier / "brouillons/aline-fictiva.yaml").exists())
        self.assertIn(
            'git -C "$PRESIDENTIELLE_DATA" add candidats/aline-fictiva.yaml journal.yaml',
            out,
        )
        self.assertIn([tool.CHEMIN_INDEX], [[p] for p, _ in self.routeur.appels])
        # La base publiée reste valide et sert la nouvelle version
        etat = tool.base_presidentielle.relire(self.dossier)
        self.assertEqual(etat.erreurs, [])
        self.assertEqual(etat.fiches["aline-fictiva"].version, 2)

    def test_publier_routeur_injoignable_avertit(self):
        self.ecrire()

        def injoignable(chemin, corps):
            raise OSError("refusé")

        with mock.patch.object(tool, "appeler", injoignable):
            code, out, _ = self.lancer("publier", "aline-fictiva")
        self.assertEqual(code, 0)
        self.assertIn("AVERTISSEMENT : index des passages non reconstruit", out)
        self.assertEqual(self.lire(ALINE)["version"], 2)

    def test_publier_journal_illisible_rien_ecrit(self):
        self.ecrire()
        for contenu in ("---\nentrees: [\n", "---\nentrees: pas une liste\n"):
            with self.subTest(contenu=contenu):
                (self.dossier / "journal.yaml").write_text(contenu, encoding="utf-8")
                avant = self.texte(ALINE)
                code, _, err = self.lancer("publier", "aline-fictiva")
                self.assertEqual(code, 2)
                self.assertIn("journal.yaml", err)
                self.assertInchange(ALINE, avant)
                self.assertInchange("journal.yaml", contenu)
                self.assertTrue(
                    (self.dossier / "brouillons/aline-fictiva.yaml").is_file()
                )

    def test_liste_officielle_journal_illisible_rien_ecrit(self):
        (self.dossier / "journal.yaml").write_text(
            "---\nentrees: 3\n", encoding="utf-8"
        )
        avant = {p: p.read_bytes() for p in self.dossier.rglob("*.yaml")}
        code, _, _ = self.lancer(
            "liste-officielle",
            "--source",
            "etat-declarations",
            "--officiels",
            "aline-fictiva",
        )
        self.assertEqual(code, 2)
        self.assertEqual(
            {p: p.read_bytes() for p in self.dossier.rglob("*.yaml")}, avant
        )

    def test_publier_sans_brouillon(self):
        code, _, err = self.lancer("publier", "aline-fictiva")
        self.assertEqual(code, 2)
        self.assertIn("aucun brouillon", err)

    def test_yaml_ecrit_conforme_yamllint(self):
        self.ecrire()
        self.assertEqual(self.lancer("publier", "aline-fictiva")[0], 0)
        for rel in (ALINE, "journal.yaml"):
            texte = self.texte(rel)
            self.assertTrue(texte.startswith("---\n"), rel)
            self.assertIn("é", texte)
            self.assertNotIn("\\u", texte)
            self.assertTrue(texte.endswith("\n"))
            for ligne in texte.splitlines():
                self.assertLessEqual(len(ligne), 140, ligne)
                self.assertEqual(ligne, ligne.rstrip(), "espace en fin de ligne")
        # En-têtes de commentaire gardés
        self.assertIn("# Personne inventée", self.texte(ALINE))
        self.assertIn("# Journal des mises à jour", self.texte("journal.yaml"))


class Restaurer(Saisie):
    def test_restaurer_journal_et_index(self):
        ancienne = self.lire(ALINE)
        ancienne["description"]["texte"] = "Texte de la version restaurée."
        tool.ecrire_yaml(self.dossier / "brouillons/.restaurer-aline", ancienne)
        code, out, err = self.lancer(
            "restaurer",
            "aline-fictiva",
            "0123456789abcdef",
            "--depuis",
            "brouillons/.restaurer-aline",
        )
        self.assertEqual(code, 0, out + err)
        fiche = self.lire(ALINE)
        self.assertEqual(
            fiche["description"]["texte"], "Texte de la version restaurée."
        )
        self.assertEqual(fiche["version"], 2)
        entree = self.journal()[-1]
        self.assertEqual(entree["version"], 2)
        self.assertIn(
            "Restauration de la révision 0123456789ab (version 1)", entree["motif"]
        )
        self.assertIn(tool.CHEMIN_INDEX, [p for p, _ in self.routeur.appels])

    def test_restaurer_fiche_invalide_refusee(self):
        tool.ecrire_yaml(self.dossier / "brouillons/.r", {"id": "aline-fictiva"})
        avant = self.texte(ALINE)
        code, _, _ = self.lancer(
            "restaurer", "aline-fictiva", "abc", "--depuis", "brouillons/.r"
        )
        self.assertEqual(code, 2)
        self.assertInchange(ALINE, avant)

    def test_restaurer_hors_depot_refuse(self):
        code, _, err = self.lancer(
            "restaurer", "aline-fictiva", "abc", "--depuis", str(DEMO / ALINE)
        )
        self.assertEqual(code, 2)
        self.assertIn("hors du dépôt", err)


class Rattacher(Saisie):
    RATTACHEMENTS = "quiz/rattachements.yaml"

    def test_rattacher_question_inconnue(self):
        avant = self.texte(self.RATTACHEMENTS), self.texte("journal.yaml")
        code, _, err = self.lancer(
            "rattacher", "inconnue-9", "bruno-demonstra", "x-a", "eco-impot"
        )
        self.assertEqual(code, 2)
        self.assertIn("question inconnue", err)
        self.assertEqual(
            (self.texte(self.RATTACHEMENTS), self.texte("journal.yaml")), avant
        )

    def test_rattacher_grille_gelee_remplace_et_journalise(self):
        code, out, err = self.lancer(
            "rattacher", "economie-1", "bruno-demonstra", "economie-1-a", "eco-impot"
        )
        self.assertEqual(code, 0, out + err)
        lignes = [
            r for r in self.lire(self.RATTACHEMENTS)["rattachements"]
            if r["question"] == "economie-1" and r["candidat"] == "bruno-demonstra"
        ]  # fmt: skip
        self.assertEqual(
            lignes,
            [
                {
                    "question": "economie-1",
                    "candidat": "bruno-demonstra",
                    "option": "economie-1-a",
                    "mesure_id": "eco-impot",
                }
            ],
        )
        self.assertEqual(self.journal()[-1]["objet"], "rattachement")
        self.assertEqual(self.journal()[-1]["cible"], "economie-1/bruno-demonstra")
        etat = tool.base_presidentielle.relire(self.dossier)
        self.assertEqual(etat.erreurs, [])
        self.assertIsNotNone(etat.grille)

    def test_rattacher_mesure_autre_theme_refusee(self):
        avant = self.texte(self.RATTACHEMENTS)
        code, _, err = self.lancer(
            "rattacher",
            "economie-1",
            "bruno-demonstra",
            "economie-1-a",
            "travail-retraite",
        )
        self.assertEqual(code, 2)
        self.assertIn("thème", err)
        self.assertInchange(self.RATTACHEMENTS, avant)

    def test_rattacher_mesure_hors_quiz_refusee(self):
        avant = self.texte(self.RATTACHEMENTS), self.texte("journal.yaml")
        code, _, err = self.lancer(
            "rattacher", "economie-1", "aline-fictiva", "economie-1-a", "culture-musees"
        )
        self.assertEqual(code, 2)
        self.assertIn("du thème culture, hors quiz : aucun rattachement", err)
        self.assertEqual(
            (self.texte(self.RATTACHEMENTS), self.texte("journal.yaml")), avant
        )


class QuizRelire(Saisie):
    def test_quiz_relire_deux_lectures_rien_ecrit(self):
        self.routeur.reponses.append(
            (200, {"kind": "ok", "lectures": [
                {"lecteur": "gauche", "texte": "Lecture A."},
                {"lecteur": "droite", "texte": "Lecture B."},
            ]})
        )  # fmt: skip
        avant = {p: p.read_bytes() for p in self.dossier.rglob("*") if p.is_file()}
        code, out, _ = self.lancer("quiz-relire", "economie-1")
        self.assertEqual(code, 0)
        self.assertLess(out.index("gauche"), out.index("droite"))
        self.assertIn("Lecture A.", out)
        self.assertIn("Lecture B.", out)
        corps = self.routeur.extractions[0]
        self.assertEqual(corps["type"], "relecture")
        self.assertEqual(
            corps["enonce"], "Comment faire évoluer l'impôt sur le revenu ?"
        )
        self.assertIn("Sans avis", corps["options"])
        apres = {p: p.read_bytes() for p in self.dossier.rglob("*") if p.is_file()}
        self.assertEqual(apres, avant)

    def test_quiz_relire_attend_fin_d_appel(self):
        self.routeur.reponses += [
            (409, {"kind": "attente", "retry_after": 30}),
            (200, {"kind": "ok", "lectures": []}),
        ]
        self.assertEqual(self.lancer("quiz-relire", "economie-1")[0], 0)
        self.assertEqual(self.attentes, [30])

    def test_quiz_relire_question_inconnue(self):
        code, _, err = self.lancer("quiz-relire", "inconnue-1")
        self.assertEqual(code, 2)
        self.assertEqual(self.routeur.appels, [])


class Calendrier(Saisie):
    def setUp(self):
        super().setUp()
        # Gaston est retiré : la liste officielle porte sur les trois autres
        self.etat = "etat-declarations"

    def officielle(self, *officiels: str, source: str = "etat-declarations"):
        return self.lancer(
            "liste-officielle", "--source", source, "--officiels", *officiels
        )

    def test_liste_officielle_refus(self):
        avant = self.texte("base.yaml")
        for args, attendu in (
            (("aline-fictiva",), "officiel_etat attendu"),
            (("inconnu-x",), "candidat inconnu"),
            (("gaston-fictorin",), "retiré"),
        ):
            with self.subTest(args=args):
                source = (
                    "aline-programme" if attendu.startswith("officiel") else self.etat
                )
                code, _, err = self.officielle(*args, source=source)
                self.assertEqual(code, 2)
                self.assertIn(attendu, err)
        self.assertInchange("base.yaml", avant)

    def test_liste_officielle_reussite(self):
        code, out, err = self.officielle("aline-fictiva", "bruno-demonstra")
        self.assertEqual(code, 0, out + err)
        base = self.lire("base.yaml")
        self.assertEqual(
            (base["liste"], base["liste_source"], base["phase"]),
            ("officielle", self.etat, "officiel"),
        )
        self.assertEqual(self.lire(ALINE)["statut"], "officiel")
        self.assertEqual(self.lire(ALINE)["version"], 2)
        self.assertEqual(
            self.lire("candidats/carla-exemplia.yaml")["statut"], "non_qualifie"
        )
        self.assertEqual(
            self.lire("candidats/gaston-fictorin.yaml")["statut"], "retire"
        )
        self.assertEqual(self.journal()[-1]["objet"], "base")
        self.assertIn("Vérification : 0 erreur(s)", out)
        self.assertIn("git -C", out)

    def test_phase_entre_tours_refus(self):
        self.assertEqual(self.officielle("aline-fictiva", "bruno-demonstra")[0], 0)
        avant = self.texte("base.yaml")
        for args, attendu in (
            (("aline-fictiva", "aline-fictiva", self.etat), "distincts"),
            (("aline-fictiva", "carla-exemplia", self.etat), "pas candidat officiel"),
            (("aline-fictiva", "inconnu-x", self.etat), "candidat inconnu"),
            (
                ("aline-fictiva", "bruno-demonstra", "bruno-programme"),
                "officiel_etat attendu",
            ),
        ):
            with self.subTest(args=args):
                a, b, source = args
                code, _, err = self.lancer(
                    "phase", "entre-tours", a, b, "--source", source
                )
                self.assertEqual(code, 2)
                self.assertIn(attendu, err)
        self.assertInchange("base.yaml", avant)
        # Un seul qualifié : refusé par l'analyseur
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            tool.main(["phase", "entre-tours", "aline-fictiva", "--source", self.etat])

    def test_phase_entre_tours_avant_liste_officielle_refusee(self):
        code, _, err = self.lancer(
            "phase",
            "entre-tours",
            "aline-fictiva",
            "bruno-demonstra",
            "--source",
            self.etat,
        )
        self.assertEqual(code, 2)
        self.assertIn("pas candidat officiel", err)

    def test_phase_entre_tours_reussite(self):
        self.assertEqual(self.officielle("aline-fictiva", "bruno-demonstra")[0], 0)
        code, out, err = self.lancer(
            "phase",
            "entre-tours",
            "aline-fictiva",
            "bruno-demonstra",
            "--source",
            self.etat,
        )
        self.assertEqual(code, 0, out + err)
        base = self.lire("base.yaml")
        self.assertEqual(base["phase"], "entre_tours")
        self.assertEqual(base["qualifies"], ["aline-fictiva", "bruno-demonstra"])
        self.assertEqual(self.journal()[-1]["cible"], "phase")
        self.assertIn("git -C", out)

    def test_phase_entre_tours_qualifies_par_ordre_alphabetique(self):
        # Neutralité : l'ordre tapé (souvent celui des résultats) n'est jamais écrit
        self.assertEqual(self.officielle("aline-fictiva", "bruno-demonstra")[0], 0)
        code, out, err = self.lancer(
            "phase",
            "entre-tours",
            "bruno-demonstra",
            "aline-fictiva",
            "--source",
            self.etat,
        )
        self.assertEqual(code, 0, out + err)
        self.assertEqual(
            self.lire("base.yaml")["qualifies"], ["aline-fictiva", "bruno-demonstra"]
        )
        motif = self.journal()[-1]["motif"]
        self.assertLess(motif.index("aline-fictiva"), motif.index("bruno-demonstra"))

    def surveillance(self, *args: str):
        return self.lancer("surveillance", *args)

    def test_surveillance_refus(self):
        url = "https://aline-fictiva.exemple.invalid/actus"
        for args, attendu in (
            (
                (
                    "ajouter",
                    "http://aline-fictiva.exemple.invalid/a",
                    "--candidat",
                    "aline-fictiva",
                ),
                "https",
            ),
            (("ajouter", url, "--candidat", "inconnu-x"), "candidat inconnu"),
            (
                ("ajouter", "https://exemple.fr/a", "--candidat", "aline-fictiva"),
                "exemple.invalid",
            ),
            (("ajouter", url), "--candidat"),
            (("retirer", url), "non suivie"),
            (("geler",), "aucune page"),
        ):
            with self.subTest(args=args):
                code, _, err = self.surveillance(*args)
                self.assertEqual(code, 2)
                self.assertIn(attendu, err)
        self.assertFalse((self.dossier / "surveillance.yaml").exists())

    def test_surveillance_ajouter_geler_retirer(self):
        url = "https://aline-fictiva.exemple.invalid/actus"
        code, out, err = self.surveillance(
            "ajouter", url, "--candidat", "aline-fictiva"
        )
        self.assertEqual(code, 0, out + err)
        self.assertEqual(
            self.surveillance("ajouter", url, "--candidat", "aline-fictiva")[0], 2
        )
        self.assertEqual(self.surveillance("geler")[0], 0)
        suivi = self.lire("surveillance.yaml")
        self.assertEqual(suivi["gelee_le"], AUJOURD_HUI)
        self.assertEqual(
            suivi["pages"],
            [{"url": url, "candidat": "aline-fictiva", "ajoutee_le": AUJOURD_HUI}],
        )
        self.assertIn("gelée", self.journal()[-1]["motif"])
        code, out, _ = self.surveillance("retirer", url)
        self.assertEqual(code, 0)
        self.assertIn("relancer « surveillance geler »", out)
        self.assertEqual(self.lire("surveillance.yaml"), {"pages": []})
        self.assertEqual(
            [e["cible"] for e in self.journal()[-3:]], ["surveillance"] * 3
        )
        self.assertIn("Vérification : 0 erreur(s)", out)
        schema.Surveillance.model_validate(self.lire("surveillance.yaml"))


class Archive(Saisie):
    """Lot 5 : base archivée (jour de Paris postérieur à archive_apres) : écritures
    refusées, sauf --correction <motif>, inscrit au journal."""

    LENDEMAIN = date(2027, 5, 3)

    def setUp(self):
        super().setUp()
        patch = mock.patch.object(tool, "aujourd_hui", lambda: self.LENDEMAIN)
        patch.start()
        self.addCleanup(patch.stop)
        self.brouillon = self.lire(ALINE)
        self.brouillon["description"]["texte"] = "Description corrigée après le vote."

    def ecrire(self) -> None:
        tool.ecrire_yaml(self.dossier / "brouillons/aline-fictiva.yaml", self.brouillon)

    def instantane(self) -> dict[str, str]:
        return {
            str(p.relative_to(self.dossier)): p.read_text(encoding="utf-8")
            for p in sorted(self.dossier.rglob("*.yaml"))
            if "brouillons" not in p.parts
        }

    def test_phase_archive_ecritures_refusees(self):
        self.ecrire()
        avant = self.instantane()
        for argv in (
            ("publier", "aline-fictiva"),
            ("rattacher", "economie-1", "bruno-demonstra", "economie-1-a", "eco-impot"),
            ("index",),
            ("liste-officielle", "--source", "etat-declarations", "--officiels", "aline-fictiva"),
            ("surveillance", "geler"),
            ("scrutins", "geler"),
        ):  # fmt: skip
            with self.subTest(argv=argv):
                code, _, err = self.lancer(*argv)
                self.assertEqual(code, 2)
                self.assertIn("base archivée", err)
                self.assertIn("--correction", err)
        self.assertEqual(self.instantane(), avant)
        self.assertEqual(self.routeur.appels, [])
        # Lectures permises
        self.assertEqual(self.lancer("etat")[0], 0)
        self.assertNotIn("base archivée", self.lancer("scrutins", "verifier")[2])
        # Motif vide : refusé aussi
        self.assertEqual(self.lancer("index", "--correction", " ")[0], 2)
        # Veille de l'archive (2 mai, heure de Paris) : écritures permises
        with mock.patch.object(tool, "aujourd_hui", lambda: date(2027, 5, 2)):
            code, out, err = self.lancer("index")
        self.assertEqual(code, 0, out + err)

    def test_phase_archive_correction_journalisee(self):
        self.ecrire()
        code, out, err = self.lancer(
            "publier", "aline-fictiva", "--correction", "Coquille dans la description"
        )
        self.assertEqual(code, 0, out + err)
        self.assertEqual(self.lire(ALINE)["version"], 2)
        fiche, correction = self.journal()[-2:]
        self.assertEqual((fiche["objet"], fiche["version"]), ("fiche", 2))
        self.assertEqual(
            correction,
            {
                "date": self.LENDEMAIN,
                "objet": "base",
                "cible": "correction",
                "motif": "Correction après archivage (publier) : "
                "Coquille dans la description",
            },
        )
        # Index demandé une fois, après le journal (version finale), avec le motif
        self.assertEqual(
            [a for a in self.routeur.appels if a[0] == tool.CHEMIN_INDEX],
            [(tool.CHEMIN_INDEX, {"correction": "Coquille dans la description"})],
        )
        # Motif trop long ou sur plusieurs lignes : refusé, rien n'est écrit
        avant = self.instantane()
        for motif in ("x" * 301, "ligne\nautre"):
            self.assertEqual(self.lancer("index", "--correction", motif)[0], 2)
        self.assertEqual(self.instantane(), avant)
        code, out, err = self.lancer(
            "rattacher", "economie-1", "bruno-demonstra", "economie-1-a", "eco-impot",
            "--correction", "Option mal reportée",
        )  # fmt: skip
        self.assertEqual(code, 0, out + err)
        self.assertEqual(
            self.journal()[-1]["motif"],
            "Correction après archivage (rattacher) : Option mal reportée",
        )
        self.assertEqual(tool.base_presidentielle.relire(self.dossier).erreurs, [])
        # Motif oublié une fois la commande finie : la suivante est refusée
        self.assertEqual(self.lancer("index")[0], 2)

    def test_correction_hors_archive_refusee(self):
        with mock.patch.object(tool, "aujourd_hui", lambda: AUJOURD_HUI):
            code, _, err = self.lancer("index", "--correction", "rien")
        self.assertEqual(code, 2)
        self.assertIn("réservé à une base archivée", err)
        self.assertNotIn("cible: correction", self.texte("journal.yaml"))


if __name__ == "__main__":
    unittest.main()
