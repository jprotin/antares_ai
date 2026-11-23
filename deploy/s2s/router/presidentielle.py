"""Lecture de la base « Présidentielle 2027 » par le routeur (lecture seule).

Le dossier est monté sous /presidentielle (PRESIDENTIELLE_DIR) ; sans variable, le
jeu fictif fixtures/presidentielle/demo/ est servi. Seuls les fichiers publiés sont lus :
base.yaml, sources.yaml, journal.yaml, candidats/*.yaml, quiz/grille.yaml et
quiz/rattachements.yaml ; jamais brouillons/ ni documents/.

Une fiche en défaut est écartée, les autres sont servies ; l'erreur est gardée pour le
propriétaire (GET /api/presidentielle/meta). Le résultat est gardé en cache tant que la
date de modification (mtime_ns) et la taille des fichiers publiés ne changent pas.

Version de la base : SHA-256 (12 caractères) des fichiers publiés, triés par chemin.
Couverture d'une question du quiz : au moins la moitié (arrondie au-dessus) des
candidats qui participent (statut declare ou officiel) y ont une position, et au moins
2 options sont occupées.
"""

import hashlib
import math
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

import presidentielle_schema as schema

DEMO = Path(__file__).parent / "fixtures" / "presidentielle" / "demo"
FICHIERS = (
    "base.yaml",
    "sources.yaml",
    "journal.yaml",
    "quiz/grille.yaml",
    "quiz/rattachements.yaml",
)
PARTICIPANTS = ("declare", "officiel")

_cache: dict[Path, tuple[tuple, "Etat"]] = {}
_verrou = threading.Lock()


def dossier() -> Path:
    """Dossier de la base : PRESIDENTIELLE_DIR, sinon le jeu fictif."""
    valeur = os.environ.get("PRESIDENTIELLE_DIR", "").strip()
    return Path(valeur) if valeur else DEMO


@dataclass
class Etat:
    dossier: Path
    # Message clair quand la base n'est pas servie (dossier absent ou vide, base.yaml
    # en défaut) ; "" sinon
    message: str = ""
    base: schema.Base | None = None
    sources: dict[str, schema.Source] = field(default_factory=dict)
    fiches: dict[str, schema.Fiche] = field(default_factory=dict)
    grille: schema.Grille | None = None
    rattachements: list[schema.Rattachement] = field(default_factory=list)
    journal: list[schema.EntreeJournal] = field(default_factory=list)
    erreurs: list[schema.Erreur] = field(default_factory=list)
    version: str = ""


def _inventaire(racine: Path) -> tuple[list[str], list[str]]:
    """(fichiers publiés lisibles, fichiers refusés), chemins relatifs triés. Un lien
    symbolique, ou un chemin qui sort du dossier de la base, est refusé."""
    interieur = racine.resolve()
    trouves = [nom for nom in FICHIERS if (racine / nom).is_file()]
    candidats = racine / "candidats"
    if candidats.is_dir() and not candidats.is_symlink():
        trouves += [
            f"candidats/{entry.name}"
            for entry in os.scandir(candidats)
            if entry.name.endswith(".yaml")
            and (entry.is_symlink() or entry.is_file(follow_symlinks=False))
        ]
    noms: list[str] = []
    refuses: list[str] = []
    for nom in trouves:
        path = racine / nom
        dehors = not path.resolve().is_relative_to(interieur)
        (refuses if path.is_symlink() or dehors else noms).append(nom)
    return sorted(noms), sorted(refuses)


def fichiers_publies(racine: Path) -> list[str]:
    """Chemins relatifs des fichiers publiés présents, triés (liens symboliques exclus)."""
    return _inventaire(racine)[0]


def version_de(racine: Path, noms: list[str]) -> str:
    """Empreinte des fichiers publiés, indépendante de l'ordre de lecture."""
    total = hashlib.sha256()
    for nom in sorted(noms):
        contenu = (racine / nom).read_bytes()
        total.update(nom.encode("utf-8") + b"\0" + hashlib.sha256(contenu).digest())
    return total.hexdigest()[:12]


def _signature(racine: Path, noms: list[str]) -> tuple:
    signature = []
    for nom in noms:
        try:
            stat = (racine / nom).stat()
        except OSError:
            continue
        signature.append((nom, stat.st_mtime_ns, stat.st_size))
    return tuple(signature)


def charger(racine: Path | None = None) -> Etat:
    """État de la base, relu seulement si un fichier publié a changé."""
    racine = racine or dossier()
    if not racine.is_dir():
        return Etat(racine, message=f"Base introuvable ({racine.name or racine})")
    noms = fichiers_publies(racine)
    if not noms:
        return Etat(racine, message="Base vide : aucun fichier publié")
    signature = _signature(racine, noms)
    with _verrou:
        cached = _cache.get(racine)
        if cached and cached[0] == signature:
            return cached[1]
        etat = _lire(racine, noms)
        _cache[racine] = (signature, etat)
        return etat


def _lire(racine: Path, noms: list[str]) -> Etat:
    etat = Etat(racine)
    erreurs = etat.erreurs

    # Seuls les fichiers de l'inventaire sont lus (ni lien symbolique, ni chemin hors base)
    publies = set(noms)

    def lire(modele, nom):
        path = racine / nom
        if nom not in publies:
            return None
        try:
            return schema.charger(modele, path, nom)
        except schema.ErreurFichier as exc:
            erreurs.append(exc.erreur)
            return None

    erreurs.extend(
        schema.Erreur(nom, "lien symbolique ou chemin hors de la base : ignoré")
        for nom in _inventaire(racine)[1]
    )
    base = lire(schema.Base, "base.yaml")
    if base is None:
        if not any(e.fichier == "base.yaml" for e in erreurs):
            erreurs.append(schema.Erreur("base.yaml", "fichier absent"))
        etat.message = "base.yaml absent ou en défaut : base non servie"
        etat.version = version_de(racine, noms)
        return etat
    etat.base = base

    sources: list[schema.Source] = []
    if "sources.yaml" in publies:
        try:
            sources, refus = schema.charger_sources(
                racine / "sources.yaml", "sources.yaml"
            )
            erreurs.extend(refus)
        except schema.ErreurFichier as exc:
            erreurs.append(exc.erreur)
    refusees = schema.controler_sources(base, sources)
    erreurs.extend(schema.Erreur("sources.yaml", m) for _, m in refusees)
    exclues = {source_id for source_id, _ in refusees}
    etat.sources = {s.id: s for s in sources if s.id not in exclues}
    erreurs.extend(
        schema.Erreur("base.yaml", m) for m in schema.controler_base(base, etat.sources)
    )

    journal = lire(schema.Journal, "journal.yaml")
    etat.journal = list(journal.entrees) if journal else []
    grille = lire(schema.Grille, "quiz/grille.yaml")
    themes = _themes_connus(racine, grille, erreurs, "quiz/grille.yaml" in publies)

    ecartees: list[str] = []
    # Noms des fiches écartées, encore interdits dans la grille
    identites_ecartees: list[schema.Identite] = []
    for nom in noms:
        if not nom.startswith("candidats/"):
            continue
        try:
            fiche = schema.charger_fiche(racine / nom, nom)
        except schema.ErreurFichier as exc:
            erreurs.append(exc.erreur)
            ecartees.append(Path(nom).stem)
            identites_ecartees += _identite_brute(racine / nom, nom)
            continue
        problemes = schema.controler_fiche(fiche, base, etat.sources, themes)
        if problemes:
            erreurs.extend(schema.Erreur(nom, m) for m in problemes)
            ecartees.append(fiche.id)
            identites_ecartees.append(schema.identite(fiche))
            continue
        etat.fiches[fiche.id] = fiche

    if grille is not None:
        identites = [schema.identite(f) for f in etat.fiches.values()]
        problemes = schema.controler_grille(
            grille, identites + identites_ecartees, base.partis, journal
        )
        if problemes:
            erreurs.extend(schema.Erreur("quiz/grille.yaml", m) for m in problemes)
            grille = None
    etat.grille = grille

    rattachements = lire(schema.Rattachements, "quiz/rattachements.yaml")
    if rattachements is not None and grille is not None:
        en_defaut = schema.controler_rattachements(
            rattachements, grille, etat.fiches, ecartees
        )
        erreurs.extend(
            schema.Erreur("quiz/rattachements.yaml", m) for _, m in en_defaut
        )
        refuses = {rang for rang, _ in en_defaut}
        etat.rattachements = [
            r
            for rang, r in enumerate(rattachements.rattachements)
            if rang not in refuses and r.candidat in etat.fiches
        ]
    etat.version = version_de(racine, noms)
    return etat


def _identite_brute(path: Path, nom: str) -> list[schema.Identite]:
    try:
        found = schema.identite_brute(schema.lire_yaml(path, nom))
    except schema.ErreurFichier:
        return []
    return [found] if found else []


def _themes_connus(
    racine: Path,
    grille: schema.Grille | None,
    erreurs: list[schema.Erreur],
    lisible: bool,
) -> set[str] | None:
    """Thèmes contre lesquels vérifier les mesures : ceux de la grille, sinon ceux lus
    dans une grille en défaut ; à défaut, l'absence de vérification est signalée."""
    if grille is not None:
        return {t.id for t in grille.themes}
    path = racine / "quiz/grille.yaml"
    if lisible:
        try:
            themes = schema.themes_bruts(schema.lire_yaml(path, "quiz/grille.yaml"))
        except schema.ErreurFichier:
            themes = None
        if themes:
            return themes
    erreurs.append(
        schema.Erreur(
            "quiz/grille.yaml",
            "grille absente ou illisible : thèmes des mesures non vérifiés",
        )
    )
    return None


def participants(etat: Etat) -> list[str]:
    """Candidats qui participent au quiz (declare ou officiel), triés."""
    return sorted(s for s, f in etat.fiches.items() if f.statut in PARTICIPANTS)


def couverture(etat: Etat, question_id: str) -> dict:
    """Positions des participants sur une question, et éligibilité au quiz."""
    qui = set(participants(etat))
    positions = {
        r.candidat: r.option
        for r in etat.rattachements
        if r.question == question_id and r.candidat in qui
    }
    occupees = len(set(positions.values()))
    seuil = math.ceil(len(qui) / 2)
    return {
        "participants": len(qui),
        "positions": len(positions),
        "options_occupees": occupees,
        "eligible": bool(qui) and len(positions) >= seuil and occupees >= 2,
    }


def controle_ensemble(racine: Path) -> list[schema.Erreur]:
    """Toutes les erreurs d'une base (relue sans cache) : vide si le jeu est valide."""
    noms = fichiers_publies(racine)
    return _lire(racine, noms).erreurs
