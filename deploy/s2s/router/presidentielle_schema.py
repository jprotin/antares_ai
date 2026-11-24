"""Schéma de la base « Présidentielle 2027 » (fiches, sources, grille du quiz,
rattachements, journal) et lecture YAML stricte.

Chaque fichier a son modèle pydantic ; les règles qui croisent plusieurs fichiers
(références, niveaux de source, noms interdits dans la grille, jeu fictif ou réel, gel
de la grille) sont dans les fonctions `controler_*`, qui renvoient des erreurs nommant
le fichier au lieu de lever une exception : le routeur écarte la fiche en défaut et
sert les autres (cf. presidentielle.py).

Les schémas JSON destinés à l'éditeur sont générés par `exporter_schemas()` et
versionnés dans fixtures/presidentielle/schemas/ (test de synchronisation).
"""

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

import yaml  # type: ignore[import-untyped]  # stubs absents de l'image et du hook
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

# Identifiant : minuscules, chiffres et tirets (nom de fichier, doc_id p27:<slug>:<id>)
IDENTIFIANT = r"^[a-z0-9]+(-[a-z0-9]+)*$"
INITIALES = r"^[A-Z]{2,4}$"
# Seul gemma4:e4b, derrière un fournisseur nommé (cf. presidentielle_common.modele_autorise)
MODELE_AUTORISE = r"^[a-z0-9][a-z0-9-]*/gemma4:e4b$"
MODELES_PAR_DEFAUT = ["litellm-ai-to-boost/gemma4:e4b", "ollama/gemma4:e4b"]
DOMAINE_FICTIF = "exemple.invalid"
# Sites des scrutins de l'Assemblée nationale (quiz/scrutins.yaml)
DOMAINES_AN = frozenset(
    {
        "www.assemblee-nationale.fr",
        "assemblee-nationale.fr",
        "data.assemblee-nationale.fr",
    }
)
DESCRIPTION_MAX = 300
LIGNES_PHARES_MAX = 5
THEMES = 10
# Thèmes des fiches hors quiz (ADR 0016) : admis pour les mesures et les votes en plus
# de ceux de la grille, jamais dans la grille ni dans un rattachement (poids égal des
# 10 thèmes du quiz inchangé)
THEMES_HORS_QUIZ = ("culture", "solidarites")
QUESTIONS_PAR_THEME = 2
OPTIONS_MIN, OPTIONS_MAX = 3, 5
# Options toujours présentes, en fin de liste dans le quiz
AUCUNE, SANS_AVIS = "aucune", "sans-avis"
OPTIONS_SPECIALES = {AUCUNE: "Aucune de ces propositions", SANS_AVIS: "Sans avis"}
# Niveaux admis selon l'usage (« presse » et « repérage » n'existent pas)
NIVEAUX_MESURE = {"officiel_etat", "candidat"}
NIVEAUX_VOTE = {"vote_reel"}
# Mots d'un nom trop courants pour être interdits seuls dans la grille
PARTICULES = {"de", "du", "des", "la", "le", "les", "d", "l", "van", "von", "da", "di"}

Niveau = Literal["officiel_etat", "candidat", "vote_reel"]
Statut = Literal["declare", "officiel", "retire", "non_qualifie"]
StatutAxes = Literal["brouillon", "validee", "gelee"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# --- Base -------------------------------------------------------------------------


class Tours(Strict):
    premier: date
    second: date


class Assistant(Strict):
    modeles_autorises: list[str] = Field(
        default_factory=lambda: list(MODELES_PAR_DEFAUT)
    )

    @field_validator("modeles_autorises")
    @classmethod
    def seulement_gemma(cls, value: list[str]) -> list[str]:
        for name in value:
            if not re.fullmatch(MODELE_AUTORISE, name):
                raise ValueError(
                    f"modèle « {name} » refusé : seul <fournisseur>/gemma4:e4b est admis"
                )
        return value


class Base(Strict):
    jeu: Literal["demonstration", "reel"]
    liste: Literal["declares", "officielle"] = "declares"
    liste_source: str | None = None
    phase: Literal["declares", "officiel", "entre_tours"] = "declares"
    qualifies: list[str] = []
    archive_apres: date
    tours: Tours
    partis: list[str] = []
    assistant: Assistant = Field(default_factory=Assistant)

    @model_validator(mode="after")
    def coherence(self) -> "Base":
        if self.liste == "officielle" and not self.liste_source:
            raise ValueError("liste officielle sans liste_source")
        if self.phase == "entre_tours" and (
            len(self.qualifies) != 2 or len(set(self.qualifies)) != 2
        ):
            raise ValueError("phase entre_tours : 2 qualifiés attendus")
        if self.qualifies and self.phase != "entre_tours":
            raise ValueError("qualifies n'a de sens qu'en phase entre_tours")
        return self


# --- Sources ----------------------------------------------------------------------


def adresse_https(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError(f"adresse non https refusée : {value[:80]}")
    return value


def domaine_fictif(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host == DOMAINE_FICTIF or host.endswith("." + DOMAINE_FICTIF)


Lecture = Literal["ordre", "brute"]
LECTURES: tuple[str, ...] = ("ordre", "brute")


class Source(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    titre: str = Field(min_length=1)
    url: Annotated[str, AfterValidator(adresse_https)]
    niveau: Niveau
    publie_le: date | None = None
    consulte_le: date
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    candidat: str | None = Field(default=None, pattern=IDENTIFIANT)
    # Lignée des documents de programme : identifiant de la version précédente du même
    # document (source ajouter --remplace) ; contrôlée par `controler_lignee`
    remplace: str | None = Field(default=None, pattern=IDENTIFIANT)
    # Lecture d'un PDF par pdftotext : `ordre` (défaut, ordre de lecture, colonne par
    # colonne) ; `brute` (-raw, ordre du flux du PDF) quand les colonnes restent mêlées
    # dans l'ordre de lecture (source ajouter --lecture, source lecture)
    lecture: Lecture = "ordre"

    @model_validator(mode="after")
    def candidat_du_document(self) -> "Source":
        if self.niveau == "candidat" and not self.candidat:
            raise ValueError(f"source {self.id} : niveau candidat sans candidat")
        if self.remplace == self.id:
            raise ValueError(f"source {self.id} : se remplace elle-même")
        return self


class Sources(Strict):
    sources: list[Source]

    @model_validator(mode="after")
    def identifiants_uniques(self) -> "Sources":
        doubles = _doublons(s.id for s in self.sources)
        if doubles:
            raise ValueError(f"identifiants de source en double : {', '.join(doubles)}")
        return self


# --- Fiche candidat ---------------------------------------------------------------


class Declaration(Strict):
    date: date
    source_id: str


class Description(Strict):
    texte: str = Field(min_length=1, max_length=DESCRIPTION_MAX)
    # Texte de la rédaction, jamais attribué au candidat
    nature: Literal["redaction"] = "redaction"


class LignePhare(Strict):
    texte: str = Field(min_length=1)
    source_id: str


class Mesure(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    theme: str = Field(pattern=IDENTIFIANT)
    citation: str = Field(min_length=1)
    resume: str | None = None
    source_id: str
    page: int | None = Field(default=None, ge=1)
    ajoutee_le: date
    a_verifier: bool = False


class Vote(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    scrutin: str = Field(min_length=1)
    date: date
    # Scrutin public de l'Assemblée (votes importer, lot 4b) : `non_votant` = inscrit
    # parmi les non-votants (présidence de séance, membre du gouvernement…) ;
    # `sans_vote` = aucun vote enregistré (absence, mandat non en cours à cette date)
    position: Literal["pour", "contre", "abstention", "non_votant", "sans_vote"]
    theme: str | None = Field(default=None, pattern=IDENTIFIANT)
    source_id: str


class Fiche(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    nom_affiche: str = Field(min_length=1)
    initiales: str = Field(pattern=INITIALES)
    alias: list[str] = []
    # Fiche du jeu de démonstration (personne inventée)
    fictif: bool = False
    statut: Statut
    statut_source: str
    declaration: Declaration
    description: Description
    lignes_phares: list[LignePhare] = Field(default=[], max_length=LIGNES_PHARES_MAX)
    mesures: list[Mesure] = []
    parlementaire: bool = False
    votes: list[Vote] = []
    version: int = Field(ge=1)
    mise_a_jour: date
    relue_le: date | None = None

    @model_validator(mode="after")
    def identifiants_uniques(self) -> "Fiche":
        doubles = _doublons([m.id for m in self.mesures] + [v.id for v in self.votes])
        if doubles:
            raise ValueError(f"identifiants en double : {', '.join(doubles)}")
        if self.votes and not self.parlementaire:
            raise ValueError("votes sur une fiche non parlementaire")
        return self


# --- Grille du quiz ---------------------------------------------------------------


class Axe(Strict):
    pole_a: str = Field(min_length=1)
    pole_b: str = Field(min_length=1)


class Option(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    libelle: str = Field(min_length=1)
    # Place sur l'axe du thème ; aucune pour « aucune » et « sans avis »
    pole: Literal["a", "b", "mixte"] | None = None

    @property
    def speciale(self) -> bool:
        return self.id in OPTIONS_SPECIALES


class Question(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    enonce: str = Field(min_length=1)
    statut: Literal["brouillon", "validee"] = "brouillon"
    options: list[Option]

    @model_validator(mode="after")
    def options_valides(self) -> "Question":
        doubles = _doublons(o.id for o in self.options)
        if doubles:
            raise ValueError(f"options en double : {', '.join(doubles)}")
        ids = {o.id for o in self.options}
        for special, libelle in OPTIONS_SPECIALES.items():
            if special not in ids:
                raise ValueError(f"option « {libelle} » ({special}) absente")
        ordinaires = [o for o in self.options if not o.speciale]
        if not OPTIONS_MIN <= len(ordinaires) <= OPTIONS_MAX:
            raise ValueError(
                f"{len(ordinaires)} options : {OPTIONS_MIN} à {OPTIONS_MAX} attendues,"
                " en plus de « aucune » et « sans avis »"
            )
        for option in self.options:
            if option.speciale:
                if option.libelle != OPTIONS_SPECIALES[option.id] or option.pole:
                    raise ValueError(
                        f"option {option.id} : libellé « {OPTIONS_SPECIALES[option.id]} »"
                        " imposé, sans pôle"
                    )
            elif option.pole is None:
                raise ValueError(f"option {option.id} sans pôle (a, b ou mixte)")
        return self


class Theme(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    libelle: str = Field(min_length=1)
    # Mots qui désignent le thème dans une question à l'assistant (lot 2)
    mots_cles: list[str] = []
    axe: Axe
    questions: list[Question]

    @field_validator("questions")
    @classmethod
    def deux_questions(cls, value: list[Question]) -> list[Question]:
        if len(value) != QUESTIONS_PAR_THEME:
            raise ValueError(
                f"{len(value)} questions : {QUESTIONS_PAR_THEME} par thème (poids égal)"
            )
        return value


class Gel(Strict):
    le: date
    # « sha256:<64 hexadécimaux> » de la grille au gel (cf. empreinte_grille)
    empreinte: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class Grille(Strict):
    axes_statut: StatutAxes = "brouillon"
    gel: Gel | None = None
    themes: list[Theme]

    @field_validator("themes")
    @classmethod
    def dix_themes(cls, value: list[Theme]) -> list[Theme]:
        if len(value) != THEMES:
            raise ValueError(f"{len(value)} thèmes : {THEMES} attendus (poids égal)")
        return value

    @model_validator(mode="after")
    def axes_geles_avec_gel(self) -> "Grille":
        if self.axes_statut == "gelee" and self.gel is None:
            raise ValueError("axes_statut gelee sans gel de la grille")
        return self

    @model_validator(mode="after")
    def identifiants_uniques(self) -> "Grille":
        doubles = _doublons(
            [t.id for t in self.themes]
            + [q.id for t in self.themes for q in t.questions]
        )
        if doubles:
            raise ValueError(f"identifiants en double : {', '.join(doubles)}")
        return self

    @property
    def barres_visibles(self) -> bool:
        """Barres à deux pôles : seulement une fois les axes gelés."""
        return self.axes_statut == "gelee"

    def question(self, question_id: str) -> tuple[Theme, Question] | None:
        for theme in self.themes:
            for question in theme.questions:
                if question.id == question_id:
                    return theme, question
        return None


def empreinte_grille(grille: Grille) -> str:
    """Empreinte des thèmes, axes, questions et options (hors gel et statut des axes)."""
    contenu = grille.model_dump(mode="json", exclude={"gel", "axes_statut"})
    texte = json.dumps(contenu, sort_keys=True, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(texte.encode("utf-8")).hexdigest()


# --- Rattachements et journal -----------------------------------------------------


class Rattachement(Strict):
    question: str = Field(pattern=IDENTIFIANT)
    candidat: str = Field(pattern=IDENTIFIANT)
    option: str = Field(pattern=IDENTIFIANT)
    mesure_id: str = Field(pattern=IDENTIFIANT)


class Rattachements(Strict):
    rattachements: list[Rattachement] = []


class EntreeJournal(Strict):
    date: date
    objet: Literal["fiche", "rattachement", "gel_grille", "correction_grille", "base"]
    cible: str | None = None
    version: int | None = None
    motif: str = Field(min_length=1)
    # Gel ou correction de grille : empreinte de la grille gelée ou corrigée
    empreinte: str | None = Field(default=None, pattern=r"^sha256:[0-9a-f]{64}$")
    # Publication d'une fiche : mesures retirées parce qu'erronées (citation fausse,
    # mal attribuée, hors contexte) ; la vue « Évolution » n'en montre plus le texte
    # (publier --retrait-erreur)
    retraits_erreur: list[Annotated[str, Field(pattern=IDENTIFIANT)]] | None = None

    @model_validator(mode="after")
    def grille_avec_empreinte(self) -> "EntreeJournal":
        if self.objet in ("gel_grille", "correction_grille") and not self.empreinte:
            raise ValueError(f"{self.objet} sans empreinte")
        return self

    @model_validator(mode="after")
    def retraits_d_une_fiche(self) -> "EntreeJournal":
        if self.retraits_erreur is None:
            return self
        if self.objet != "fiche" or not self.cible or not self.version:
            raise ValueError("retraits_erreur réservé à la publication d'une fiche")
        if not self.retraits_erreur:
            raise ValueError("retraits_erreur vide")
        doubles = _doublons(self.retraits_erreur)
        if doubles:
            raise ValueError(f"retraits_erreur en double : {', '.join(doubles)}")
        return self


class Journal(Strict):
    entrees: list[EntreeJournal] = []


# --- Pages suivies (surveillance.yaml, lot 4b) --------------------------------------


class PageSuivie(Strict):
    url: Annotated[str, AfterValidator(adresse_https)]
    candidat: str = Field(pattern=IDENTIFIANT)
    ajoutee_le: date


class Surveillance(Strict):
    """Pages des candidats suivies chaque jour ; écrit par l'outil de saisie
    (surveillance ajouter, retirer, geler), lu par la tâche presidentielle-watch."""

    pages: list[PageSuivie] = []
    # Liste validée par l'utilisateur ; une modification la dégèle
    gelee_le: date | None = None

    @model_validator(mode="after")
    def adresses_uniques(self) -> "Surveillance":
        doubles = _doublons(p.url for p in self.pages)
        if doubles:
            raise ValueError(f"pages en double : {', '.join(doubles)}")
        return self


# --- Scrutins retenus (quiz/scrutins.yaml, lot 4b) ----------------------------------


def adresse_assemblee(value: str) -> str:
    """Lien https vers le site de l'Assemblée nationale (ou le domaine fictif du jeu de
    démonstration, contrôlé ensuite selon le jeu par l'outil de saisie)."""
    adresse_https(value)
    host = (urlsplit(value).hostname or "").lower()
    if host not in DOMAINES_AN and not domaine_fictif(value):
        raise ValueError(f"lien hors du site de l'Assemblée nationale : {value[:80]}")
    return value


class ScrutinRetenu(Strict):
    id: str = Field(pattern=IDENTIFIANT)
    theme: str = Field(pattern=IDENTIFIANT)
    legislature: int = Field(ge=1, le=99)
    numero: int = Field(ge=1)
    date: date
    titre: str = Field(min_length=1, max_length=300)
    url: Annotated[str, AfterValidator(adresse_assemblee)]

    @property
    def uid(self) -> str:
        """Identifiant du scrutin dans les données ouvertes (VTANR5L17V1234)."""
        return f"VTANR5L{self.legislature}V{self.numero}"


class Scrutins(Strict):
    """Scrutins de l'Assemblée retenus, par thème, fixés avant de regarder les
    candidats ; la même liste vaut pour tous les parlementaires (votes importer)."""

    scrutins: list[ScrutinRetenu] = []
    # Liste validée par l'utilisateur (scrutins geler) ; une modification la dégèle
    gelee_le: date | None = None

    @model_validator(mode="after")
    def uniques(self) -> "Scrutins":
        doubles = _doublons(s.id for s in self.scrutins)
        if doubles:
            raise ValueError(
                f"identifiants de scrutin en double : {', '.join(doubles)}"
            )
        doubles = _doublons(s.uid for s in self.scrutins)
        if doubles:
            raise ValueError(f"scrutins en double : {', '.join(doubles)}")
        return self


MODELES: dict[str, type[BaseModel]] = {
    "base": Base,
    "sources": Sources,
    "fiche": Fiche,
    "grille": Grille,
    "rattachements": Rattachements,
    "journal": Journal,
    "scrutins": Scrutins,
}


# --- Lecture stricte --------------------------------------------------------------


@dataclass(frozen=True)
class Erreur:
    """Erreur de données, rattachée au fichier (chemin relatif à la base)."""

    fichier: str
    message: str

    def as_dict(self) -> dict:
        return {"fichier": self.fichier, "message": self.message}


class ErreurFichier(Exception):
    def __init__(self, fichier: str, message: str):
        super().__init__(f"{fichier} : {message}")
        self.erreur = Erreur(fichier, message)


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader qui refuse les clés en double (PyYAML garde la dernière sans rien dire)."""


def _mapping_sans_doublon(loader: _StrictLoader, node: yaml.MappingNode) -> dict:
    vues: set = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=True)
        try:
            hash(key)
        except TypeError:
            raise yaml.constructor.ConstructorError(
                None,
                None,
                "clé non hashable (liste ou dictionnaire)",
                key_node.start_mark,
            ) from None
        if key in vues:
            raise yaml.constructor.ConstructorError(
                None,
                None,
                f"clé en double « {key} »",
                key_node.start_mark,
            )
        vues.add(key)
    return loader.construct_mapping(node, deep=True)


_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping_sans_doublon
)


def lire_yaml(path: Path, nom: str) -> Any:
    """Contenu YAML de `path` ; ErreurFichier(nom, …) si illisible ou clé en double."""
    try:
        return yaml.load(path.read_text(encoding="utf-8"), Loader=_StrictLoader)
    except (OSError, UnicodeDecodeError) as exc:
        raise ErreurFichier(nom, f"illisible ({exc.__class__.__name__})") from None
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (ligne {mark.line + 1})" if mark else ""
        problem = getattr(exc, "problem", None) or "syntaxe invalide"
        raise ErreurFichier(nom, f"YAML invalide{where} : {problem}") from None
    except (RecursionError, TypeError, ValueError):
        # Imbrication excessive, clé ou valeur que PyYAML ne sait pas construire
        raise ErreurFichier(nom, "YAML invalide : structure refusée") from None


def valider(modele: type[BaseModel], data: Any, nom: str) -> Any:
    """Instance de `modele`, ou ErreurFichier(nom, …) listant les champs en défaut."""
    try:
        return modele.model_validate(data if data is not None else {})
    except ValidationError as exc:
        raise ErreurFichier(nom, _message(exc)) from None


def charger(modele: type[BaseModel], path: Path, nom: str) -> Any:
    return valider(modele, lire_yaml(path, nom), nom)


def charger_fiche(path: Path, nom: str) -> Fiche:
    """Fiche publiée : identifiant égal au nom du fichier, aucune mesure à vérifier."""
    fiche = charger(Fiche, path, nom)
    if fiche.id != path.stem:
        raise ErreurFichier(
            nom, f"identifiant « {fiche.id} » différent du nom du fichier ({path.stem})"
        )
    douteuses = [m.id for m in fiche.mesures if m.a_verifier]
    if douteuses:
        raise ErreurFichier(
            nom, f"fiche publiée avec des mesures a_verifier : {', '.join(douteuses)}"
        )
    return fiche


def charger_sources(path: Path, nom: str) -> tuple[list[Source], list[Erreur]]:
    """Sources valides et erreurs, entrée par entrée : une source en défaut n'écarte que
    les fiches qui la citent. ErreurFichier si le fichier lui-même est illisible."""
    data = lire_yaml(path, nom)
    entrees = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(entrees, list) or set(data) != {"sources"}:
        raise ErreurFichier(nom, "liste « sources » attendue, sans autre clé")
    valides: list[Source] = []
    erreurs: list[Erreur] = []
    vus: set[str] = set()
    for rang, entree in enumerate(entrees):
        ref = entree.get("id") if isinstance(entree, dict) else None
        try:
            source = Source.model_validate(entree)
        except ValidationError as exc:
            erreurs.append(Erreur(nom, f"sources.{rang} ({ref}) : {_message(exc)}"))
            continue
        if source.id in vus:
            erreurs.append(Erreur(nom, f"source {source.id} en double"))
            continue
        vus.add(source.id)
        valides.append(source)
    return valides, erreurs


def _message(exc: ValidationError) -> str:
    parts = []
    for error in exc.errors(include_url=False, include_input=False):
        loc = ".".join(str(p) for p in error["loc"])
        msg = error["msg"].removeprefix("Value error, ")
        parts.append(f"{loc} : {msg}" if loc else msg)
    return " ; ".join(parts)


def _doublons(values: Iterable[str]) -> list[str]:
    vus: set[str] = set()
    doubles: list[str] = []
    for value in values:
        if value in vus and value not in doubles:
            doubles.append(value)
        vus.add(value)
    return doubles


# --- Contrôles d'ensemble ---------------------------------------------------------


def fichier_fiche(slug: str) -> str:
    return f"candidats/{slug}.yaml"


def controler_fiche(
    fiche: Fiche,
    base: Base | None,
    sources: dict[str, Source],
    themes: set[str] | None,
) -> list[str]:
    """Références et niveaux de source d'une fiche, et règle du jeu (fictif ou réel) ;
    thèmes des mesures et des votes parmi `themes` (None : non vérifiés)."""
    problemes: list[str] = []

    def source(ref: str, usage: str, niveaux: set[str] | None = None) -> None:
        found = sources.get(ref)
        if found is None:
            problemes.append(f"{usage} : source « {ref} » inconnue")
            return
        if niveaux is not None and found.niveau not in niveaux:
            problemes.append(
                f"{usage} : niveau de source « {found.niveau} » interdit"
                f" (attendu : {', '.join(sorted(niveaux))})"
            )
        if found.candidat and found.candidat != fiche.id:
            problemes.append(
                f"{usage} : source « {ref} » d'un autre candidat ({found.candidat})"
            )

    source(fiche.statut_source, "statut_source", NIVEAUX_MESURE)
    source(fiche.declaration.source_id, "declaration", NIVEAUX_MESURE)
    for i, ligne in enumerate(fiche.lignes_phares):
        source(ligne.source_id, f"lignes_phares.{i}", NIVEAUX_MESURE)
    for mesure in fiche.mesures:
        source(mesure.source_id, f"mesure {mesure.id}", NIVEAUX_MESURE)
        if themes is not None and mesure.theme not in themes:
            problemes.append(f"mesure {mesure.id} : thème « {mesure.theme} » inconnu")
    for vote in fiche.votes:
        source(vote.source_id, f"vote {vote.id}", NIVEAUX_VOTE)
        if themes is not None and vote.theme and vote.theme not in themes:
            problemes.append(f"vote {vote.id} : thème « {vote.theme} » inconnu")
    if base is not None:
        if base.jeu == "reel" and fiche.fictif:
            problemes.append("fiche fictive interdite dans un jeu reel")
        if base.jeu == "demonstration" and not fiche.fictif:
            problemes.append("jeu demonstration : fiche sans fictif: true")
    return problemes


def controler_sources(
    base: Base | None, sources: Iterable[Source]
) -> list[tuple[str, str]]:
    """(identifiant, problème) des sources refusées par la règle du jeu fictif."""
    if base is None or base.jeu != "demonstration":
        return []
    return [
        (
            s.id,
            f"source {s.id} : jeu demonstration, adresse hors {DOMAINE_FICTIF} refusée",
        )
        for s in sources
        if not domaine_fictif(s.url)
    ]


def controler_lignee(sources: Iterable[Source]) -> list[tuple[str, str]]:
    """(identifiant, problème) des sources dont le champ `remplace` est en défaut :
    source remplacée inconnue, d'un autre candidat, déjà remplacée par une autre
    source, ou lignée en boucle. Seule la source qui porte le champ est visée."""
    sources = list(sources)
    par_id = {s.id: s for s in sources}
    problemes: list[tuple[str, str]] = []
    remplacantes: dict[str, list[str]] = {}
    for source in sources:
        if source.remplace is None:
            continue
        ancienne = par_id.get(source.remplace)
        if ancienne is None:
            problemes.append(
                (
                    source.id,
                    f"source {source.id} : remplace une source inconnue"
                    f" ({source.remplace})",
                )
            )
            continue
        if ancienne.candidat != source.candidat:
            problemes.append(
                (
                    source.id,
                    f"source {source.id} : remplace {ancienne.id}, document d'un autre"
                    " candidat",
                )
            )
            continue
        remplacantes.setdefault(ancienne.id, []).append(source.id)
    for remplacee, ids in remplacantes.items():
        if len(ids) > 1:
            problemes.extend(
                (
                    i,
                    f"source {i} : {remplacee} déjà remplacée par une autre source"
                    f" ({', '.join(x for x in ids if x != i)})",
                )
                for i in ids
            )
    for source in sources:
        vues = {source.id}
        suivante = par_id.get(source.remplace) if source.remplace else None
        while suivante is not None:
            if suivante.id in vues:
                problemes.append(
                    (source.id, f"source {source.id} : lignée en boucle (remplace)")
                )
                break
            vues.add(suivante.id)
            suivante = par_id.get(suivante.remplace) if suivante.remplace else None
    return problemes


def lignees(sources: Iterable[Source], candidat: str | None) -> list[list[Source]]:
    """Lignées de plus d'une version des documents d'un candidat, de la plus ancienne à
    la plus récente (sources déjà contrôlées par `controler_lignee`)."""
    propres = [s for s in sources if s.candidat == candidat]
    par_id = {s.id: s for s in propres}
    suivante = {s.remplace: s for s in propres if s.remplace in par_id}
    resultat = []
    for source in propres:
        if source.remplace in par_id or source.id not in suivante:
            continue
        chaine = [source]
        while chaine[-1].id in suivante and len(chaine) <= len(propres):
            chaine.append(suivante[chaine[-1].id])
        resultat.append(chaine)
    return sorted(resultat, key=lambda c: c[-1].id)


def controler_base(base: Base, sources: dict[str, Source]) -> list[str]:
    if base.liste_source and base.liste_source not in sources:
        return [f"liste_source : source « {base.liste_source} » inconnue"]
    return []


def sans_accents(texte: str) -> str:
    """Texte sans accents ni casse (« Éducation » -> « education ») : forme unique,
    reprise par l'assistant et la recherche par mots."""
    decompose = unicodedata.normalize("NFKD", texte)
    return "".join(c for c in decompose if not unicodedata.combining(c)).casefold()


def _mots(texte: str) -> list[str]:
    return re.findall(r"\w+", texte)


@dataclass(frozen=True)
class Identite:
    """Ce qui désigne un candidat dans un texte : nom affiché, alias, initiales."""

    nom: str
    alias: tuple[str, ...] = ()
    initiales: str = ""


def identite(fiche: Fiche) -> Identite:
    return Identite(fiche.nom_affiche, tuple(fiche.alias), fiche.initiales)


def identite_brute(data: Any) -> Identite | None:
    """Identité lue dans le YAML d'une fiche écartée, si ses champs sont lisibles."""
    if not isinstance(data, dict) or not isinstance(data.get("nom_affiche"), str):
        return None
    alias = data.get("alias")
    initiales = data.get("initiales")
    return Identite(
        data["nom_affiche"],
        tuple(a for a in alias if isinstance(a, str))
        if isinstance(alias, list)
        else (),
        initiales if isinstance(initiales, str) else "",
    )


def noms_interdits(identites: Iterable[Identite], partis: Iterable[str]) -> list[str]:
    """Noms complets, noms de famille (dernier mot), alias et partis, comparés sans casse
    ni accents. Le prénom seul n'est pas interdit (« la Marine nationale » passe)."""
    noms: set[str] = set()
    for ident in identites:
        noms.update(n for n in (ident.nom, *ident.alias) if n.strip())
        mots = _mots(ident.nom)
        if mots and len(mots[-1]) > 2 and mots[-1].casefold() not in PARTICULES:
            noms.add(mots[-1])
    noms.update(p for p in partis if p.strip())
    return sorted(noms)


def _contient(texte: str, nom: str) -> bool:
    """Nom présent en mots entiers (« Martinique » ne contient pas « Martin »)."""
    mots = _mots(sans_accents(nom))
    if not mots:
        return False
    motif = r"(?<!\w)" + r"\W+".join(re.escape(m) for m in mots) + r"(?!\w)"
    return re.search(motif, sans_accents(texte)) is not None


def controler_grille(
    grille: Grille,
    identites: Iterable[Identite],
    partis: Iterable[str],
    journal: Journal | None,
) -> list[str]:
    """Noms interdits dans tous les textes de la grille ; gel (règle 6) ; aucun thème
    hors quiz (THEMES_HORS_QUIZ)."""
    identites = list(identites)
    noms = noms_interdits(identites, partis)
    initiales = sorted({i.initiales for i in identites if i.initiales})
    problemes: list[str] = []

    def controler(ou: str, texte: str) -> None:
        trouves = [n for n in noms if _contient(texte, n)]
        # Initiales : mots entiers, en majuscules (« de » n'est pas « DE »)
        trouves += [i for i in initiales if i in _mots(texte)]
        if trouves:
            problemes.append(
                f"{ou} : nom de candidat ou de parti interdit ({', '.join(trouves)})"
            )

    for theme in grille.themes:
        if theme.id in THEMES_HORS_QUIZ:
            problemes.append(
                f"thème {theme.id} : thème des fiches hors quiz, interdit dans la grille"
            )
        controler(f"thème {theme.id}, libellé", theme.libelle)
        controler(f"thème {theme.id}, pôle A", theme.axe.pole_a)
        controler(f"thème {theme.id}, pôle B", theme.axe.pole_b)
        for mot in theme.mots_cles:
            controler(f"thème {theme.id}, mot-clé", mot)
        for question in theme.questions:
            controler(f"question {question.id}, énoncé", question.enonce)
            for option in question.options:
                controler(f"question {question.id}, option {option.id}", option.libelle)
    if grille.gel is not None:
        gel = grille.gel
        entrees = journal.entrees if journal else []
        if not any(
            e.objet == "gel_grille" and e.empreinte == gel.empreinte for e in entrees
        ):
            problemes.append(
                "gel sans ligne gel_grille au journal portant la même empreinte"
            )
        actuelle = empreinte_grille(grille)
        # Seules comptent les corrections datées après le gel
        corrigees = {
            e.empreinte
            for e in entrees
            if e.objet == "correction_grille" and e.date > gel.le
        }
        if actuelle != gel.empreinte and actuelle not in corrigees:
            problemes.append(
                "grille modifiée après le gel sans ligne de correction au journal"
                f" (empreinte actuelle {actuelle})"
            )
    return problemes


def themes_admis(grille: Iterable[str] | None) -> set[str] | None:
    """Thèmes admis pour les mesures et les votes : ceux de la grille et les thèmes
    hors quiz ; None sans grille (thèmes non vérifiés)."""
    if grille is None:
        return None
    return set(grille) | set(THEMES_HORS_QUIZ)


def themes_bruts(data: Any) -> set[str] | None:
    """Identifiants des thèmes d'une grille en défaut, s'ils sont lisibles."""
    if not isinstance(data, dict) or not isinstance(data.get("themes"), list):
        return None
    ids = {
        t["id"]
        for t in data["themes"]
        if isinstance(t, dict) and isinstance(t.get("id"), str)
    }
    return ids or None


def controler_rattachements(
    rattachements: Rattachements,
    grille: Grille,
    fiches: dict[str, Fiche],
    ecartees: Iterable[str] = (),
) -> list[tuple[int, str]]:
    """(rang, problème) des rattachements en défaut ; ceux d'une fiche écartée
    (en défaut, signalée à part) sont ignorés sans erreur."""
    ecartees = set(ecartees)
    problemes: list[tuple[int, str]] = []
    vus: set[tuple[str, str]] = set()
    for rang, r in enumerate(rattachements.rattachements):
        if r.candidat in ecartees:
            continue
        prefix = f"rattachement {r.question}/{r.candidat}"
        trouve = grille.question(r.question)
        fiche = fiches.get(r.candidat)
        if trouve is None:
            problemes.append((rang, f"{prefix} : question « {r.question} » inconnue"))
            continue
        if fiche is None:
            problemes.append((rang, f"{prefix} : candidat « {r.candidat} » inconnu"))
            continue
        theme, question = trouve
        option = next((o for o in question.options if o.id == r.option), None)
        if option is None or option.speciale:
            problemes.append((rang, f"{prefix} : option « {r.option} » invalide"))
            continue
        if (r.question, r.candidat) in vus:
            problemes.append(
                (rang, f"{prefix} : deux options pour un candidat sur une question")
            )
            continue
        mesure = next((m for m in fiche.mesures if m.id == r.mesure_id), None)
        if mesure is None:
            problemes.append(
                (
                    rang,
                    f"{prefix} : mesure « {r.mesure_id} » absente de la fiche"
                    f" {r.candidat} (mesure d'un autre candidat ou inconnue)",
                )
            )
            continue
        if mesure.theme in THEMES_HORS_QUIZ:
            problemes.append(
                (
                    rang,
                    f"{prefix} : mesure « {r.mesure_id} » du thème {mesure.theme},"
                    " hors quiz : aucun rattachement",
                )
            )
            continue
        if mesure.theme != theme.id:
            problemes.append(
                (
                    rang,
                    f"{prefix} : mesure « {r.mesure_id} » du thème {mesure.theme},"
                    f" question du thème {theme.id}",
                )
            )
            continue
        vus.add((r.question, r.candidat))
    return problemes


# --- Schémas JSON pour l'éditeur ----------------------------------------------------


def schemas_json() -> dict[str, dict]:
    return {nom: modele.model_json_schema() for nom, modele in MODELES.items()}


def exporter_schemas(dossier: Path) -> list[Path]:
    """Écrit <nom>.schema.json pour chaque fichier de la base ; renvoie les chemins."""
    dossier.mkdir(parents=True, exist_ok=True)
    ecrits = []
    for nom, schema in schemas_json().items():
        path = dossier / f"{nom}.schema.json"
        path.write_text(
            json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        ecrits.append(path)
    return ecrits


if __name__ == "__main__":
    import sys

    cible = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else Path(__file__).parent / ("fixtures/presidentielle/schemas")
    )
    for written in exporter_schemas(cible):
        print(written)
