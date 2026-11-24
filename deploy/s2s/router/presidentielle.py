"""Lecture de la base « Présidentielle 2027 » par le routeur (lecture seule).

Le dossier est monté sous /presidentielle (PRESIDENTIELLE_DIR) ; sans variable, le
jeu fictif fixtures/presidentielle/demo/ est servi. Seuls les fichiers publiés sont lus :
base.yaml, sources.yaml, journal.yaml, candidats/*.yaml, quiz/grille.yaml et
quiz/rattachements.yaml ; jamais brouillons/ ni documents/. Les copies figées des fiches
(historique/) et les textes des documents (textes/) ne sont lus que par la vue
« Évolution » (presidentielle_evolution.py), à la demande.

Une fiche en défaut est écartée, les autres sont servies ; l'erreur est gardée pour le
propriétaire (GET /api/presidentielle/meta). Le résultat est gardé en cache tant que la
date de modification (mtime_ns) et la taille des fichiers publiés ne changent pas.

Version de la base : SHA-256 (12 caractères) des fichiers publiés, triés par chemin.
Couverture d'une question du quiz : au moins la moitié (arrondie au-dessus) des
candidats qui participent (statut declare ou officiel) y ont une position, et au moins
2 options sont occupées.

Phases (lot 5) :
- phase effective : `archive` à partir du lendemain de `archive_apres`, à 0 h heure de
  Paris (base figée : plus aucune écriture, sauf correction journalisée par l'outil) ;
  sinon `base.yaml: phase` (declares, officiel ou entre_tours) ;
- `entre_tours` (et l'archive qui la suit) : seuls les 2 qualifiés participent ; la
  liste, le quiz, l'assistant et l'index ne portent que sur eux (`selon_phase`) ; une
  question est éligible dès qu'un qualifié sur 2 y a une position (le seuil de 10
  questions du rapport ne change pas) ; une mesure ajoutée après le premier tour porte
  la marque « entre les deux tours » (base passée à `entre_tours` seulement).

Thèmes servis (`themes_servis`) : ceux de la grille du quiz, puis les thèmes des fiches
hors quiz (THEMES_HORS_QUIZ, ADR 0016 : culture, solidarites), dans cet ordre ; grille
absente ou en défaut, ceux des mesures publiées, avec le libellé et les mots-clés de
référence (THEMES_REFERENCE, mêmes identifiants que l'outil de saisie) s'ils sont
connus, sinon l'identifiant seul : aucune mesure publiée ne disparaît faute de grille.
Thèmes admis pour une mesure ou un vote : ceux de la grille et les thèmes hors quiz,
qui ne sont jamais dans la grille, ni dans un rattachement, ni dans le quiz.

Forme publiée d'une source et d'une mesure (`source_publiee`, `mesure_publiee`) : une
seule, reprise par la fiche, l'assistant, l'évolution et le quiz (qui lit les mesures
de la fiche).
"""

import hashlib
import math
import os
import threading
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

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
PARIS = ZoneInfo("Europe/Paris")
ARCHIVE = "archive"
ENTRE_TOURS = "entre_tours"
# Avertissement (et non erreur bloquante) : les fiches restent servies. Signalé seulement
# s'il y a des thèmes à vérifier : la grille réelle n'est écrite qu'après les premières
# fiches (TASK-45), une base sans mesure ne doit donc pas l'afficher.
GRILLE_ABSENTE = "grille absente ou illisible : thèmes des mesures non vérifiés"
# Thèmes de référence de l'outil de saisie (presidentielle_tool.THEMES_REFERENCE) :
# identifiant -> (libellé, mots-clés de l'assistant), comme dans la grille du jeu fictif
THEMES_REFERENCE: dict[str, tuple[str, tuple[str, ...]]] = {
    "economie": (
        "Économie et fiscalité",
        ("impôt", "fiscalité", "dette", "déficit", "économie"),
    ),
    "travail": ("Travail et retraites", ("retraite", "travail", "emploi", "salaire")),
    "sante": ("Santé", ("santé", "médecin", "hôpital", "soins")),
    "education": ("Éducation", ("école", "éducation", "enseignant", "classe")),
    "ecologie": (
        "Écologie et énergie",
        ("écologie", "énergie", "climat", "nucléaire", "transport"),
    ),
    "immigration": (
        "Immigration",
        ("immigration", "titre de séjour", "asile", "frontière"),
    ),
    "securite": ("Sécurité et justice", ("sécurité", "police", "justice", "prison")),
    "logement": ("Logement", ("logement", "loyer", "HLM", "immobilier")),
    "institutions": (
        "Institutions et démocratie",
        ("institutions", "référendum", "démocratie", "vote", "Parlement"),
    ),
    "europe": (
        "Europe et international",
        ("Europe", "européen", "international", "défense"),
    ),
    # Thèmes des fiches hors quiz (THEMES_HORS_QUIZ), servis après ceux de la grille
    "culture": (
        "Culture, sport et vie associative",
        # Termes sans double sens : « patrimoine » (fiscalité), « livre » (« livrées »)
        # ou « association » (« de malfaiteurs ») feraient répondre sur ce thème
        (
            "culture",
            "culturel",
            "culturelle",
            "patrimoine culturel",
            "monument",
            "musée",
            "bibliothèque",
            "librairie",
            "spectacle",
            "cinéma",
            "sport",
            "sportif",
            "vie associative",
            "associatif",
            "bénévolat",
        ),
    ),
    "solidarites": (
        "Famille et solidarités",
        # Ni « dépendance » (énergétique), ni « aidant » (participe présent)
        (
            "famille",
            "familial",
            "allocations familiales",
            "enfance",
            "parentalité",
            "pauvreté",
            "minima sociaux",
            "handicap",
            "perte d'autonomie",
            "grand âge",
            "EHPAD",
            "proche aidant",
            "aidants",
        ),
    ),
}
# Thèmes des fiches hors quiz (ADR 0016) : admis pour les mesures et les votes en plus
# de ceux de la grille, jamais dans la grille ; dans cet ordre, après ceux de la grille
THEMES_HORS_QUIZ = schema.THEMES_HORS_QUIZ

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
    # Lignée des programmes (remplace) en défaut : la source qui la porte est écartée
    refusees += schema.controler_lignee(sources)
    erreurs.extend(schema.Erreur("sources.yaml", m) for _, m in refusees)
    exclues = {source_id for source_id, _ in refusees}
    etat.sources = {s.id: s for s in sources if s.id not in exclues}
    erreurs.extend(
        schema.Erreur("base.yaml", m) for m in schema.controler_base(base, etat.sources)
    )

    journal = lire(schema.Journal, "journal.yaml")
    etat.journal = list(journal.entrees) if journal else []
    grille = lire(schema.Grille, "quiz/grille.yaml")
    themes = _themes_connus(racine, grille, "quiz/grille.yaml" in publies)

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
        # Thèmes contrôlés après la grille : une grille en défaut ne doit écarter
        # aucune fiche (cf. plus bas)
        problemes = schema.controler_fiche(fiche, base, etat.sources, None)
        if problemes:
            erreurs.extend(schema.Erreur(nom, m) for m in problemes)
            ecartees.append(fiche.id)
            identites_ecartees.append(schema.identite(fiche))
            continue
        etat.fiches[fiche.id] = fiche
    if themes is None and any(
        fiche.mesures or any(v.theme for v in fiche.votes)
        for fiche in etat.fiches.values()
    ):
        erreurs.append(schema.Erreur("quiz/grille.yaml", GRILLE_ABSENTE))

    if grille is not None:
        identites = [schema.identite(f) for f in etat.fiches.values()]
        problemes = schema.controler_grille(
            grille, identites + identites_ecartees, base.partis, journal
        )
        if problemes:
            erreurs.extend(schema.Erreur("quiz/grille.yaml", m) for m in problemes)
            grille = None
    etat.grille = grille

    # Thèmes des mesures et des votes : contre une grille valide, un thème inconnu
    # écarte la fiche (erreur de saisie) ; grille en défaut ou absente, il est seulement
    # signalé au propriétaire et la mesure reste servie (thèmes déduits des mesures)
    if themes is not None:
        for slug in sorted(etat.fiches):
            fiche = etat.fiches[slug]
            nom = schema.fichier_fiche(slug)
            inconnus = [
                f"mesure {m.id} : thème « {m.theme} » inconnu"
                for m in fiche.mesures
                if m.theme not in themes
            ] + [
                f"vote {v.id} : thème « {v.theme} » inconnu"
                for v in fiche.votes
                if v.theme and v.theme not in themes
            ]
            if not inconnus:
                continue
            if grille is not None:
                erreurs.extend(schema.Erreur(nom, m) for m in inconnus)
                del etat.fiches[slug]
                ecartees.append(slug)
            else:
                erreurs.extend(
                    schema.Erreur(nom, f"{m} (grille en défaut : mesure servie)")
                    for m in inconnus
                )

    if base.phase == ENTRE_TOURS:
        erreurs.extend(
            schema.Erreur("base.yaml", f"qualifié « {slug} » sans fiche publiée")
            for slug in base.qualifies
            if slug not in etat.fiches
        )

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
    racine: Path, grille: schema.Grille | None, lisible: bool
) -> set[str] | None:
    """Thèmes contre lesquels vérifier les mesures : ceux de la grille, sinon ceux lus
    dans une grille en défaut, plus les thèmes hors quiz ; None si aucun (absence
    signalée par l'appelant)."""
    if grille is not None:
        return schema.themes_admis(t.id for t in grille.themes)
    if lisible:
        try:
            return schema.themes_admis(
                schema.themes_bruts(
                    schema.lire_yaml(racine / "quiz/grille.yaml", "quiz/grille.yaml")
                )
            )
        except schema.ErreurFichier:
            return None
    return None


def jour_paris(maintenant: datetime | None = None) -> date:
    """Jour calendaire à Paris (une heure sans fuseau est lue en UTC)."""
    moment = maintenant or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(PARIS).date()


def phase_effective(
    base: schema.Base | None, maintenant: datetime | None = None
) -> str | None:
    """`archive` dès le lendemain de `archive_apres` (0 h, heure de Paris), sinon la
    phase écrite dans base.yaml ; None sans base."""
    if base is None:
        return None
    return phase_le(base, jour_paris(maintenant))


def phase_le(base: schema.Base, jour: date) -> str:
    """Phase effective un jour donné (calendrier de Paris)."""
    return ARCHIVE if jour > base.archive_apres else base.phase


def entre_tours(etat: Etat) -> bool:
    """Base passée à l'entre-deux-tours (archive comprise : la base reste figée sur les
    2 qualifiés)."""
    return etat.base is not None and etat.base.phase == ENTRE_TOURS


def participants(etat: Etat) -> list[str]:
    """Candidats qui participent au quiz, triés : les 2 qualifiés entre les tours,
    sinon les candidats declare ou officiel."""
    if entre_tours(etat):
        assert etat.base is not None
        return sorted(s for s in set(etat.base.qualifies) if s in etat.fiches)
    return sorted(s for s, f in etat.fiches.items() if f.statut in PARTICIPANTS)


def selon_phase(etat: Etat) -> Etat:
    """Vue servie aux visiteurs : entre les tours, fiches et rattachements des 2
    qualifiés seulement (liste, quiz, assistant, index) ; sinon l'état tel quel. Les
    erreurs, le journal et la version restent ceux de toute la base."""
    if not entre_tours(etat):
        return etat
    qui = set(participants(etat))
    return replace(
        etat,
        fiches={s: f for s, f in etat.fiches.items() if s in qui},
        rattachements=[r for r in etat.rattachements if r.candidat in qui],
    )


def mesure_entre_tours(base: schema.Base | None, ajoutee_le: date) -> bool:
    """Mesure ajoutée après le premier tour, et avant l'archive, d'une base passée à
    l'entre-deux-tours : marque « entre les deux tours » (une correction de mai 2027
    ne la reçoit pas ; sans entre-deux-tours enregistré, aucune marque)."""
    return (
        base is not None
        and base.phase == ENTRE_TOURS
        and base.tours.premier < ajoutee_le <= base.archive_apres
    )


@dataclass(frozen=True)
class ThemeServi:
    id: str
    libelle: str
    mots_cles: tuple[str, ...] = ()
    # Axe de la grille ; None pour un thème déduit des mesures (pas de grille) ou hors
    # quiz
    axe: dict | None = None
    # Thème des fiches hors quiz (THEMES_HORS_QUIZ) : ni question, ni axe, ni rapport
    hors_quiz: bool = False


def themes_servis(etat: Etat) -> list[ThemeServi]:
    """Thèmes de la grille, dans son ordre, puis les thèmes hors quiz (THEMES_HORS_QUIZ,
    dans cet ordre) ; grille absente ou en défaut : thèmes des mesures publiées, ceux
    de référence d'abord (dans leur ordre, hors quiz en dernier parmi eux), puis les autres
    (identifiant seul), par ordre alphabétique."""
    if etat.grille is not None:
        return [
            ThemeServi(t.id, t.libelle, tuple(t.mots_cles), t.axe.model_dump())
            for t in etat.grille.themes
        ] + [
            ThemeServi(t, *THEMES_REFERENCE[t], hors_quiz=True)
            for t in THEMES_HORS_QUIZ
        ]
    presents = {m.theme for f in etat.fiches.values() for m in f.mesures}
    connus = [
        ThemeServi(t, libelle, mots, hors_quiz=t in THEMES_HORS_QUIZ)
        for t, (libelle, mots) in THEMES_REFERENCE.items()
        if t in presents
    ]
    return connus + [ThemeServi(t, t) for t in sorted(presents - set(THEMES_REFERENCE))]


def libelle_theme(etat: Etat, theme_id: str) -> str:
    """Libellé d'un thème : grille, sinon référence, sinon l'identifiant."""
    if etat.grille is not None:
        for theme in etat.grille.themes:
            if theme.id == theme_id:
                return theme.libelle
    reference = THEMES_REFERENCE.get(theme_id)
    return reference[0] if reference else theme_id


def source_publiee(etat: Etat, source_id: str) -> dict | None:
    """Forme publiée d'une source citée ; None si elle n'est pas (plus) servie."""
    found = etat.sources.get(source_id)
    if found is None:
        return None
    return {
        "id": found.id,
        "titre": found.titre,
        "url": found.url,
        "niveau": found.niveau,
        "publie_le": found.publie_le.isoformat() if found.publie_le else None,
        "consulte_le": found.consulte_le.isoformat(),
    }


def mesure_publiee(etat: Etat, mesure: schema.Mesure) -> dict:
    """Forme publiée d'une mesure : fiche, assistant, évolution et quiz."""
    return {
        "id": mesure.id,
        "theme": mesure.theme,
        "theme_libelle": libelle_theme(etat, mesure.theme),
        "citation": mesure.citation,
        "nature": "candidat",
        "resume": mesure.resume,
        "source": source_publiee(etat, mesure.source_id),
        "page": mesure.page,
        "ajoutee_le": mesure.ajoutee_le.isoformat(),
        "entre_tours": mesure_entre_tours(etat.base, mesure.ajoutee_le),
    }


def couverture(etat: Etat, question_id: str) -> dict:
    """Positions des participants sur une question, et éligibilité au quiz : la moitié
    des participants (arrondie au-dessus) et 2 options occupées ; entre les tours, un
    qualifié sur 2 suffit."""
    qui = set(participants(etat))
    positions = {
        r.candidat: r.option
        for r in etat.rattachements
        if r.question == question_id and r.candidat in qui
    }
    occupees = len(set(positions.values()))
    seuil = math.ceil(len(qui) / 2)
    options_min = 1 if entre_tours(etat) else 2
    return {
        "participants": len(qui),
        "positions": len(positions),
        "options_occupees": occupees,
        "eligible": bool(qui) and len(positions) >= seuil and occupees >= options_min,
    }


def relire(racine: Path) -> Etat:
    """État de la base relu sans cache (outil de saisie : écritures rapprochées)."""
    return _lire(racine, fichiers_publies(racine))


def controle_ensemble(racine: Path) -> list[schema.Erreur]:
    """Toutes les erreurs d'une base (relue sans cache) : vide si le jeu est valide."""
    return relire(racine).erreurs
