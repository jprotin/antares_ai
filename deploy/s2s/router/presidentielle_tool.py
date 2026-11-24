"""Outil de saisie de la présidentielle, lancé par deploy/s2s/presidentielle.sh dans
l'image du routeur, sur le dépôt de données monté en écriture (/presidentielle-rw).

Le service, lui, lit la base en lecture seule ; seul cet outil écrit, et seulement
dans le dépôt de données réelles (jamais dans le jeu fictif d'antares_ai). Il ne
lance jamais git : il affiche la commande, l'utilisateur la lance.

python /app/presidentielle_tool.py <commande> …

Commandes :
- etat : résumé de la base et de ses erreurs ;
- source ajouter <candidat|-> <fichier> --niveau … --titre … --url … [--publie-le …]
  [--remplace <source_id>] : empreinte SHA-256, copie dans documents/<sha256><ext>
  (.original.txt pour un texte) et texte extrait dans documents/<sha256>.txt (pages
  séparées par un saut de page), hors git ; même texte dans textes/<sha256>.txt,
  versionné ; entrée de sources.yaml. --remplace : nouvelle version d'un document du
  même candidat (lignée du programme, cf. schema.controler_lignee) ; --lecture brute :
  PDF lu par pdftotext -raw (colonnes mêlées dans l'ordre de lecture) ;
- source lecture <source_id> <ordre|brute> : lecture d'un PDF inscrit changée, texte
  régénéré (documents/ et textes/), journalisée ; refus si une citation d'une fiche
  publiée ne s'y retrouve plus ;
- textes reconstruire : textes/<sha256>.txt recréés depuis documents/<sha256>.txt (le
  PDF original pour une source en lecture brute) pour les sources inscrites avant le
  versionnement des textes (rien n'est remplacé) ;
- extraire <candidat> <source_id> : brouillon brouillons/<candidat>.yaml, tranche par
  tranche, par la route POST /api/presidentielle/extraire du routeur en service (liste
  blanche du modèle, attente pendant un appel vocal) ; connections.json n'est jamais lu ;
- verifier [fichier] : schéma, citations mot pour mot (au besoin à cheval sur des sauts
  de page, cf. presidentielle_common.texte_de_controle), noms interdits, couverture et
  équilibre du quiz, gel de la grille (règle 6) ; code 1 si erreur ;
- publier <candidat> : brouillon vérifié -> candidats/, version + 1, journal, index ;
  copie figée de la version dans historique/<candidat>/v<N>.yaml (vue « Évolution »),
  comme pour restaurer et liste-officielle ;
- rattacher <question> <candidat> <option> <mesure> : quiz/rattachements.yaml ;
- restaurer <candidat> <revision> --depuis <fichier> : partie conteneur de la
  restauration (le fichier est tiré de git sur l'hôte par presidentielle.sh) ;
- quiz-relire <question> : deux lectures de la question (gauche, puis droite), rien
  n'est écrit ;
- liste-officielle, phase entre-tours, surveillance ajouter|retirer|geler : gestes du
  calendrier, vérifiés et journalisés ;
- scrutins verifier|geler : liste des scrutins retenus (quiz/scrutins.yaml), gelée et
  journalisée avec son empreinte avant tout import ;
- votes importer <candidat> --acteur PA… --archive <Scrutins.json.zip>… : votes du député
  sur les scrutins de la liste gelée, lus dans l'archive des données ouvertes de
  l'Assemblée (presidentielle_votes.py), écrits dans le brouillon ; sources de niveau
  vote_reel ajoutées à sources.yaml. Rien n'est écrit dans candidats/ ;
- index : reconstruction de l'index des passages par le routeur en service.

Base archivée (lot 5 : jour de Paris postérieur à `archive_apres`) : les commandes qui
écrivent dans la base publiée ou dans l'index (ECRITURES) sont refusées, sauf avec
`--correction "<motif>"` ; la correction est alors inscrite au journal (journal.yaml).
"""

import argparse
from html.parser import HTMLParser
import contextlib
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook
from pydantic import ValidationError

import documents
import presidentielle as base_presidentielle
import presidentielle_common as common
import presidentielle_evolution as evolution
import presidentielle_schema as schema
import presidentielle_votes as votes_an

# Code de l'image : le jeu fictif et les cas de test y vivent, jamais une cible
CODE = Path(__file__).resolve().parent
ROUTEUR = "http://llm-router:11434"
CHEMIN_EXTRAIRE = "/api/presidentielle/extraire"
CHEMIN_INDEX = "/api/presidentielle/index"
# Tranche d'environ 8 000 jetons, sous le contexte de 32 768 jetons d'Ollama
TRANCHE_JETONS = 8_000
CONTEXTE_JETONS = 32_768
SAUT_DE_PAGE = "\f"
# Textes versionnés des documents (textes/<sha256>.txt) et copies figées des fiches
TEXTES = "textes"
# Seuil du contrôle check-added-large-files du dépôt de données (--maxkb=1024)
TEXTE_GROS = 1024 * 1024
# Délai d'une requête : deux générations de 300 s au plus (relecture)
DELAI_HTTP = 700
# Thèmes proposés au modèle tant que la grille n'existe pas (ceux du jeu fictif et les
# thèmes hors quiz) : les mesures sont vérifiées contre la vraie grille, plus les thèmes
# hors quiz (ADR 0016), dès qu'elle est écrite
# Mêmes thèmes que ceux servis sans grille par le routeur (presidentielle.py)
THEMES_REFERENCE = tuple(base_presidentielle.THEMES_REFERENCE)
THEME_A_CLASSER = "a-classer"
A_COMPLETER = "a-completer"
RESUME_MAX = 300
# Citation trop courte pour qu'un contrôle mot pour mot prouve quoi que ce soit
# (« nous », « la retraite ») : à vérifier à l'extraction, signalée par verifier
CITATION_MIN_MOTS = 4
CITATION_MIN_CARACTERES = 20


def citation_courte(citation: str) -> bool:
    texte = common.normaliser(citation)
    return (
        len(texte.split()) < CITATION_MIN_MOTS or len(texte) < CITATION_MIN_CARACTERES
    )


class Refus(Exception):
    """Faute de l'utilisateur : message clair, code de sortie 2, rien n'est écrit."""


def aujourd_hui() -> date:
    """Jour calendaire à Paris (le conteneur vit en UTC)."""
    return base_presidentielle.jour_paris()


# Commandes qui écrivent dans la base publiée ou dans l'index : refusées sur une base
# archivée, sauf --correction (scrutins verifier, lecture seule, reste permis)
ECRITURES = (
    "source",
    "publier",
    "restaurer",
    "rattacher",
    "index",
    "liste-officielle",
    "phase",
    "surveillance",
    "scrutins",
    "votes",
)
# Motif de la correction en cours (base archivée), transmis au routeur par l'index
correction_en_cours: str | None = None
# Longueur maximale d'un motif de correction (même borne que POST /index)
MOTIF_MAX = 300


# Attente entre deux essais pendant un appel vocal (remplacée par les tests)
attendre: Callable[[float], None] = time.sleep


def racine() -> Path:
    """Dossier du dépôt de données (PRESIDENTIELLE_DIR), refusé s'il est vide, absent,
    ou s'il désigne le code d'antares_ai (dont le jeu fictif)."""
    valeur = os.environ.get("PRESIDENTIELLE_DIR", "").strip()
    if not valeur:
        raise Refus("PRESIDENTIELLE_DIR vide : lancer l'outil par presidentielle.sh")
    dossier = Path(valeur).resolve()
    if not dossier.is_dir():
        raise Refus(f"dossier de données introuvable : {dossier}")
    if dossier == CODE or CODE in dossier.parents:
        raise Refus(
            "le dossier désigne le code d'antares_ai (jeu fictif compris) : "
            "seul le dépôt de données réelles est modifiable"
        )
    if not (dossier / "base.yaml").is_file():
        raise Refus(f"base.yaml absent de {dossier} : ce n'est pas un dépôt de données")
    return dossier


class _SansRenvoi(yaml.SafeDumper):
    """Pas d'ancre ni de renvoi (&id001, *id001) quand deux valeurs sont le même objet,
    une date par exemple : le fichier reste lisible et relu à la main."""

    def ignore_aliases(self, data: Any) -> bool:
        return True


def ecrire_yaml(path: Path, data: Any, entete: str | None = None) -> None:
    """Écrit un YAML conforme aux contrôles du dépôt (--- en tête, accents gardés),
    de façon atomique : le fichier n'est jamais laissé à moitié écrit."""
    texte = yaml.dump(
        data,
        Dumper=_SansRenvoi,
        explicit_start=True,
        sort_keys=False,
        allow_unicode=True,
        width=120,
    )
    if entete:
        commentaire = "".join(f"# {ligne}\n" for ligne in entete.splitlines())
        texte = texte.replace("---\n", "---\n" + commentaire, 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fichier:
            fichier.write(texte)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def entete_de(path: Path) -> str | None:
    """Commentaire d'en-tête d'un YAML (lignes « # » juste après « --- »), à garder
    quand l'outil réécrit le fichier."""
    if not path.is_file():
        return None
    lignes = path.read_text(encoding="utf-8").splitlines()
    if lignes and lignes[0].strip() == "---":
        lignes = lignes[1:]
    entete = []
    for ligne in lignes:
        if not ligne.startswith("#"):
            break
        entete.append(ligne[1:].removeprefix(" "))
    return "\n".join(entete) or None


def reecrire(path: Path, data: Any) -> None:
    ecrire_yaml(path, data, entete=entete_de(path))


def commande_git(message: str, fichiers: list[str]) -> str:
    """Commande à lancer par l'utilisateur sur l'hôte (jamais lancée par l'outil)."""
    noms = " ".join(shlex.quote(f) for f in fichiers)
    return (
        f'git -C "$PRESIDENTIELLE_DATA" add {noms} && '
        f'git -C "$PRESIDENTIELLE_DATA" commit -m {shlex.quote(message)}'
    )


def afficher_git(message: str, fichiers: list[str]) -> None:
    print("À enregistrer, après relecture du diff (l'outil ne lance pas git) :")
    print(f"  {commande_git(message, fichiers)}")


# --- Lecture du dépôt ---------------------------------------------------------------


def identifiant(valeur: str, quoi: str) -> str:
    if not re.fullmatch(schema.IDENTIFIANT, valeur):
        raise Refus(f"{quoi} invalide : « {valeur} » (minuscules, chiffres et tirets)")
    return valeur


def dans_le_depot(dossier: Path, chemin: str) -> Path:
    """Chemin donné à l'outil, relatif au dépôt ou absolu, qui doit y rester."""
    path = Path(chemin)
    path = (path if path.is_absolute() else dossier / path).resolve()
    if not path.is_relative_to(dossier):
        raise Refus(f"{chemin} : fichier hors du dépôt de données")
    if not path.is_file():
        raise Refus(f"fichier introuvable : {chemin}")
    return path


def lire_dict(path: Path, nom: str) -> dict:
    try:
        data = schema.lire_yaml(path, nom)
    except schema.ErreurFichier as exc:
        raise Refus(str(exc)) from None
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise Refus(f"{nom} : dictionnaire YAML attendu")
    return data


def etat_valide(dossier: Path) -> base_presidentielle.Etat:
    """État relu sans cache ; Refus si base.yaml n'est pas servi."""
    etat = base_presidentielle.relire(dossier)
    if etat.base is None:
        raise Refus(etat.message or "base.yaml en défaut")
    return etat


def themes_connus(dossier: Path, etat: base_presidentielle.Etat) -> set[str] | None:
    """Thèmes admis pour les mesures : ceux de la grille (même en défaut, s'ils sont
    lisibles) et les thèmes hors quiz (ADR 0016) ; None sans grille."""
    if etat.grille is not None:
        return schema.themes_admis(t.id for t in etat.grille.themes)
    path = dossier / "quiz" / "grille.yaml"
    if not path.is_file():
        return None
    try:
        return schema.themes_admis(
            schema.themes_bruts(schema.lire_yaml(path, "quiz/grille.yaml"))
        )
    except schema.ErreurFichier:
        return None


class Journal:
    """Journal préparé avant toute écriture : lu et contrôlé à l'ouverture, lignes
    validées à l'ajout (Refus, rien n'est écrit), écrit en dernier par `ecrire()`."""

    def __init__(self, dossier: Path):
        self.path = dossier / "journal.yaml"
        self.data = lire_dict(self.path, "journal.yaml") if self.path.is_file() else {}
        entrees = self.data.get("entrees")
        if entrees is None:
            entrees = []
        if not isinstance(entrees, list):
            raise Refus("journal.yaml : liste « entrees » attendue (rien n'est écrit)")
        self.data["entrees"] = entrees

    def ajouter(self, entree: dict) -> None:
        entree = {k: v for k, v in entree.items() if v is not None}
        try:
            schema.EntreeJournal.model_validate(entree)
        except ValidationError as exc:
            raise Refus(f"ligne de journal refusée : {schema._message(exc)}") from None
        self.data["entrees"].append(entree)

    def ecrire(self) -> None:
        reecrire(self.path, self.data)


def version_publiee(dossier: Path, slug: str) -> int:
    """Version du fichier publié (même en défaut), 0 s'il n'existe pas."""
    path = dossier / schema.fichier_fiche(slug)
    if not path.is_file():
        return 0
    try:
        data = schema.lire_yaml(path, schema.fichier_fiche(slug))
    except schema.ErreurFichier:
        return 0
    version = data.get("version") if isinstance(data, dict) else None
    return version if isinstance(version, int) and version > 0 else 0


# --- Échanges avec le routeur ---------------------------------------------------------


def appeler(chemin: str, corps: dict) -> tuple[int, dict]:
    """POST JSON au routeur en service, avec l'en-tête maison (garde des écritures) et
    sans Origin ; OSError si le routeur est injoignable."""
    base = os.environ.get("PRESIDENTIELLE_ROUTEUR", ROUTEUR).rstrip("/")
    requete = urllib.request.Request(
        base + chemin,
        data=json.dumps(corps).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "X-Antares": "1"},
    )
    ouvreur = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with ouvreur.open(requete, timeout=DELAI_HTTP) as reponse:
            return reponse.status, _json(reponse.read())
    except urllib.error.HTTPError as exc:
        return exc.code, _json(exc.read())


def _json(data: bytes) -> dict:
    try:
        value = json.loads(data.decode("utf-8", errors="replace"))
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def demander(corps: dict) -> dict:
    """Envoie une demande d'extraction ; pendant un appel vocal (409 attente), attend
    puis renvoie la même demande."""
    while True:
        try:
            statut, reponse = appeler(CHEMIN_EXTRAIRE, corps)
        except OSError as exc:
            raise Refus(
                f"routeur injoignable ({exc.__class__.__name__}) : le service "
                "llm-router doit tourner"
            ) from None
        if statut == 409 and reponse.get("kind") == "attente":
            delai = reponse.get("retry_after")
            delai = delai if isinstance(delai, (int, float)) and delai > 0 else 30
            print(f"Appel vocal en cours : nouvel essai dans {delai:g} s")
            attendre(delai)
            continue
        if statut == 200 and reponse.get("kind") == "ok":
            return reponse
        detail = reponse.get("detail") or "réponse inattendue"
        raise Refus(f"routeur : {statut} {detail}")


def corps_index() -> dict:
    """Corps de POST /index : le motif d'une correction sur une base archivée."""
    return {"correction": correction_en_cours} if correction_en_cours else {}


def demander_index(final: bool = False) -> None:
    """Demande la reconstruction de l'index ; simple avertissement en cas d'échec.
    Pendant une correction, la demande attend l'inscription au journal (`final`), qui
    change la version de la base : sinon l'index serait aussitôt périmé."""
    if correction_en_cours and not final:
        return
    try:
        statut, _ = appeler(CHEMIN_INDEX, corps_index())
    except OSError:
        statut = 0
    if statut in (200, 202):
        print("Index des passages : reconstruction demandée")
        return
    print(
        "AVERTISSEMENT : index des passages non reconstruit "
        f"({'routeur injoignable' if not statut else f'code {statut}'}) ; "
        "le routeur le reconstruira de lui-même"
    )


# --- Rapport de vérification ----------------------------------------------------------


@dataclass
class Rapport:
    erreurs: list[str] = field(default_factory=list)
    avertissements: list[str] = field(default_factory=list)
    infos: list[str] = field(default_factory=list)

    def afficher(self) -> int:
        for info in self.infos:
            print(info)
        for message in self.avertissements:
            print(f"AVERTISSEMENT : {message}")
        for message in self.erreurs:
            print(f"ERREUR : {message}")
        print(
            f"Vérification : {len(self.erreurs)} erreur(s), "
            f"{len(self.avertissements)} avertissement(s)"
        )
        return 1 if self.erreurs else 0


def texte_source(dossier: Path, source: schema.Source) -> list[str] | None:
    """Pages du texte d'une source : textes/<sha256>.txt (versionné, texte de référence,
    le même que lit la vue « Évolution »), sinon documents/<sha256>.txt (poste de
    saisie, hors git : peut dater d'une autre lecture, cf. source lecture) ; None si
    absent."""
    if not source.sha256:
        return None
    for path in (
        dossier / TEXTES / f"{source.sha256}.txt",
        dossier / "documents" / f"{source.sha256}.txt",
    ):
        if path.is_file():
            return path.read_text(encoding="utf-8").split(SAUT_DE_PAGE)
    return None


def controler_citations(
    dossier: Path,
    nom: str,
    mesures: list[schema.Mesure],
    sources: dict[str, schema.Source],
    rapport: Rapport,
) -> None:
    """Chaque citation figure mot pour mot (après normaliser) dans le texte de sa
    source, au besoin à cheval sur des sauts de page ; texte absent (autre poste, machine cloud) : avertissement seulement."""
    textes: dict[str, common.TexteControle | None] = {}
    sans_texte: list[str] = []
    for mesure in mesures:
        source = sources.get(mesure.source_id)
        if source is None:
            continue
        if source.id not in textes:
            pages = texte_source(dossier, source)
            textes[source.id] = (
                None if pages is None else common.texte_de_controle(pages)
            )
        controle = textes[source.id]
        if controle is None:
            if source.id not in sans_texte:
                sans_texte.append(source.id)
            continue
        if citation_courte(mesure.citation):
            rapport.avertissements.append(
                f"{nom} : mesure {mesure.id} : citation très courte, le contrôle mot "
                "pour mot ne prouve rien : relire la source"
            )
        # Page de la mesure : celle où la citation commence (elle peut chevaucher un
        # ou plusieurs sauts de page, cf. common.texte_de_controle)
        trouvees = common.pages_de_citation(controle, mesure.citation)
        if trouvees:
            if mesure.page and mesure.page not in trouvees:
                rapport.avertissements.append(
                    f"{nom} : mesure {mesure.id} : citation trouvée, mais pas à la "
                    f"page {mesure.page}"
                )
            continue
        rapport.erreurs.append(
            f"{nom} : mesure {mesure.id} : citation introuvable mot pour mot dans "
            f"la source {source.id}"
        )
    for source_id in sans_texte:
        rapport.avertissements.append(
            f"{nom} : texte de la source {source_id} absent (documents/, textes/) : "
            "contrôle mot pour mot non fait"
        )


def controler_noms(
    etat: base_presidentielle.Etat, fiche: schema.Fiche, nom: str, rapport: Rapport
) -> None:
    """Le nom, les alias et les initiales de la fiche n'apparaissent pas dans la grille."""
    if etat.grille is None or etat.base is None:
        return
    autres = [schema.identite(f) for s, f in etat.fiches.items() if s != fiche.id]
    journal = schema.Journal(entrees=etat.journal)
    for probleme in schema.controler_grille(
        etat.grille, [*autres, schema.identite(fiche)], etat.base.partis, journal
    ):
        if "nom de candidat ou de parti interdit" in probleme:
            rapport.erreurs.append(f"quiz/grille.yaml ({nom}) : {probleme}")


def controler_surveillance(
    dossier: Path, etat: base_presidentielle.Etat, rapport: Rapport
) -> None:
    path = dossier / "surveillance.yaml"
    if not path.is_file():
        return
    try:
        suivi = schema.charger(schema.Surveillance, path, "surveillance.yaml")
    except schema.ErreurFichier as exc:
        rapport.erreurs.append(str(exc))
        return
    for page in suivi.pages:
        if page.candidat not in etat.fiches:
            rapport.erreurs.append(
                f"surveillance.yaml : {page.url} : candidat « {page.candidat} » inconnu"
            )
        if (
            etat.base
            and etat.base.jeu == "demonstration"
            and not schema.domaine_fictif(page.url)
        ):
            rapport.erreurs.append(
                f"surveillance.yaml : {page.url} : jeu demonstration, adresse hors "
                f"{schema.DOMAINE_FICTIF}"
            )


def equilibre(etat: base_presidentielle.Etat, rapport: Rapport) -> None:
    """Couverture des questions et options rattachées par candidat (information)."""
    grille = etat.grille
    if grille is None:
        return
    questions = [q.id for t in grille.themes for q in t.questions]
    eligibles = [
        q for q in questions if base_presidentielle.couverture(etat, q)["eligible"]
    ]
    rapport.infos.append(
        f"Couverture du quiz : {len(eligibles)} question(s) sur {len(questions)} "
        + (
            "couverte(s) (un qualifié sur 2)"
            if base_presidentielle.entre_tours(etat)
            else "couverte(s) (moitié des participants et 2 options occupées)"
        )
    )
    for slug in base_presidentielle.participants(etat):
        nombre = sum(1 for r in etat.rattachements if r.candidat == slug)
        rapport.infos.append(
            f"Équilibre : {slug} : {nombre} question(s) rattachée(s) sur "
            f"{len(questions)}"
        )


def controler_evolution(
    dossier: Path, etat: base_presidentielle.Etat, rapport: Rapport
) -> None:
    """Copies figées illisibles (historique/) et textes non versionnés (textes/) :
    avertissements, la vue « Évolution » les ignore."""
    for slug in sorted(etat.fiches):
        _, erreurs = evolution.versions_figees(dossier, slug)
        rapport.avertissements.extend(erreurs)
    a_versionner = [
        s.id
        for s in etat.sources.values()
        if s.sha256
        and not (dossier / TEXTES / f"{s.sha256}.txt").is_file()
        and (dossier / "documents" / f"{s.sha256}.txt").is_file()
    ]
    if a_versionner:
        rapport.avertissements.append(
            f"texte non versionné dans textes/ : {', '.join(sorted(a_versionner))} "
            "(lancer « textes reconstruire »)"
        )


def verifier_base(dossier: Path) -> Rapport:
    rapport = Rapport()
    etat = base_presidentielle.relire(dossier)
    if etat.base is None:
        rapport.erreurs.append(etat.message or "base.yaml en défaut")
    for erreur in etat.erreurs:
        message = f"{erreur.fichier} : {erreur.message}"
        if erreur.message == base_presidentielle.GRILLE_ABSENTE:
            rapport.avertissements.append(message)
        else:
            rapport.erreurs.append(message)
    for slug, fiche in sorted(etat.fiches.items()):
        controler_citations(
            dossier, schema.fichier_fiche(slug), fiche.mesures, etat.sources, rapport
        )
    controler_surveillance(dossier, etat, rapport)
    controler_scrutins(dossier, etat, rapport)
    controler_evolution(dossier, etat, rapport)
    equilibre(etat, rapport)
    rapport.infos.insert(
        0,
        f"Base : {len(etat.fiches)} fiche(s) publiée(s), {len(etat.sources)} "
        f"source(s), version {etat.version or '-'}",
    )
    return rapport


def fiche_du_fichier(data: dict, nom: str, slug: str) -> schema.Fiche:
    try:
        fiche = schema.valider(schema.Fiche, data, nom)
    except schema.ErreurFichier as exc:
        raise Refus(str(exc)) from None
    if fiche.id != slug:
        raise Refus(f"{nom} : identifiant « {fiche.id} » différent de « {slug} »")
    return fiche


def controler_fiche_complete(
    dossier: Path,
    etat: base_presidentielle.Etat,
    fiche: schema.Fiche,
    nom: str,
    rapport: Rapport,
) -> None:
    """Contrôles d'une fiche avant publication : mesures à vérifier, sources et niveaux,
    thèmes, citations mot pour mot, noms interdits dans la grille."""
    douteuses = [m.id for m in fiche.mesures if m.a_verifier]
    if douteuses:
        rapport.erreurs.append(
            f"{nom} : mesures a_verifier : {', '.join(douteuses)} (relire, corriger, "
            "puis passer a_verifier à false)"
        )
    themes = themes_connus(dossier, etat)
    for probleme in schema.controler_fiche(fiche, etat.base, etat.sources, themes):
        rapport.erreurs.append(f"{nom} : {probleme}")
    if themes is None and fiche.mesures:
        rapport.avertissements.append(
            f"quiz/grille.yaml : {base_presidentielle.GRILLE_ABSENTE}"
        )
    controler_citations(dossier, nom, fiche.mesures, etat.sources, rapport)
    controler_noms(etat, fiche, nom, rapport)


def cmd_verifier(args: argparse.Namespace) -> int:
    dossier = racine()
    if not args.fichier:
        return verifier_base(dossier).afficher()
    path = dans_le_depot(dossier, args.fichier)
    nom = str(path.relative_to(dossier))
    data = lire_dict(path, nom)
    extraction = data.pop("extraction", None)
    rapport = Rapport()
    etat = etat_valide(dossier)
    try:
        fiche = fiche_du_fichier(data, nom, path.stem)
    except Refus as exc:
        rapport.erreurs.append(str(exc))
        return rapport.afficher()
    controler_fiche_complete(dossier, etat, fiche, nom, rapport)
    for passage in extraction or []:
        if isinstance(passage, dict) and passage.get("pages_non_couvertes"):
            rapport.infos.append(
                f"Extraction de {passage.get('source_id')} : pages sans mesure "
                f"{passage['pages_non_couvertes']} (à relire)"
            )
    return rapport.afficher()


# --- source ajouter -------------------------------------------------------------------


class _TexteVisible(HTMLParser):
    """Texte lisible d'une page web : titre, résumé (meta description, og:description)
    puis texte visible, sans script, style ni modèle ; un bloc par ligne."""

    IGNORES = frozenset({"script", "style", "noscript", "template", "svg", "head"})
    BLOCS = frozenset(
        {
            "p",
            "div",
            "br",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "section",
            "article",
            "header",
            "footer",
            "tr",
            "blockquote",
            "pre",
            "ul",
            "ol",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.titre: list[str] = []
        self.resumes: list[str] = []
        self.morceaux: list[str] = []
        self._ignore = 0
        self._dans_titre = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._dans_titre = True
        elif tag == "meta":
            champs = dict(attrs)
            nom = (champs.get("name") or champs.get("property") or "").lower()
            contenu = (champs.get("content") or "").strip()
            if nom in ("description", "og:description", "og:title") and contenu:
                if contenu not in self.resumes:
                    self.resumes.append(contenu)
        if tag in self.IGNORES:
            self._ignore += 1
        elif tag in self.BLOCS:
            self.morceaux.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "meta":
            self.handle_starttag(tag, attrs)
        elif tag in self.BLOCS:
            self.morceaux.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._dans_titre = False
        if tag in self.IGNORES and self._ignore:
            self._ignore -= 1
        elif tag in self.BLOCS:
            self.morceaux.append("\n")

    def handle_data(self, data: str) -> None:
        if self._dans_titre:
            self.titre.append(data)
        elif not self._ignore:
            self.morceaux.append(data)


def texte_de_page_web(html: str) -> str:
    """Texte d'une page HTML enregistrée (déclaration, page de programme) : le code de la
    page n'est ni une citation possible ni un texte à comparer entre deux versions."""
    lecteur = _TexteVisible()
    lecteur.feed(html)
    lecteur.close()
    lignes = [" ".join("".join(lecteur.titre).split())]
    lignes += [" ".join(r.split()) for r in lecteur.resumes]
    lignes += [
        " ".join(ligne.split()) for ligne in "".join(lecteur.morceaux).splitlines()
    ]
    vues: set[str] = set()
    propres = []
    for ligne in lignes:
        if ligne and ligne not in vues:
            vues.add(ligne)
            propres.append(ligne)
    return "\n".join(propres)


def texte_pdf_en_lecture(data: bytes, lecture: str = "ordre") -> str:
    """Texte d'un PDF pour les citations. Lecture `ordre` (défaut) : ordre de lecture
    (pdftotext sans -layout), une page en deux colonnes est lue colonne par colonne, et
    non ligne à ligne à travers les colonnes, ce qui rend chaque phrase citable mot pour
    mot. Lecture `brute` (pdftotext -raw) : ordre du flux du PDF, pour un document dont
    les colonnes restent mêlées dans l'ordre de lecture (champ `lecture` de la source).
    documents._pdf_text (RAG) garde -layout, utile aux tableaux."""
    if lecture not in schema.LECTURES:
        raise Refus(f"lecture inconnue : {lecture} ({', '.join(schema.LECTURES)})")
    options = ["-raw"] if lecture == "brute" else []
    with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
        pdf.write(data)
        pdf.flush()
        try:
            result = subprocess.run(
                ["pdftotext", *options, "-enc", "UTF-8", pdf.name, "-"],
                capture_output=True,
                timeout=120,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise Refus("PDF illisible : pdftotext indisponible ou trop long") from None
    if result.returncode != 0:
        raise Refus("PDF illisible (fichier endommagé ou protégé)")
    return result.stdout.decode("utf-8", errors="replace")


def pages_du_document(nom: str, data: bytes, lecture: str = "ordre") -> list[str]:
    """Texte du document, page par page (sauts de page du PDF ou du texte) ; `lecture`
    (ordre, brute) ne vaut que pour un PDF."""
    try:
        extrait = documents.extract(nom, data, max_tokens=None)
    except documents.DocumentError as exc:
        raise Refus(f"{nom} : {exc}") from None
    if extrait["kind"] == "image":
        raise Refus(f"{nom} : une image n'est pas une source (texte attendu)")
    if lecture != "ordre" and extrait["kind"] != "pdf":
        raise Refus(f"{nom} : lecture {lecture} réservée à un PDF (rien n'est écrit)")
    if extrait["kind"] == "pdf":
        brut = texte_pdf_en_lecture(data, lecture)
    elif extrait["kind"] == "texte" and Path(nom).suffix.lower() in (".html", ".htm"):
        brut = texte_de_page_web(documents._decode(data))
    elif extrait["kind"] == "texte":
        brut = documents._decode(data)
    else:
        brut = extrait["text"]
    pages = [documents._clean(page) for page in brut.split(SAUT_DE_PAGE)]
    while pages and not pages[-1]:
        pages.pop()
    return pages or [extrait["text"]]


def cmd_source(args: argparse.Namespace) -> int:
    if args.action == "lecture":
        return cmd_source_lecture(args)
    return cmd_source_ajouter(args)


def cmd_source_ajouter(args: argparse.Namespace) -> int:
    dossier = racine()
    base = etat_valide(dossier).base
    candidat = None if args.candidat == "-" else identifiant(args.candidat, "candidat")
    path = Path(args.fichier)
    if not path.is_file():
        raise Refus(f"fichier introuvable : {args.fichier}")
    taille = path.stat().st_size
    if taille > documents.MAX_UPLOAD_BYTES:
        raise Refus(
            f"{path.name} : fichier trop volumineux ({taille} octets, 15 Mo au maximum)"
        )
    data = path.read_bytes()
    empreinte = hashlib.sha256(data).hexdigest()
    sources_path = dossier / "sources.yaml"
    contenu = lire_dict(sources_path, "sources.yaml") if sources_path.is_file() else {}
    entrees = contenu.get("sources") or []
    if not isinstance(entrees, list):
        raise Refus("sources.yaml : liste « sources » attendue")
    deja = next(
        (e for e in entrees if isinstance(e, dict) and e.get("sha256") == empreinte),
        None,
    )
    lecture = args.lecture or "ordre"
    if deja is not None:
        if args.remplace and deja.get("remplace") != args.remplace:
            raise Refus(
                f"document déjà inscrit sous l'identifiant {deja.get('id')} : sa lignée "
                "ne se change pas par « source ajouter » (rien n'est écrit)"
            )
        inscrite = deja.get("lecture") or "ordre"
        if args.lecture and args.lecture != inscrite:
            raise Refus(
                f"document déjà inscrit sous l'identifiant {deja.get('id')} en lecture "
                f"{inscrite} : « source lecture {deja.get('id')} {args.lecture} » la "
                "change (rien n'est écrit)"
            )
        lecture = inscrite
    pages = pages_du_document(path.name, data, lecture)
    suffixe = Path(path.name.lower()).suffix or ".txt"
    if deja is not None:
        nouveau_texte = _ranger(dossier, empreinte, suffixe, data, pages)
        print(
            f"Document déjà inscrit sous l'identifiant {deja.get('id')} : rien à ajouter"
        )
        if nouveau_texte:
            afficher_git(f"Texte de la source {deja.get('id')}", [nouveau_texte])
        return 0
    source_id = args.id or f"{candidat or 'etat'}-{empreinte[:8]}"
    entree = {
        "id": source_id,
        "titre": args.titre,
        "url": args.url,
        "niveau": args.niveau,
        "publie_le": args.publie_le,
        "consulte_le": aujourd_hui(),
        "sha256": empreinte,
        "candidat": candidat,
        "remplace": args.remplace,
        # Défaut (ordre) non écrit
        "lecture": None if lecture == "ordre" else lecture,
    }
    entree = {k: v for k, v in entree.items() if v is not None}
    try:
        source = schema.Source.model_validate(entree)
    except ValidationError as exc:
        raise Refus(f"source refusée : {schema._message(exc)}") from None
    if any(isinstance(e, dict) and e.get("id") == source.id for e in entrees):
        raise Refus(f"identifiant de source déjà pris : {source.id} (choisir --id)")
    refusee = schema.controler_sources(base, [source])
    if refusee:
        raise Refus(refusee[0][1])
    if source.remplace:
        controler_remplace(entrees, source)
    texte = _ranger(dossier, empreinte, suffixe, data, pages)
    entrees.append(entree)
    contenu["sources"] = entrees
    reecrire(sources_path, contenu)
    jetons = documents.estimate_tokens("\n".join(pages))
    print(
        f"Source {source.id} ajoutée : {len(pages)} page(s), environ {jetons} jetons, "
        f"empreinte {empreinte}"
    )
    if source.remplace:
        print(f"Nouvelle version du document {source.remplace} (lignée du programme)")
    print(f"Document rangé dans documents/{empreinte}.* (hors git)")
    print(f"Texte versionné : {evolution.chemin_texte(empreinte)}")
    afficher_git(f"Source {source.id}", ["sources.yaml"] + ([texte] if texte else []))
    return 0


LECTURE_MOTIF = {
    "ordre": "pdftotext, ordre de lecture",
    "brute": "pdftotext -raw, ordre du flux du PDF : colonnes mêlées dans l'ordre de lecture",
}


def citations_perdues(
    mesures: list[tuple[str, str, str]], controle: common.TexteControle
) -> list[str]:
    """« <fichier> : mesure <id> » de chaque citation (fichier, id, citation)
    introuvable dans le texte `controle`."""
    return [
        f"{nom} : mesure {mesure_id}"
        for nom, mesure_id, citation in mesures
        if not common.pages_de_citation(controle, citation)
    ]


def mesures_citant(
    dossier: Path, rel: str, source_id: str
) -> list[tuple[str, str, str]]:
    """(fichier, id, citation) des mesures des fiches de `rel` (candidats, brouillons)
    qui citent la source, fiches en défaut comprises."""
    trouvees = []
    for path in sorted((dossier / rel).glob("*.yaml")):
        try:
            data = schema.lire_yaml(path, f"{rel}/{path.name}")
        except schema.ErreurFichier:
            continue
        mesures = data.get("mesures") if isinstance(data, dict) else None
        for mesure in mesures if isinstance(mesures, list) else []:
            if (
                isinstance(mesure, dict)
                and mesure.get("source_id") == source_id
                and isinstance(mesure.get("citation"), str)
            ):
                trouvees.append(
                    (f"{rel}/{path.name}", str(mesure.get("id")), mesure["citation"])
                )
    return trouvees


def cmd_source_lecture(args: argparse.Namespace) -> int:
    """source lecture <source_id> <ordre|brute> : texte du PDF régénéré dans documents/
    et textes/ avec l'autre lecture, sources.yaml et journal ; refus si une citation
    d'une fiche publiée ne se retrouve plus dans le nouveau texte."""
    dossier = racine()
    etat = etat_valide(dossier)
    source_id = identifiant(args.source_id, "source")
    source = etat.sources.get(source_id)
    if source is None:
        raise Refus(f"source inconnue ou en défaut dans sources.yaml : {source_id}")
    if source.lecture == args.lecture:
        print(f"Source {source.id} déjà en lecture {args.lecture} : rien à faire")
        return 0
    if not source.sha256:
        raise Refus(f"source {source.id} sans empreinte : aucun document à relire")
    original = original_du_document(dossier, source)
    if original is None:
        raise Refus(
            f"document original de la source {source.id} absent de documents/ "
            f"({source.sha256}.*) : le reprendre par « source ajouter » (rien n'est "
            "écrit)"
        )
    pages = pages_du_document(original.name, original.read_bytes(), args.lecture)
    controle = common.texte_de_controle(pages)
    publiees = mesures_citant(dossier, "candidats", source.id)
    perdues = citations_perdues(publiees, controle)
    if perdues:
        raise Refus(
            f"lecture {args.lecture} refusée : citations de fiches publiées "
            f"introuvables dans le nouveau texte de {source.id} (rien n'est écrit) : "
            + " ; ".join(perdues)
        )
    sources_path = dossier / "sources.yaml"
    contenu = lire_dict(sources_path, "sources.yaml")
    entrees = contenu.get("sources")
    entree = next(
        (
            e
            for e in (entrees if isinstance(entrees, list) else [])
            if isinstance(e, dict) and e.get("id") == source.id
        ),
        None,
    )
    if entree is None:
        raise Refus(f"sources.yaml : entrée {source.id} introuvable (rien n'est écrit)")
    if args.lecture == "ordre":
        entree.pop("lecture", None)
    else:
        entree["lecture"] = args.lecture
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd_hui(),
            "objet": "base",
            "cible": "sources",
            "motif": (
                f"Source {source.id} en lecture {args.lecture} "
                f"({LECTURE_MOTIF[args.lecture]}) : texte régénéré"
            ),
        }
    )
    texte = SAUT_DE_PAGE.join(pages)
    _ecrire_octets(
        dossier / "documents" / f"{source.sha256}.txt", texte.encode("utf-8")
    )
    rel = ecrire_texte_versionne(dossier, source.sha256, texte, remplacer=True)
    reecrire(sources_path, contenu)
    journal.ecrire()
    print(
        f"Source {source.id} en lecture {args.lecture} : {len(pages)} page(s), texte "
        f"régénéré (documents/{source.sha256}.txt, {rel})"
    )
    for perdue in citations_perdues(
        mesures_citant(dossier, "brouillons", source.id), controle
    ):
        print(f"AVERTISSEMENT : {perdue} : citation introuvable dans le nouveau texte")
    return apres_geste(
        dossier,
        f"Lecture {args.lecture} de la source {source.id}",
        ["sources.yaml", "journal.yaml", str(rel)],
    )


def controler_remplace(entrees: list, source: schema.Source) -> None:
    """--remplace : source existante et valide, même candidat, pas déjà remplacée, pas
    de boucle ; Refus (rien n'est écrit) sinon."""
    valides = []
    for entree in entrees:
        try:
            valides.append(schema.Source.model_validate(entree))
        except ValidationError:
            continue
    if source.remplace not in {s.id for s in valides}:
        raise Refus(
            f"--remplace : source « {source.remplace} » inconnue ou en défaut dans "
            "sources.yaml (rien n'est écrit)"
        )
    problemes = [
        m for i, m in schema.controler_lignee([*valides, source]) if i == source.id
    ]
    if problemes:
        raise Refus(f"--remplace refusé : {problemes[0]} (rien n'est écrit)")


def texte_versionne(texte: str) -> str:
    """Forme du texte dans textes/ : fins de ligne LF, sans espace en fin de ligne, une
    fin de ligne finale (les contrôles pre-commit du dépôt de données ne le réécrivent
    pas) ; la comparaison des citations, après normaliser, n'en dépend pas."""
    texte = texte.replace("\r\n", "\n").replace("\r", "\n")
    lignes = [ligne.rstrip(" \t\v") for ligne in texte.split("\n")]
    return "\n".join(lignes).rstrip("\n") + "\n"


def ecrire_texte_versionne(
    racine_depot: Path, empreinte: str, texte: str, remplacer: bool = False
) -> str | None:
    """Écrit textes/<sha256>.txt s'il manque (ou le remplace : source lecture) ; chemin
    relatif écrit, None sinon."""
    rel = evolution.chemin_texte(empreinte)
    cible = racine_depot / rel
    if cible.is_file() and not remplacer:
        return None
    cible.parent.mkdir(parents=True, exist_ok=True)
    contenu = texte_versionne(texte).encode("utf-8")
    _ecrire_octets(cible, contenu)
    if len(contenu) > TEXTE_GROS:
        print(
            f"AVERTISSEMENT : {rel} dépasse 1 Mo ({len(contenu)} octets) : le contrôle "
            "check-added-large-files du dépôt de données le refusera (guide "
            "d'exploitation, section 7)"
        )
    return rel


def _ranger(
    racine_depot: Path, empreinte: str, suffixe: str, data: bytes, pages: list[str]
) -> str | None:
    """Document et texte extrait dans documents/ (hors git), texte dans textes/
    (versionné) ; renvoie le chemin de textes/ s'il vient d'être écrit."""
    dossier = racine_depot / "documents"
    dossier.mkdir(parents=True, exist_ok=True)
    # Document tel quel (son empreinte est celle du manifeste) ; <sha256>.txt est le
    # texte extrait, page par page
    original = dossier / (
        f"{empreinte}.original.txt" if suffixe == ".txt" else f"{empreinte}{suffixe}"
    )
    if not original.is_file():
        _ecrire_octets(original, data)
    texte = dossier / f"{empreinte}.txt"
    if not texte.is_file():
        _ecrire_octets(texte, SAUT_DE_PAGE.join(pages).encode("utf-8"))
    return ecrire_texte_versionne(
        racine_depot, empreinte, texte.read_text(encoding="utf-8")
    )


def original_du_document(dossier: Path, source: schema.Source) -> Path | None:
    """Document tel qu'inscrit (documents/<sha256><ext>, hors git), dont l'empreinte est
    celle de la source ; None s'il manque."""
    if not source.sha256:
        return None
    for path in sorted((dossier / "documents").glob(f"{source.sha256}.*")):
        if path.name == f"{source.sha256}.txt" or not path.is_file():
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() == source.sha256:
            return path
    return None


def texte_reconstruit(dossier: Path, source: schema.Source) -> str | None:
    """Texte extrait d'une source pour textes/ : lecture `brute`, le PDF original relu
    par pdftotext -raw (documents/<sha256>.txt peut dater d'une autre lecture) ; sinon
    documents/<sha256>.txt. None s'il manque."""
    assert source.sha256
    if source.lecture != "ordre":
        original = original_du_document(dossier, source)
        if original is None:
            return None
        pages = pages_du_document(original.name, original.read_bytes(), source.lecture)
        return SAUT_DE_PAGE.join(pages)
    extrait = dossier / "documents" / f"{source.sha256}.txt"
    if not extrait.is_file():
        return None
    return extrait.read_text(encoding="utf-8")


def cmd_textes(args: argparse.Namespace) -> int:
    """textes reconstruire : textes/<sha256>.txt depuis documents/<sha256>.txt (depuis
    le PDF original pour une source en lecture brute)."""
    dossier = racine()
    etat = etat_valide(dossier)
    ecrits: list[str] = []
    presents = 0
    sans_document: list[str] = []
    for source in sorted(etat.sources.values(), key=lambda s: s.id):
        if not source.sha256:
            continue
        if (dossier / evolution.chemin_texte(source.sha256)).is_file():
            presents += 1
            continue
        texte = texte_reconstruit(dossier, source)
        if texte is None:
            sans_document.append(source.id)
            continue
        rel = ecrire_texte_versionne(dossier, source.sha256, texte)
        if rel:
            ecrits.append(rel)
    print(
        f"Textes versionnés : {len(ecrits)} écrit(s), {presents} déjà présent(s), "
        f"{len(sans_document)} sans document"
    )
    for source_id in sans_document:
        print(
            f"  {source_id} : documents/ sans texte extrait (ni PDF original en lecture "
            "brute), relancer « source ajouter » avec le document"
        )
    if ecrits:
        afficher_git("Textes des documents", [TEXTES])
    return 0


def _ecrire_octets(path: Path, data: bytes) -> None:
    """Écriture atomique : jamais de texte tronqué pris ensuite pour le bon."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fichier:
            fichier.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# --- extraire -------------------------------------------------------------------------


@dataclass
class Tranche:
    pages: list[int]
    texte: str


def _limite(jetons: int) -> int:
    """Caractères d'un morceau de `jetons` jetons au plus (estimation de documents.py),
    marge comprise pour le repère de page."""
    return int((jetons - 50) * documents.CHARS_PER_TOKEN)


def couper(texte: str, limite: int) -> list[str]:
    """Morceaux de `limite` caractères au plus, coupés aux fins de ligne, sinon entre
    deux mots, en dernier recours au milieu d'un mot."""
    morceaux: list[str] = []
    courant = ""
    for unite in _unites(texte, limite):
        if courant and len(courant) + len(unite) > limite:
            morceaux.append(courant)
            courant = ""
        courant += unite
    if courant:
        morceaux.append(courant)
    return [m.strip() for m in morceaux if m.strip()]


def _unites(texte: str, limite: int):
    for ligne in texte.splitlines(keepends=True):
        if len(ligne) <= limite:
            yield ligne
            continue
        for mot in re.findall(r"\S+\s*", ligne):
            while len(mot) > limite:
                yield mot[:limite]
                mot = mot[limite:]
            yield mot


def tranches(pages: list[str], jetons: int = TRANCHE_JETONS) -> list[Tranche]:
    """Tranches d'environ `jetons` jetons, coupées aux sauts de page ; une page plus
    longue qu'une tranche est coupée elle aussi. Chaque morceau porte « [page N] »."""
    limite = _limite(jetons)
    blocs = [
        (numero, f"[page {numero}]\n{morceau}")
        for numero, page in enumerate(pages, 1)
        for morceau in couper(page, limite)
    ]
    resultat: list[Tranche] = []
    courant: list[tuple[int, str]] = []
    taille = 0
    for numero, bloc in blocs:
        if courant and taille + len(bloc) + 2 > limite:
            resultat.append(_tranche(courant))
            courant, taille = [], 0
        courant.append((numero, bloc))
        taille += len(bloc) + 2
    if courant:
        resultat.append(_tranche(courant))
    return resultat


def _tranche(blocs: list[tuple[int, str]]) -> Tranche:
    tranche = Tranche(
        sorted({n for n, _ in blocs}), "\n\n".join(texte for _, texte in blocs)
    )
    assert documents.estimate_tokens(tranche.texte) < CONTEXTE_JETONS
    return tranche


def etendue(pages: list[int]) -> str:
    return str(pages[0]) if len(pages) == 1 else f"{pages[0]}-{pages[-1]}"


def lire_mesures(reponse: object) -> list[dict] | None:
    """Mesures de la réponse JSON du modèle, None si elle est illisible."""
    if not isinstance(reponse, str):
        return None
    texte = reponse.strip()
    texte = re.sub(r"^```(?:json)?\s*|\s*```$", "", texte)
    try:
        data = json.loads(texte)
    except ValueError:
        return None
    if isinstance(data, dict):
        data = data.get("mesures")
    if not isinstance(data, list):
        return None
    return [m for m in data if isinstance(m, dict)]


def brouillon_initial(
    dossier: Path, slug: str, base: schema.Base, aujourd: date
) -> dict:
    """Brouillon existant, sinon copie de la fiche publiée, sinon squelette à compléter."""
    brouillon = dossier / "brouillons" / f"{slug}.yaml"
    if brouillon.is_file():
        return lire_dict(brouillon, f"brouillons/{slug}.yaml")
    publiee = dossier / schema.fichier_fiche(slug)
    if publiee.is_file():
        return lire_dict(publiee, schema.fichier_fiche(slug))
    squelette: dict[str, Any] = {
        "id": slug,
        "nom_affiche": "À compléter",
        "initiales": "XX",
        "alias": [],
    }
    if base.jeu == "demonstration":
        squelette["fictif"] = True
    squelette.update(
        {
            "statut": "declare",
            "statut_source": A_COMPLETER,
            "declaration": {"date": aujourd, "source_id": A_COMPLETER},
            "description": {
                "texte": "À compléter : 300 caractères au plus, rédaction neutre",
                "nature": "redaction",
            },
            "lignes_phares": [],
            "mesures": [],
            "version": 1,
            "mise_a_jour": aujourd,
        }
    )
    return squelette


@dataclass
class Extraction:
    pages: list[str]
    controle: common.TexteControle
    source_id: str
    themes: set[str]
    grille: bool
    ids: set[str]
    citations: set[str]
    couvertes: set[int] = field(default_factory=set)
    ajoutees: list[dict] = field(default_factory=list)

    def mesure(self, brute: dict, tranche: Tranche, aujourd: date) -> None:
        citation = brute.get("citation")
        if not isinstance(citation, str) or not citation.strip():
            return
        citation = citation.strip()
        normalisee = common.normaliser(citation)
        # Pages où la citation commence (au besoin à cheval sur des sauts de page) ;
        # celles de la tranche d'abord
        trouvees = common.pages_de_citation(self.controle, citation)
        ordre = tranche.pages + [
            p for p in range(1, len(self.pages) + 1) if p not in tranche.pages
        ]
        page = next((p for p in ordre if p in trouvees), None)
        if page is not None:
            self.couvertes.add(page)
        if normalisee in self.citations:
            return
        a_verifier = page is None or citation_courte(citation)
        theme = str(brute.get("theme") or "").strip().lower()
        if not re.fullmatch(schema.IDENTIFIANT, theme):
            theme, a_verifier = THEME_A_CLASSER, True
        elif self.grille and theme not in self.themes:
            a_verifier = True
        if page is None:
            propose = brute.get("page")
            page = propose if isinstance(propose, int) and propose >= 1 else None
        rang = 1
        while f"{theme}-{rang}" in self.ids:
            rang += 1
        mesure: dict[str, Any] = {"id": f"{theme}-{rang}", "theme": theme}
        mesure["citation"] = citation
        resume = brute.get("resume")
        if isinstance(resume, str) and resume.strip():
            mesure["resume"] = resume.strip()[:RESUME_MAX]
        mesure["source_id"] = self.source_id
        if page is not None:
            mesure["page"] = page
        mesure["ajoutee_le"] = aujourd
        mesure["a_verifier"] = a_verifier
        self.ids.add(mesure["id"])
        self.citations.add(normalisee)
        self.ajoutees.append(mesure)


def cmd_extraire(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    assert etat.base is not None
    slug = identifiant(args.candidat, "candidat")
    source = etat.sources.get(args.source_id)
    if source is None:
        raise Refus(
            f"source inconnue ou en défaut dans sources.yaml : {args.source_id}"
        )
    if source.candidat and source.candidat != slug:
        raise Refus(f"source {source.id} d'un autre candidat ({source.candidat})")
    if source.niveau not in schema.NIVEAUX_MESURE:
        raise Refus(
            f"source {source.id} de niveau {source.niveau} : une mesure cite une "
            "source officiel_etat ou candidat"
        )
    pages = texte_source(dossier, source)
    if pages is None:
        raise Refus(
            f"texte de la source {source.id} absent (documents/ et textes/"
            f"{source.sha256}.txt) : "
            "relancer « source ajouter » avec le document"
        )
    aujourd = aujourd_hui()
    grille = themes_connus(dossier, etat)
    # Thèmes de la grille (dans son ordre si elle est valide), puis ceux hors quiz
    # (ADR 0016)
    if etat.grille is not None:
        themes = [t.id for t in etat.grille.themes] + list(schema.THEMES_HORS_QUIZ)
    elif grille:
        themes = sorted(grille - set(schema.THEMES_HORS_QUIZ)) + list(
            schema.THEMES_HORS_QUIZ
        )
    else:
        themes = list(THEMES_REFERENCE)
    fiche = brouillon_initial(dossier, slug, etat.base, aujourd)
    mesures = [m for m in fiche.get("mesures") or [] if isinstance(m, dict)]
    votes = [v for v in fiche.get("votes") or [] if isinstance(v, dict)]
    travail = Extraction(
        pages=pages,
        controle=common.texte_de_controle(pages),
        source_id=source.id,
        themes=set(themes),
        grille=grille is not None,
        ids={str(m.get("id")) for m in mesures + votes},
        citations={
            common.normaliser(m["citation"])
            for m in mesures
            if isinstance(m.get("citation"), str)
        },
    )
    liste = tranches(pages)
    illisibles = []
    for rang, tranche in enumerate(liste, 1):
        print(f"Tranche {rang}/{len(liste)} (pages {etendue(tranche.pages)})")
        reponse = demander(
            {
                "type": "extraction",
                "candidat": slug,
                "themes": themes,
                "texte": tranche.texte,
            }
        )
        brutes = lire_mesures(reponse.get("reponse"))
        if brutes is None:
            print(
                f"AVERTISSEMENT : tranche {rang} : réponse illisible, tranche signalée"
            )
            illisibles.append({"tranche": rang, "pages": etendue(tranche.pages)})
            continue
        for brute in brutes:
            travail.mesure(brute, tranche, aujourd)
    non_couvertes = [
        n
        for n, page in enumerate(pages, 1)
        if page.strip() and n not in travail.couvertes
    ]
    fiche["mesures"] = mesures + travail.ajoutees
    passages = [
        p
        for p in fiche.get("extraction") or []
        if isinstance(p, dict) and p.get("source_id") != source.id
    ]
    passages.append(
        {
            "source_id": source.id,
            "le": aujourd,
            "tranches": len(liste),
            "pages_non_couvertes": non_couvertes,
            "tranches_illisibles": illisibles,
        }
    )
    fiche["extraction"] = passages
    ecrire_yaml(
        dossier / "brouillons" / f"{slug}.yaml",
        fiche,
        entete=(
            "Brouillon de fiche (non publié, hors git) : relire et corriger dans "
            "l'éditeur.\n"
            "a_verifier: true : citation introuvable mot pour mot, ou thème à classer.\n"
            f"Puis : presidentielle.sh verifier brouillons/{slug}.yaml, et publier {slug}."
        ),
    )
    douteuses = sum(1 for m in travail.ajoutees if m["a_verifier"])
    print(
        f"Brouillon brouillons/{slug}.yaml : {len(travail.ajoutees)} mesure(s) "
        f"ajoutée(s), dont {douteuses} à vérifier"
    )
    if non_couvertes:
        print(f"Pages sans mesure (à relire) : {', '.join(map(str, non_couvertes))}")
    if illisibles:
        print(
            f"Tranches illisibles : {', '.join(str(t['tranche']) for t in illisibles)}"
        )
    return 0


# --- publier, restaurer, rattacher ----------------------------------------------------


def _sans_defauts(fiche: dict) -> dict:
    """Retire les marques « a_verifier: false » (valeur par défaut) d'une fiche."""
    for mesure in fiche.get("mesures") or []:
        if isinstance(mesure, dict) and mesure.get("a_verifier") is False:
            del mesure["a_verifier"]
    return fiche


def figer_version(dossier: Path, slug: str, version: int, data: dict) -> list[str]:
    """Copie figée de la version publiée dans historique/<slug>/v<N>.yaml ; la version
    précédente encore publiée y est d'abord copiée telle quelle si elle y manque (fiche
    publiée avant l'historique). Renvoie les chemins écrits, relatifs au dépôt."""
    ecrits = []
    publiee = dossier / schema.fichier_fiche(slug)
    ancienne = version_publiee(dossier, slug)
    if 0 < ancienne < version:
        rel = evolution.chemin_version(slug, ancienne)
        if not (dossier / rel).is_file():
            (dossier / rel).parent.mkdir(parents=True, exist_ok=True)
            _ecrire_octets(dossier / rel, publiee.read_bytes())
            ecrits.append(rel)
    rel = evolution.chemin_version(slug, version)
    ecrire_yaml(dossier / rel, data, entete=entete_de(publiee))
    ecrits.append(rel)
    return ecrits


def controler_retraits_erreur(
    etat: base_presidentielle.Etat, slug: str, data: dict, retraits: list[str]
) -> list[str]:
    """Mesures retirées parce qu'erronées (publier --retrait-erreur) : chacune doit
    figurer dans la version publiée et manquer au brouillon ; Refus sinon (rien n'est
    écrit). Renvoie les identifiants sans doublon, dans l'ordre donné."""
    retraits = list(dict.fromkeys(identifiant(m, "mesure") for m in retraits))
    publiee = etat.fiches.get(slug)
    if publiee is None:
        raise Refus(
            f"--retrait-erreur : aucune version publiée lisible de {slug} (rien n'est écrit)"
        )
    publiees = {m.id for m in publiee.mesures}
    gardees = {
        str(m.get("id")) for m in data.get("mesures") or [] if isinstance(m, dict)
    }
    absentes = [m for m in retraits if m not in publiees]
    if absentes:
        raise Refus(
            f"--retrait-erreur : {', '.join(absentes)} absente(s) de la version "
            f"{publiee.version} publiée (rien n'est écrit)"
        )
    restees = [m for m in retraits if m in gardees]
    if restees:
        raise Refus(
            f"--retrait-erreur : {', '.join(restees)} encore dans le brouillon : "
            "la retirer du brouillon d'abord (rien n'est écrit)"
        )
    return retraits


def publier_fiche(
    dossier: Path,
    slug: str,
    data: dict,
    nom: str,
    motif: str,
    relue: bool,
    retraits_erreur: list[str] | None = None,
) -> tuple[int, list[str]]:
    """Contrôle puis écrit candidats/<slug>.yaml en version + 1, sa copie figée dans
    historique/, et journalise ; Refus (rien n'est écrit) au moindre défaut. Renvoie la
    nouvelle version et les copies figées écrites. `retraits_erreur` : mesures retirées
    parce qu'erronées, inscrites au journal (la vue « Évolution » en masque le texte)."""
    etat = etat_valide(dossier)
    if retraits_erreur:
        retraits_erreur = controler_retraits_erreur(etat, slug, data, retraits_erreur)
    douteuses = [
        str(m.get("id"))
        for m in data.get("mesures") or []
        if isinstance(m, dict) and m.get("a_verifier")
    ]
    if douteuses:
        raise Refus(
            f"{nom} : mesures à vérifier ({', '.join(douteuses)}) : relire, corriger, "
            "puis passer a_verifier à false"
        )
    aujourd = aujourd_hui()
    version = version_publiee(dossier, slug) + 1
    data = _sans_defauts(dict(data))
    data["version"] = version
    data["mise_a_jour"] = aujourd
    if relue:
        data["relue_le"] = aujourd
    fiche = fiche_du_fichier(data, nom, slug)
    rapport = Rapport()
    controler_fiche_complete(dossier, etat, fiche, nom, rapport)
    if rapport.erreurs:
        raise Refus(
            "publication refusée, fiche inchangée :\n  " + "\n  ".join(rapport.erreurs)
        )
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd,
            "objet": "fiche",
            "cible": slug,
            "version": version,
            "motif": motif,
            "retraits_erreur": retraits_erreur or None,
        }
    )
    for message in rapport.avertissements:
        print(f"AVERTISSEMENT : {message}")
    deja_retirees = {
        m
        for e in etat.journal
        if e.objet == "fiche" and e.cible == slug
        for m in e.retraits_erreur or []
    }
    reprises = [m.id for m in fiche.mesures if m.id in deja_retirees]
    if reprises:
        print(
            f"AVERTISSEMENT : {', '.join(reprises)} déjà retirée(s) pour erreur : de "
            "nouveau affichée(s) à partir de cette version"
        )
    cible = dossier / schema.fichier_fiche(slug)
    copies = figer_version(dossier, slug, version, data)
    ecrire_yaml(cible, data, entete=entete_de(cible))
    journal.ecrire()
    return version, copies


def cmd_publier(args: argparse.Namespace) -> int:
    dossier = racine()
    slug = identifiant(args.candidat, "candidat")
    nom = f"brouillons/{slug}.yaml"
    path = dossier / nom
    if not path.is_file():
        raise Refus(f"aucun brouillon {nom} : lancer d'abord « extraire »")
    data = lire_dict(path, nom)
    data.pop("extraction", None)
    premiere = version_publiee(dossier, slug) == 0
    motif = args.motif or (
        "Publication de la fiche" if premiere else "Mise à jour de la fiche"
    )
    version, copies = publier_fiche(
        dossier, slug, data, nom, motif, relue=True, retraits_erreur=args.retrait_erreur
    )
    path.unlink()
    print(f"Fiche candidats/{slug}.yaml publiée en version {version}")
    if args.retrait_erreur:
        print(
            "Retrait pour erreur inscrit au journal : "
            f"{', '.join(dict.fromkeys(args.retrait_erreur))} (texte masqué dans "
            "l'évolution ; copies de historique/ inchangées)"
        )
    demander_index()
    afficher_git(
        f"Fiche {slug} : version {version}",
        [schema.fichier_fiche(slug), "journal.yaml", *copies],
    )
    return 0


def cmd_restaurer(args: argparse.Namespace) -> int:
    dossier = racine()
    slug = identifiant(args.candidat, "candidat")
    if not re.fullmatch(r"[0-9A-Za-z._/~^@{}-]{1,80}", args.revision):
        raise Refus(f"révision invalide : {args.revision}")
    path = dans_le_depot(dossier, args.depuis)
    data = lire_dict(path, f"révision {args.revision}")
    ancienne = data.get("version")
    revision = args.revision[:12]
    version, copies = publier_fiche(
        dossier,
        slug,
        data,
        f"{schema.fichier_fiche(slug)} (révision {revision})",
        f"Restauration de la révision {revision} (version {ancienne})",
        relue=False,
    )
    print(
        f"Fiche candidats/{slug}.yaml restaurée depuis la révision {revision}, "
        f"publiée en version {version}"
    )
    demander_index()
    afficher_git(
        f"Fiche {slug} : restauration de {revision}",
        [schema.fichier_fiche(slug), "journal.yaml", *copies],
    )
    return 0


def cmd_rattacher(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    grille = etat.grille
    if grille is None:
        raise Refus("grille du quiz absente ou en défaut : rattachement impossible")
    if grille.question(args.question) is None:
        raise Refus(f"question inconnue : {args.question} (fichier inchangé)")
    try:
        nouveau = schema.Rattachement(
            question=args.question,
            candidat=args.candidat,
            option=args.option,
            mesure_id=args.mesure,
        )
    except ValidationError as exc:
        raise Refus(f"rattachement refusé : {schema._message(exc)}") from None
    nom = "quiz/rattachements.yaml"
    path = dossier / nom
    try:
        actuels = (
            schema.charger(schema.Rattachements, path, nom)
            if path.is_file()
            else schema.Rattachements()
        )
    except schema.ErreurFichier as exc:
        raise Refus(str(exc)) from None
    liste = list(actuels.rattachements)
    rang = next(
        (
            i
            for i, r in enumerate(liste)
            if r.question == nouveau.question and r.candidat == nouveau.candidat
        ),
        None,
    )
    if rang is None:
        rang = len(liste)
        liste.append(nouveau)
    else:
        liste[rang] = nouveau
    problemes = schema.controler_rattachements(
        schema.Rattachements(rattachements=liste), grille, etat.fiches
    )
    refus = [m for i, m in problemes if i == rang]
    if refus:
        raise Refus("; ".join(refus) + " (fichier inchangé)")
    contenu = lire_dict(path, nom) if path.is_file() else {}
    contenu["rattachements"] = [r.model_dump() for r in liste]
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd_hui(),
            "objet": "rattachement",
            "cible": f"{nouveau.question}/{nouveau.candidat}",
            "motif": args.motif
            or (
                f"Question {nouveau.question} : {nouveau.candidat}, option "
                f"{nouveau.option} (mesure {nouveau.mesure_id})"
            ),
        }
    )
    reecrire(path, contenu)
    journal.ecrire()
    print(f"Rattachement écrit : {nouveau.question} / {nouveau.candidat}")
    afficher_git(
        f"Rattachement {nouveau.question} {nouveau.candidat}", [nom, "journal.yaml"]
    )
    return 0


# --- quiz-relire ----------------------------------------------------------------------


def cmd_quiz_relire(args: argparse.Namespace) -> int:
    dossier = racine()
    path = dossier / "quiz" / "grille.yaml"
    if not path.is_file():
        raise Refus("quiz/grille.yaml absent")
    data = lire_dict(path, "quiz/grille.yaml")
    question = next(
        (
            q
            for t in data.get("themes") or []
            if isinstance(t, dict)
            for q in t.get("questions") or []
            if isinstance(q, dict) and q.get("id") == args.question
        ),
        None,
    )
    if question is None:
        raise Refus(f"question inconnue : {args.question}")
    options = [
        str(o.get("libelle"))
        for o in question.get("options") or []
        if isinstance(o, dict) and o.get("libelle")
    ]
    if not question.get("enonce") or not options:
        raise Refus(f"question {args.question} sans énoncé ou sans options")
    reponse = demander(
        {"type": "relecture", "enonce": str(question["enonce"]), "options": options}
    )
    for lecture in reponse.get("lectures") or []:
        print(f"Lecture d'un électeur de {lecture.get('lecteur')} :")
        print(f"  {lecture.get('texte', '').strip()}\n")
    print("Rien n'est écrit : à vous de trancher, puis de modifier la grille.")
    return 0


# --- Gestes du calendrier --------------------------------------------------------------


def source_officielle(etat: base_presidentielle.Etat, source_id: str) -> schema.Source:
    source = etat.sources.get(source_id)
    if source is None:
        raise Refus(f"source inconnue : {source_id}")
    if source.niveau != "officiel_etat":
        raise Refus(
            f"source {source.id} de niveau {source.niveau} : officiel_etat attendu"
        )
    return source


def base_modifiee(dossier: Path, changement: dict) -> dict:
    data = lire_dict(dossier / "base.yaml", "base.yaml")
    data.update(changement)
    try:
        schema.Base.model_validate(data)
    except ValidationError as exc:
        raise Refus(f"base.yaml refusé : {schema._message(exc)}") from None
    return data


def apres_geste(dossier: Path, message: str, fichiers: list[str]) -> int:
    print("Vérification de la base :")
    code = verifier_base(dossier).afficher()
    afficher_git(message, fichiers)
    return code


def cmd_liste_officielle(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    assert etat.base is not None
    source = source_officielle(etat, args.source)
    officiels = list(dict.fromkeys(args.officiels))
    inconnus = [s for s in officiels if s not in etat.fiches]
    if inconnus:
        raise Refus(
            f"candidat inconnu (fiche publiée attendue) : {', '.join(inconnus)}"
        )
    retires = [s for s in officiels if etat.fiches[s].statut == "retire"]
    if retires:
        raise Refus(f"candidat retiré dans la liste officielle : {', '.join(retires)}")
    if etat.base.phase == "entre_tours":
        raise Refus("base déjà en entre-deux-tours : liste officielle figée")
    base = base_modifiee(
        dossier, {"liste": "officielle", "liste_source": source.id, "phase": "officiel"}
    )
    aujourd = aujourd_hui()
    changees: list[tuple[str, dict]] = []
    for slug, fiche in sorted(etat.fiches.items()):
        if slug in officiels:
            statut = "officiel"
        elif fiche.statut == "retire":
            continue
        else:
            statut = "non_qualifie"
        if statut == fiche.statut and fiche.statut_source == source.id:
            continue
        nom = schema.fichier_fiche(slug)
        data = lire_dict(dossier / nom, nom)
        data.update(
            statut=statut,
            statut_source=source.id,
            version=fiche.version + 1,
            mise_a_jour=aujourd,
        )
        fiche_du_fichier(data, nom, slug)
        changees.append((slug, data))
    journal = Journal(dossier)
    for slug, data in changees:
        journal.ajouter(
            {
                "date": aujourd,
                "objet": "fiche",
                "cible": slug,
                "version": data["version"],
                "motif": f"Statut {data['statut']} (liste officielle, source {source.id})",
            }
        )
    journal.ajouter(
        {
            "date": aujourd,
            "objet": "base",
            "cible": "liste",
            "motif": f"Liste officielle (source {source.id}) : {', '.join(officiels)}",
        }
    )
    reecrire(dossier / "base.yaml", base)
    copies: list[str] = []
    for slug, data in changees:
        copies += figer_version(dossier, slug, data["version"], data)
        reecrire(dossier / schema.fichier_fiche(slug), data)
    journal.ecrire()
    print(
        f"Liste officielle : {len(officiels)} candidat(s), {len(changees)} fiche(s) mise(s) à jour"
    )
    fichiers = (
        ["base.yaml", "journal.yaml"]
        + [schema.fichier_fiche(s) for s, _ in changees]
        + copies
    )
    return apres_geste(dossier, "Liste officielle", fichiers)


def cmd_phase(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    assert etat.base is not None
    if args.a == args.b:
        raise Refus("deux qualifiés distincts attendus")
    for slug in (args.a, args.b):
        fiche = etat.fiches.get(slug)
        if fiche is None:
            raise Refus(f"candidat inconnu (fiche publiée attendue) : {slug}")
        if fiche.statut != "officiel":
            raise Refus(f"{slug} n'est pas candidat officiel (statut {fiche.statut})")
    if etat.base.liste != "officielle":
        raise Refus("liste officielle à enregistrer d'abord (liste-officielle)")
    source = source_officielle(etat, args.source)
    # Ordre alphabétique, jamais l'ordre tapé (souvent celui des résultats) : base.yaml
    # et motif du journal public
    qualifies = sorted((args.a, args.b))
    base = base_modifiee(dossier, {"phase": "entre_tours", "qualifies": qualifies})
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd_hui(),
            "objet": "base",
            "cible": "phase",
            "motif": (
                f"Entre-deux-tours : {qualifies[0]} et {qualifies[1]} qualifiés"
                f" (source {source.id})"
            ),
        }
    )
    reecrire(dossier / "base.yaml", base)
    journal.ecrire()
    print(f"Phase entre-deux-tours : {qualifies[0]} et {qualifies[1]}")
    return apres_geste(dossier, "Entre-deux-tours", ["base.yaml", "journal.yaml"])


def cmd_surveillance(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    assert etat.base is not None
    nom = "surveillance.yaml"
    path = dossier / nom
    contenu = lire_dict(path, nom) if path.is_file() else {}
    try:
        suivi = schema.Surveillance.model_validate(contenu)
    except ValidationError as exc:
        raise Refus(f"{nom} : {schema._message(exc)}") from None
    pages = [p.model_dump() for p in suivi.pages]
    gelee = suivi.gelee_le
    if args.action in ("ajouter", "retirer") and not args.url:
        raise Refus(f"surveillance {args.action} : adresse attendue")
    if args.action == "ajouter":
        if not args.candidat:
            raise Refus("surveillance ajouter : --candidat attendu")
        try:
            page = schema.PageSuivie(
                url=args.url, candidat=args.candidat, ajoutee_le=aujourd_hui()
            )
        except ValidationError as exc:
            raise Refus(f"page refusée : {schema._message(exc)}") from None
        if page.candidat not in etat.fiches:
            raise Refus(f"candidat inconnu (fiche publiée attendue) : {page.candidat}")
        if etat.base.jeu == "demonstration" and not schema.domaine_fictif(page.url):
            raise Refus(f"jeu demonstration : adresse hors {schema.DOMAINE_FICTIF}")
        if any(p["url"] == page.url for p in pages):
            raise Refus(f"page déjà suivie : {page.url}")
        pages.append(page.model_dump())
        motif = f"Page suivie ajoutée ({page.candidat}) : {page.url}"
    elif args.action == "retirer":
        restantes = [p for p in pages if p["url"] != args.url]
        if len(restantes) == len(pages):
            raise Refus(f"page non suivie : {args.url}")
        pages = restantes
        motif = f"Page suivie retirée : {args.url}"
    else:
        if not pages:
            raise Refus("aucune page à geler")
        gelee = aujourd_hui()
        motif = f"Liste des pages suivies gelée ({len(pages)} page(s))"
    if args.action != "geler" and gelee is not None:
        print(
            "AVERTISSEMENT : liste modifiée après le gel : relancer « surveillance geler »"
        )
        gelee = None
    contenu = {"pages": pages}
    if gelee is not None:
        contenu["gelee_le"] = gelee
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd_hui(),
            "objet": "base",
            "cible": "surveillance",
            "motif": motif,
        }
    )
    reecrire(path, contenu)
    journal.ecrire()
    print(motif)
    return apres_geste(dossier, "Pages suivies", [nom, "journal.yaml"])


# --- Scrutins retenus et votes réels (lot 4b) -------------------------------------------

SCRUTINS = "quiz/scrutins.yaml"


def lire_scrutins(dossier: Path) -> schema.Scrutins:
    path = dossier / SCRUTINS
    if not path.is_file():
        raise Refus(
            f"{SCRUTINS} absent : écrire d'abord la liste des scrutins retenus "
            "(docs/runbooks/presidentielle-votes-et-surveillance.md)"
        )
    try:
        return schema.charger(schema.Scrutins, path, SCRUTINS)
    except schema.ErreurFichier as exc:
        raise Refus(str(exc)) from None


def dernier_gel_scrutins(journal: list[schema.EntreeJournal]) -> str | None:
    """Empreinte du dernier gel de la liste des scrutins inscrit au journal."""
    gels = [
        e.empreinte
        for e in journal
        if e.objet == "base" and e.cible == "scrutins" and e.empreinte
    ]
    return gels[-1] if gels else None


def problemes_scrutins(
    dossier: Path,
    etat: base_presidentielle.Etat,
    liste: schema.Scrutins,
    gel: bool = True,
) -> list[str]:
    """Thèmes connus, domaine selon le jeu, et (si `gel`) liste identique à celle du
    dernier gel journalisé."""
    problemes = []
    themes = themes_connus(dossier, etat)
    jeu = etat.base.jeu if etat.base else None
    for s in liste.scrutins:
        if themes is not None and s.theme not in themes:
            problemes.append(
                f"{SCRUTINS} : scrutin {s.id} : thème « {s.theme} » inconnu"
            )
        fictif = schema.domaine_fictif(s.url)
        if jeu == "demonstration" and not fictif:
            problemes.append(
                f"{SCRUTINS} : scrutin {s.id} : jeu demonstration, adresse hors "
                f"{schema.DOMAINE_FICTIF}"
            )
        if jeu == "reel" and fictif:
            problemes.append(
                f"{SCRUTINS} : scrutin {s.id} : adresse fictive (jeu reel)"
            )
    if gel and liste.gelee_le is not None:
        if dernier_gel_scrutins(etat.journal) != votes_an.empreinte(liste.scrutins):
            problemes.append(
                f"{SCRUTINS} : liste modifiée depuis son gel : la faire valider, puis "
                "relancer « scrutins geler »"
            )
    return problemes


def controler_scrutins(
    dossier: Path, etat: base_presidentielle.Etat, rapport: Rapport
) -> None:
    if not (dossier / SCRUTINS).is_file():
        return
    try:
        liste = schema.charger(schema.Scrutins, dossier / SCRUTINS, SCRUTINS)
    except schema.ErreurFichier as exc:
        rapport.erreurs.append(str(exc))
        return
    rapport.erreurs.extend(problemes_scrutins(dossier, etat, liste))
    if liste.gelee_le is not None:
        attendus = {votes_an.source_id(s) for s in liste.scrutins}
        for slug, fiche in sorted(etat.fiches.items()):
            if fiche.parlementaire and {v.id for v in fiche.votes} != attendus:
                rapport.avertissements.append(
                    f"{schema.fichier_fiche(slug)} : votes différents de la liste "
                    f"gelée de {SCRUTINS} : relancer « votes importer »"
                )
    if liste.scrutins and liste.gelee_le is None:
        rapport.avertissements.append(
            f"{SCRUTINS} : liste non gelée (scrutins geler, après validation)"
        )


def cmd_scrutins(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    liste = lire_scrutins(dossier)
    if args.action == "verifier":
        problemes = problemes_scrutins(dossier, etat, liste)
        for probleme in problemes:
            print(f"ERREUR : {probleme}")
        etat_gel = f"gelée le {liste.gelee_le}" if liste.gelee_le else "non gelée"
        print(f"{len(liste.scrutins)} scrutin(s) retenu(s), liste {etat_gel}")
        for theme in sorted({s.theme for s in liste.scrutins}):
            nombre = sum(1 for s in liste.scrutins if s.theme == theme)
            print(f"  {theme} : {nombre} scrutin(s)")
        return 1 if problemes else 0
    if not liste.scrutins:
        raise Refus(f"{SCRUTINS} : aucun scrutin à geler")
    problemes = problemes_scrutins(dossier, etat, liste, gel=False)
    if problemes:
        raise Refus("liste refusée :\n  " + "\n  ".join(problemes))
    aujourd = aujourd_hui()
    data = lire_dict(dossier / SCRUTINS, SCRUTINS)
    data["gelee_le"] = aujourd
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd,
            "objet": "base",
            "cible": "scrutins",
            "motif": f"Liste des scrutins retenus gelée ({len(liste.scrutins)} scrutin(s))",
            "empreinte": votes_an.empreinte(liste.scrutins),
        }
    )
    reecrire(dossier / SCRUTINS, data)
    journal.ecrire()
    print(f"Liste des scrutins gelée : {len(liste.scrutins)} scrutin(s)")
    return apres_geste(dossier, "Scrutins retenus", [SCRUTINS, "journal.yaml"])


def cmd_votes(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = etat_valide(dossier)
    assert etat.base is not None
    slug = identifiant(args.candidat, "candidat")
    if not votes_an.acteur_valide(args.acteur):
        raise Refus(f"identifiant de député invalide : {args.acteur} (PA… attendu)")
    liste = lire_scrutins(dossier)
    if not liste.scrutins:
        raise Refus(f"{SCRUTINS} : aucun scrutin retenu")
    if liste.gelee_le is None:
        raise Refus(
            f"{SCRUTINS} non gelée : faire valider la liste, puis « scrutins geler »"
        )
    problemes = problemes_scrutins(dossier, etat, liste)
    if problemes:
        raise Refus("liste des scrutins en défaut :\n  " + "\n  ".join(problemes))
    for chemin in args.archive:
        if not Path(chemin).is_file():
            raise Refus(f"archive introuvable : {chemin}")
    try:
        with contextlib.ExitStack() as pile:
            lues = [
                pile.enter_context(votes_an.Archive(Path(chemin)))
                for chemin in args.archive
            ]
            lus = votes_an.votes_de(lues, liste.scrutins, args.acteur)
    except votes_an.ErreurArchive as exc:
        raise Refus(f"{exc} (rien n'est écrit)") from None
    if all(lu.position == votes_an.SANS_VOTE for lu in lus):
        raise Refus(
            f"{args.acteur} ne figure dans aucun des {len(lus)} scrutin(s) : "
            "identifiant ou législature à vérifier (rien n'est écrit)"
        )
    aujourd = aujourd_hui()
    sources_path = dossier / "sources.yaml"
    contenu = lire_dict(sources_path, "sources.yaml") if sources_path.is_file() else {}
    entrees = contenu.get("sources") or []
    if not isinstance(entrees, list):
        raise Refus("sources.yaml : liste « sources » attendue")
    connues = {e.get("id"): e for e in entrees if isinstance(e, dict)}
    ajoutees = []
    for lu in lus:
        entree = votes_an.source_du_scrutin(lu, aujourd)
        deja = connues.get(entree["id"])
        if deja is not None:
            if deja.get("niveau") != "vote_reel" or deja.get("url") != entree["url"]:
                raise Refus(
                    f"source {entree['id']} déjà inscrite avec un autre niveau ou une "
                    "autre adresse (rien n'est écrit)"
                )
            continue
        try:
            source = schema.Source.model_validate(entree)
        except ValidationError as exc:
            raise Refus(f"source refusée : {schema._message(exc)}") from None
        refusee = schema.controler_sources(etat.base, [source])
        if refusee:
            raise Refus(refusee[0][1])
        ajoutees.append(entree)
    fiche = brouillon_initial(dossier, slug, etat.base, aujourd)
    nouveaux = [votes_an.vote_de_fiche(lu) for lu in lus]
    ids = {v["id"] for v in nouveaux}
    anciens = [v for v in fiche.get("votes") or [] if isinstance(v, dict)]
    retires = [str(v.get("id")) for v in anciens if v.get("id") not in ids]
    mesures = {
        str(m.get("id")) for m in fiche.get("mesures") or [] if isinstance(m, dict)
    }
    if mesures & ids:
        raise Refus(
            f"identifiant déjà pris par une mesure : {', '.join(sorted(mesures & ids))}"
        )
    fiche["parlementaire"] = True
    fiche["votes"] = nouveaux
    if ajoutees:
        contenu["sources"] = entrees + ajoutees
        reecrire(sources_path, contenu)
    ecrire_yaml(
        dossier / "brouillons" / f"{slug}.yaml",
        fiche,
        entete=(
            "Brouillon de fiche (non publié, hors git) : relire dans l'éditeur.\n"
            f"Votes : scrutins de {SCRUTINS} (même liste pour tous), député "
            f"{args.acteur}.\n"
            f"Puis : presidentielle.sh verifier brouillons/{slug}.yaml, et publier {slug}."
        ),
    )
    decompte = {
        position: sum(1 for lu in lus if lu.position == position)
        for position in dict.fromkeys(lu.position for lu in lus)
    }
    print(
        f"Brouillon brouillons/{slug}.yaml : {len(lus)} vote(s) sur les scrutins "
        "retenus ("
        + ", ".join(f"{position} : {nombre}" for position, nombre in decompte.items())
        + ")"
    )
    if retires:
        print(f"Votes hors de la liste retirés du brouillon : {', '.join(retires)}")
    print(
        f"Puis : presidentielle.sh verifier brouillons/{slug}.yaml, et publier {slug}."
    )
    if ajoutees:
        print(f"{len(ajoutees)} source(s) vote_reel ajoutée(s) à sources.yaml")
        afficher_git(f"Sources des scrutins ({slug})", ["sources.yaml"])
    return 0


# --- Index et base archivée ------------------------------------------------------------


def cmd_index(args: argparse.Namespace) -> int:
    racine()
    if correction_en_cours:
        # Demandée par main() après l'inscription de la correction au journal
        return 0
    try:
        statut, reponse = appeler(CHEMIN_INDEX, corps_index())
    except OSError as exc:
        raise Refus(
            f"routeur injoignable ({exc.__class__.__name__}) : le service "
            "llm-router doit tourner"
        ) from None
    if statut == 202:
        print("Index des passages : reconstruction demandée")
        return 0
    if statut == 200 and reponse.get("kind") == "mots":
        print(f"Index des passages : {reponse.get('detail') or 'recherche par mots'}")
        return 0
    if statut == 409 and reponse.get("kind") == "attente":
        print("Appel vocal en cours : relancer la commande après l'appel")
        return 1
    raise Refus(f"routeur : {statut} {reponse.get('detail') or 'réponse inattendue'}")


def ecriture(args: argparse.Namespace) -> bool:
    """Commande qui écrit dans la base publiée ou dans l'index."""
    if args.commande not in ECRITURES:
        return False
    return not (args.commande == "scrutins" and args.action == "verifier")


def garde_archive(args: argparse.Namespace) -> str | None:
    """Base archivée : refus d'une écriture sans --correction ; motif de la correction
    sinon. Hors archive, --correction est refusé (rien à corriger après coup)."""
    motif = getattr(args, "correction", None)
    if not ecriture(args):
        return None
    dossier = racine()
    try:
        base = schema.charger(schema.Base, dossier / "base.yaml", "base.yaml")
    except schema.ErreurFichier as exc:
        raise Refus(str(exc)) from None
    archivee = (
        base_presidentielle.phase_le(base, aujourd_hui()) == base_presidentielle.ARCHIVE
    )
    if not archivee:
        if motif is not None:
            raise Refus("--correction réservé à une base archivée (rien n'est écrit)")
        return None
    if motif is not None and (
        len(motif.strip()) > MOTIF_MAX or any(c < " " for c in motif)
    ):
        raise Refus(
            f"motif de correction : {MOTIF_MAX} caractères au plus, sur une ligne "
            "(rien n'est écrit)"
        )
    if not motif or not motif.strip():
        raise Refus(
            f"base archivée (figée au {base.archive_apres.isoformat()}) : "
            f"« {args.commande} » refusé ; seule une correction est admise, avec "
            '--correction "<motif>" (inscrite au journal)'
        )
    return motif.strip()


def journaliser_correction(commande: str, motif: str) -> None:
    dossier = racine()
    journal = Journal(dossier)
    journal.ajouter(
        {
            "date": aujourd_hui(),
            "objet": "base",
            "cible": "correction",
            "motif": f"Correction après archivage ({commande}) : {motif}",
        }
    )
    journal.ecrire()
    print(
        "Correction inscrite au journal : ajouter journal.yaml au même enregistrement"
    )


# --- etat et analyseur ----------------------------------------------------------------


def cmd_etat(args: argparse.Namespace) -> int:
    dossier = racine()
    etat = base_presidentielle.charger(dossier)
    if etat.base is None:
        print(f"base non servie : {etat.message}")
        return 1
    print(f"jeu {etat.base.jeu}, liste {etat.base.liste}, phase {etat.base.phase}")
    print(
        f"{len(etat.fiches)} fiche(s), {len(etat.sources)} source(s), "
        f"{len(etat.journal)} entrée(s) au journal"
    )
    for erreur in etat.erreurs:
        print(f"  {erreur.fichier} : {erreur.message}")
    return 0


def _date(valeur: str) -> date:
    try:
        return date.fromisoformat(valeur)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"date AAAA-MM-JJ attendue : {valeur}"
        ) from None


def _correction(p: argparse.ArgumentParser) -> None:
    """--correction accepté aussi après les arguments d'une sous-commande (sans écraser
    celui donné avant elle)."""
    p.add_argument(
        "--correction",
        metavar="MOTIF",
        default=argparse.SUPPRESS,
        help="base archivée seulement : correction inscrite au journal",
    )


def _args_source(p: argparse.ArgumentParser) -> None:
    actions = p.add_subparsers(dest="action", required=True)
    _args_source_ajouter(actions.add_parser("ajouter", help="ajout d'un document"))
    lecture = actions.add_parser(
        "lecture", help="lecture d'un PDF inscrit (texte régénéré, journalisé)"
    )
    lecture.add_argument("source_id")
    lecture.add_argument("lecture", choices=schema.LECTURES)
    _correction(lecture)


def _args_source_ajouter(p: argparse.ArgumentParser) -> None:
    _correction(p)
    p.add_argument("candidat", help="identifiant du candidat, « - » pour aucun")
    p.add_argument("fichier")
    p.add_argument(
        "--niveau",
        required=True,
        choices=sorted(schema.NIVEAUX_MESURE | schema.NIVEAUX_VOTE),
    )
    p.add_argument("--titre", required=True)
    p.add_argument("--url", required=True, help="adresse https du document")
    p.add_argument("--publie-le", type=_date, dest="publie_le")
    p.add_argument(
        "--id", help="identifiant de la source (défaut : <candidat>-<empreinte>)"
    )
    p.add_argument(
        "--remplace",
        metavar="SOURCE_ID",
        help="nouvelle version de ce document du même candidat (lignée du programme)",
    )
    p.add_argument(
        "--lecture",
        choices=schema.LECTURES,
        help=(
            "PDF : ordre (défaut, ordre de lecture) ou brute (pdftotext -raw, ordre du "
            "flux du PDF, si les colonnes restent mêlées)"
        ),
    )


def _args_textes(p: argparse.ArgumentParser) -> None:
    p.add_argument("action", choices=["reconstruire"])


def _args_extraire(p: argparse.ArgumentParser) -> None:
    p.add_argument("candidat")
    p.add_argument("source_id")


def _args_verifier(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "fichier", nargs="?", help="fiche ou brouillon ; défaut : toute la base"
    )


def _args_publier(p: argparse.ArgumentParser) -> None:
    p.add_argument("candidat")
    p.add_argument("--motif")
    p.add_argument(
        "--retrait-erreur",
        dest="retrait_erreur",
        nargs="+",
        metavar="MESURE",
        help=(
            "mesures retirées parce qu'erronées (citation fausse, mal attribuée, hors "
            "contexte) : texte masqué dans la vue « Évolution »"
        ),
    )


def _args_restaurer(p: argparse.ArgumentParser) -> None:
    p.add_argument("candidat")
    p.add_argument("revision")
    p.add_argument("--depuis", required=True, help="fiche tirée de git par l'enveloppe")


def _args_rattacher(p: argparse.ArgumentParser) -> None:
    for nom in ("question", "candidat", "option", "mesure"):
        p.add_argument(nom)
    p.add_argument("--motif")


def _args_quiz_relire(p: argparse.ArgumentParser) -> None:
    p.add_argument("question")


def _args_liste_officielle(p: argparse.ArgumentParser) -> None:
    p.add_argument("--source", required=True, help="source officiel_etat de la liste")
    p.add_argument("--officiels", required=True, nargs="+", metavar="CANDIDAT")


def _args_phase(p: argparse.ArgumentParser) -> None:
    p.add_argument("phase", choices=["entre-tours"])
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument("--source", required=True, help="source officiel_etat des résultats")


def _args_surveillance(p: argparse.ArgumentParser) -> None:
    p.add_argument("action", choices=["ajouter", "retirer", "geler"])
    p.add_argument("url", nargs="?")
    p.add_argument("--candidat")


def _args_scrutins(p: argparse.ArgumentParser) -> None:
    p.add_argument("action", choices=["verifier", "geler"])


def _args_votes(p: argparse.ArgumentParser) -> None:
    p.add_argument("action", choices=["importer"])
    p.add_argument("candidat")
    p.add_argument("--acteur", required=True, help="identifiant du député (PA…)")
    p.add_argument(
        "--archive",
        required=True,
        action="append",
        help=(
            "archive Scrutins.json.zip des données ouvertes de l'Assemblée (une par "
            "législature, option répétable)"
        ),
    )


COMMANDES: dict[str, tuple[str, Callable[[argparse.Namespace], int]]] = {
    "etat": ("Résumé de la base et de ses erreurs", cmd_etat),
    "source": ("Ajout d'une source avec son empreinte", cmd_source),
    "extraire": ("Brouillon de fiche extrait d'une source", cmd_extraire),
    "verifier": ("Vérification d'une fiche ou de toute la base", cmd_verifier),
    "publier": ("Publication d'un brouillon vérifié", cmd_publier),
    "restaurer": ("Restauration d'une version (par presidentielle.sh)", cmd_restaurer),
    "rattacher": ("Rattachement d'un candidat à une option du quiz", cmd_rattacher),
    "quiz-relire": ("Double lecture d'une question du quiz", cmd_quiz_relire),
    "liste-officielle": ("Passage à la liste officielle", cmd_liste_officielle),
    "phase": ("Passage à l'entre-deux-tours", cmd_phase),
    "surveillance": ("Pages des candidats suivies chaque jour", cmd_surveillance),
    "scrutins": ("Liste des scrutins retenus (vérifier, geler)", cmd_scrutins),
    "votes": ("Votes réels d'un député sur les scrutins retenus", cmd_votes),
    "index": ("Reconstruction de l'index des passages", cmd_index),
    "textes": ("Textes versionnés des documents (rattrapage)", cmd_textes),
}
ARGUMENTS: dict[str, Callable[[argparse.ArgumentParser], None]] = {
    "source": _args_source,
    "extraire": _args_extraire,
    "verifier": _args_verifier,
    "publier": _args_publier,
    "restaurer": _args_restaurer,
    "rattacher": _args_rattacher,
    "quiz-relire": _args_quiz_relire,
    "liste-officielle": _args_liste_officielle,
    "phase": _args_phase,
    "surveillance": _args_surveillance,
    "scrutins": _args_scrutins,
    "votes": _args_votes,
    "textes": _args_textes,
}


def analyseur() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="presidentielle.sh", description="Saisie de la base de la présidentielle"
    )
    sous = parser.add_subparsers(dest="commande", required=True)
    for nom, (aide, fonction) in COMMANDES.items():
        commande = sous.add_parser(nom, help=aide)
        if nom in ARGUMENTS:
            ARGUMENTS[nom](commande)
        if nom in ECRITURES:
            commande.add_argument(
                "--correction",
                metavar="MOTIF",
                help="base archivée seulement : correction inscrite au journal",
            )
        commande.set_defaults(fonction=fonction)
    return parser


def main(argv: list[str] | None = None) -> int:
    global correction_en_cours
    args = analyseur().parse_args(argv)
    try:
        correction_en_cours = garde_archive(args)
        code = args.fonction(args)
        if correction_en_cours and code == 0:
            journaliser_correction(args.commande, correction_en_cours)
            # Index reconstruit sur la version finale (journal compris)
            demander_index(final=True)
        return code
    except Refus as exc:
        print(f"REFUS : {exc}", file=sys.stderr)
        return 2
    finally:
        correction_en_cours = None


if __name__ == "__main__":
    sys.exit(main())
