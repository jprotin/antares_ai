"""Routes de lecture de la base « Présidentielle 2027 » (cf. presidentielle.py), branchées
dans le routeur par `app.include_router(presidentielle_api.construire(...))`.

- GET /api/presidentielle       : base publiée (candidats triés par identifiant ; l'ordre
                                  affiché est tiré au sort par l'interface), thèmes,
                                  journal ;
- GET /api/presidentielle/meta  : partage, invité, appel en cours, modèle de l'assistant,
                                  cible (local ou cloud), jeu, version ; erreurs de
                                  fichiers pour le propriétaire et l'accès local seulement ;
- GET /api/presidentielle/quiz  : grille, rattachements, éligibilité de chaque question ;
- POST /api/presidentielle/extraire : une tranche de document (`type: extraction`) ou la
                                  double lecture d'une question (`type: relecture`),
                                  pour l'outil de saisie (presidentielle_tool.py).

Lecture pour tous, invités d'un partage compris (veille_access.is_guest, inchangé).
L'extraction est réservée à l'accès local (ni `x-antares-user` ni `x-forwarded-for` :
le propriétaire par le tunnel est refusé comme un invité), en plus de la garde des
écritures (write_guard.py : Origin et en-tête X-Antares). Elle n'utilise que le modèle
des Réglages s'il figure sur la liste blanche de base.yaml (sinon 503, sans repli), une
génération à la fois, et répond 409 `attente` pendant un appel vocal. Aucun texte
(document, énoncé, réponse) n'est journalisé.
- POST /api/presidentielle/ask  : assistant (lot 2, presidentielle_assistant.py), ouvert
                                  aux invités d'un partage ; réponses faites de passages
                                  relus seulement ;
- POST /api/presidentielle/index : reconstruction de l'index par le sens
                                  (presidentielle_index.py), propriétaire ou accès local ;
- GET /api/presidentielle/nouveautes : signalements « nouvelle source à relire » de la
                                  surveillance des pages des candidats (antares-tasks,
                                  table watched_pages de tasks.db lue en lecture seule),
                                  propriétaire ou accès local ; Origin étrangère refusée.

- GET /api/presidentielle/evolution/{candidat} : vue « Évolution » d'une fiche (frise des
                                  versions figées dans historique/, documents de
                                  programme en plusieurs versions) ;
- GET /api/presidentielle/evolution/{candidat}/comparaison?de=&a= : comparaison mot pour
                                  mot de deux versions d'un même document (textes/),
                                  cf. presidentielle_evolution.py. Lecture pour tous,
                                  comme la base ; entre les tours, les 2 qualifiés
                                  seulement (404 sinon).

Les dépendances du routeur (partage, propriétaire, réglages, disponibilité d'un modèle,
heure du dernier tour vocal, délai d'appel, index) sont injectées et lues à chaque requête.
Routes prévues par le plan sous /api/presidentielle (inventaire testé) : celles-ci.

Droits des invités d'un partage (veille_access.is_guest) : lecture et POST ask
(OUVERT_AUX_INVITES) ; index, extraire et nouveautes leur sont refusés. Toute écriture
passe aussi la garde de l'audit (write_guard.py : Origin autorisée et X-Antares: 1).

Phases (lot 5, presidentielle.phase_effective) : l'en-tête donne la phase effective
(`archive` après `archive_apres`, heure de Paris) et les qualifiés ; entre les tours,
base, quiz, assistant et index ne portent que sur les 2 qualifiés
(presidentielle.selon_phase). En archive, POST /index est refusé (409 `archive`) sauf
corps `{"correction": "<motif>"}`, motif journalisé ; l'assistant et le quiz restent
consultables.
"""

import asyncio
import collections
import logging
import os
import re
import sqlite3
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

import presidentielle
import presidentielle_assistant as assistant
import presidentielle_common as common
import presidentielle_evolution
import presidentielle_index
import presidentielle_schema as schema
import veille_access
import write_guard

PREFIXE = "/api/presidentielle"
MODELE_REFUSE = "modèle non autorisé pour cette page"
AUCUN_MODELE = "aucun modèle autorisé disponible"
LOCAL_SEULEMENT = "extraction réservée à l'accès local (outil de saisie)"
# Génération bornée : réponse faite d'identifiants et de citations courtes
EXTRACTION_MAX_TOKENS = 2_000
EXTRACTION_DELAI = 300
ATTENTE_SECONDES = 30
# Tranche envoyée : environ 8 000 jetons (outil), jamais plus de 28 000 (contexte de
# 32 768 jetons d'Ollama, consigne et réponse comprises) ; 3,5 caractères par jeton
TRANCHE_MAX_CARACTERES = 98_000
# Écritures ouvertes aux invités d'un partage ; les autres leur sont refusées
OUVERT_AUX_INVITES = frozenset({"/ask"})
RESERVE_AU_PROPRIETAIRE = frozenset({"/index", "/extraire", "/nouveautes"})
INVITE_REFUSE = "réservé au propriétaire et à l'accès local"
ATTENTE_ASSISTANT = "Appel en cours : réponse après l'appel"
ARCHIVE_FIGEE = (
    "base archivée : index figé, sauf correction (presidentielle.sh index "
    "--correction <motif>)"
)
# Attente du tour de génération au plus (sinon 429 : pas de file sans fin), et quota
# de questions par invité d'un partage (fenêtre glissante)
ATTENTE_VERROU = 20
QUOTA_INVITE = 10
QUOTA_FENETRE = 60
GRILLE_NON_PUBLIEE = "La grille du quiz n'est pas encore publiée."
GRILLE_EN_CORRECTION = "La grille du quiz est en cours de correction."
OCCUPE = "Assistant occupé : réessayez dans un instant"
TROP_DE_QUESTIONS = "Trop de questions : réessayez dans une minute"
LECTEURS = (
    ("gauche", "un électeur qui se situe à gauche"),
    ("droite", "un électeur qui se situe à droite"),
)

logger = logging.getLogger("router")


@dataclass
class Dependances:
    sharing: Callable[[], bool]
    owner: Callable[[], str]
    load_settings: Callable[[], Any]
    model_available: Callable[[str], Awaitable[bool]]
    last_voice_at: Callable[[], float]
    idle_seconds: Callable[[], int]
    now: Callable[[], float] = time.time
    # providers.complete(name, messages, json_mode=, max_tokens=, temperature=, timeout=)
    complete: Callable[..., Awaitable[str]] | None = None
    # Index par le sens (RAG intégré) ; absent : recherche par mots seulement
    index: presidentielle_index.Index | None = None
    # Base des tâches (tasks.db, écrite par antares-tasks) : pages suivies, lues en
    # lecture seule par GET /nouveautes ; absente : aucun signalement
    tasks_db: Callable[[], Path] | None = None


def cible() -> str:
    """« cloud » si ANTARES_TARGET le dit, « local » sinon."""
    value = os.environ.get("ANTARES_TARGET", "").strip().lower()
    return "cloud" if value == "cloud" else "local"


_source = presidentielle.source_publiee


def _candidat(etat: presidentielle.Etat, fiche: schema.Fiche) -> dict:
    return {
        "id": fiche.id,
        "nom_affiche": fiche.nom_affiche,
        "initiales": fiche.initiales,
        "alias": fiche.alias,
        "fictif": fiche.fictif,
        "statut": fiche.statut,
        "statut_source": _source(etat, fiche.statut_source),
        "declaration": {
            "date": fiche.declaration.date.isoformat(),
            "source": _source(etat, fiche.declaration.source_id),
        },
        "description": {
            "texte": fiche.description.texte,
            "nature": fiche.description.nature,
        },
        "lignes_phares": [
            {
                "texte": ligne.texte,
                "nature": "candidat",
                "source": _source(etat, ligne.source_id),
            }
            for ligne in fiche.lignes_phares
        ],
        "mesures": [presidentielle.mesure_publiee(etat, m) for m in fiche.mesures],
        "parlementaire": fiche.parlementaire,
        "votes": [
            {
                "id": vote.id,
                "scrutin": vote.scrutin,
                "date": vote.date.isoformat(),
                "position": vote.position,
                "theme": vote.theme,
                "source": _source(etat, vote.source_id),
            }
            for vote in fiche.votes
        ],
        "version": fiche.version,
        "mise_a_jour": fiche.mise_a_jour.isoformat(),
        "relue_le": fiche.relue_le.isoformat() if fiche.relue_le else None,
    }


def _entete(etat: presidentielle.Etat, maintenant: datetime | None = None) -> dict:
    base = etat.base
    return {
        "disponible": base is not None,
        "message": etat.message or None,
        "jeu": base.jeu if base else None,
        "liste": base.liste if base else None,
        # Phase effective : `archive` après archive_apres (heure de Paris)
        "phase": presidentielle.phase_effective(base, maintenant),
        # Ordre alphabétique : jamais l'ordre saisi (souvent celui du premier tour)
        "qualifies": sorted(base.qualifies) if base else [],
        "version": etat.version,
    }


def base_publiee(etat: presidentielle.Etat, maintenant: datetime | None = None) -> dict:
    entete = _entete(etat, maintenant)
    etat = presidentielle.selon_phase(etat)
    base = etat.base
    grille = etat.grille
    journal = sorted(etat.journal, key=lambda e: e.date, reverse=True)
    return {
        **entete,
        "tours": base.tours.model_dump(mode="json") if base else None,
        "archive_apres": base.archive_apres.isoformat() if base else None,
        "axes_statut": grille.axes_statut if grille else None,
        # Grille absente ou en défaut : thèmes déduits des mesures (axe null), pour
        # qu'aucune mesure publiée ne disparaisse de la fiche ; thèmes hors quiz
        # (ADR 0016) après ceux de la grille, sans axe
        "themes": [
            {"id": t.id, "libelle": t.libelle, "axe": t.axe, "hors_quiz": t.hors_quiz}
            for t in presidentielle.themes_servis(etat)
        ],
        "candidats": [_candidat(etat, etat.fiches[s]) for s in sorted(etat.fiches)],
        "journal": [e.model_dump(mode="json", exclude_none=True) for e in journal],
    }


def quiz(etat: presidentielle.Etat, maintenant: datetime | None = None) -> dict:
    entete = _entete(etat, maintenant)
    etat = presidentielle.selon_phase(etat)
    grille = etat.grille
    if grille is None:
        grille_publiee = (etat.dossier / "quiz" / "grille.yaml").is_file()
        return {
            **entete,
            "disponible": False,
            # Base servie mais grille absente ou en défaut (message de la base sinon)
            "message": entete["message"]
            or (GRILLE_EN_CORRECTION if grille_publiee else GRILLE_NON_PUBLIEE),
            "grille_version": None,
            "axes_statut": None,
            "barres_visibles": False,
            "gel": None,
            "participants": presidentielle.participants(etat),
            "themes": [],
            "rattachements": [],
        }
    themes = []
    for theme in grille.themes:
        questions = []
        for question in theme.questions:
            couverture = presidentielle.couverture(etat, question.id)
            eligible = couverture.pop("eligible") and question.statut == "validee"
            questions.append(
                {
                    "id": question.id,
                    "enonce": question.enonce,
                    "statut": question.statut,
                    "options": [
                        {
                            "id": o.id,
                            "libelle": o.libelle,
                            "pole": o.pole,
                            "speciale": o.speciale,
                        }
                        for o in question.options
                    ],
                    "eligible": eligible,
                    "couverture": couverture,
                }
            )
        themes.append(
            {
                "id": theme.id,
                "libelle": theme.libelle,
                "axe": theme.axe.model_dump(),
                "questions": questions,
            }
        )
    empreinte = schema.empreinte_grille(grille)
    return {
        **entete,
        "grille_version": empreinte.removeprefix("sha256:")[:12],
        "axes_statut": grille.axes_statut,
        "barres_visibles": grille.barres_visibles,
        "gel": grille.gel.model_dump(mode="json") if grille.gel else None,
        "participants": presidentielle.participants(etat),
        "themes": themes,
        "rattachements": [r.model_dump() for r in etat.rattachements],
    }


async def modele_assistant(dep: Dependances, autorises: list[str]) -> dict:
    """Modèle des Réglages s'il est sur la liste blanche et disponible, sinon le premier
    modèle de la liste qui l'est ; jamais de repli hors liste."""
    choisi = dep.load_settings().model

    async def disponible(name: str) -> bool:
        try:
            return bool(await dep.model_available(name))
        except Exception:  # noqa: BLE001 - fournisseur injoignable : indisponible
            return False

    modele = None
    if common.modele_autorise(choisi, autorises) and await disponible(choisi):
        modele = choisi
    else:
        for name in autorises:
            if await disponible(name):
                modele = name
                break
    message = None
    if modele is None:
        message = (
            AUCUN_MODELE if common.modele_autorise(choisi, autorises) else MODELE_REFUSE
        )
    return {
        "modele": modele,
        "modeles_autorises": list(autorises),
        "message": message,
    }


class CorpsQuestion(BaseModel):
    """Corps de POST /ask : la question, l'ordre tiré par le navigateur et la mention
    d'un appel lancé depuis ce navigateur ; rien d'autre (pas d'historique)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=assistant.QUESTION_MAX)
    ordre: list[str] = Field(default=[], max_length=60)
    appel_en_cours: bool = False

    @model_validator(mode="after")
    def ordre_borne(self) -> "CorpsQuestion":
        if any(len(slug) > 80 for slug in self.ordre):
            raise ValueError("identifiant de candidat trop long")
        return self


def erreurs_corps(exc: ValueError) -> str:
    """Motif d'un corps refusé, sans le texte envoyé."""
    if isinstance(exc, ValidationError):
        return "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])} : {e['msg']}"
            for e in exc.errors(
                include_input=False, include_url=False, include_context=False
            )
        )
    return "corps JSON attendu"


class CorpsIndex(BaseModel):
    """Corps facultatif de POST /index : motif d'une correction, seul moyen de
    reconstruire l'index d'une base archivée."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    correction: str | None = Field(
        default=None, min_length=1, max_length=300, pattern=r"^[^\x00-\x1f\x7f]+$"
    )


class CorpsExtraire(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    type: Literal["extraction", "relecture"]
    # extraction : candidat, thèmes proposés, tranche de texte marquée [page N]
    candidat: str | None = Field(default=None, pattern=schema.IDENTIFIANT)
    themes: list[str] = Field(default=[], max_length=30)
    texte: str = Field(default="", max_length=TRANCHE_MAX_CARACTERES)
    # relecture : énoncé et options d'une question du quiz
    enonce: str = Field(default="", max_length=2_000)
    options: list[str] = Field(default=[], max_length=8)

    @model_validator(mode="after")
    def champs_du_type(self) -> "CorpsExtraire":
        if self.type == "extraction" and not (self.candidat and self.texte):
            raise ValueError("extraction : candidat et texte attendus")
        if self.type == "relecture" and not (self.enonce and self.options):
            raise ValueError("relecture : énoncé et options attendus")
        for theme in self.themes:
            if len(theme) > 60:
                raise ValueError("thème trop long")
        for option in self.options:
            if len(option) > 500:
                raise ValueError("option trop longue")
        return self


CONSIGNE_EXTRACTION = """Tu relèves les propositions d'un document de campagne \
électorale, sans aucun jugement.
Réponds uniquement par un objet JSON de la forme :
{"mesures": [{"theme": "<identifiant de thème>", "citation": "<texte>", \
"page": <numéro>, "resume": "<une phrase>"}]}
Règles :
- "citation" recopie mot pour mot une phrase du texte, sans rien changer, ni ajouter, \
ni couper au milieu d'un mot ; jamais une reformulation ;
- une mesure par proposition concrète du candidat ; ignore les slogans, les constats \
et les critiques d'adversaires ;
- "theme" est l'un des identifiants proposés ;
- "page" est le numéro donné par le repère [page N] qui précède la citation ;
- "resume" reformule la proposition en une phrase neutre, sans adjectif de jugement ;
- s'il n'y a aucune proposition, réponds {"mesures": []}."""

CONSIGNE_RELECTURE = """Tu relis une question d'un questionnaire civique, en te mettant \
à la place de {lecteur}.
Dis en trois phrases au plus si l'énoncé ou une option te semble orienté, connoté, \
caricatural ou incomplet pour ce lecteur, et pourquoi. Si tout te semble équilibré, \
dis-le. Ne donne aucune consigne ni recommandation de vote, ne cite aucun candidat ni \
parti."""


def messages_extraction(corps: CorpsExtraire) -> list[dict]:
    themes = ", ".join(corps.themes) or "identifiant court en minuscules, au choix"
    texte = (
        f"Candidat : {corps.candidat}\nThèmes proposés : {themes}\n\n"
        f"Texte (repères de page entre crochets) :\n{corps.texte}"
    )
    return [
        {"role": "system", "content": CONSIGNE_EXTRACTION},
        {"role": "user", "content": texte},
    ]


def messages_relecture(corps: CorpsExtraire, lecteur: str) -> list[dict]:
    options = "\n".join(f"- {o}" for o in corps.options)
    return [
        {"role": "system", "content": CONSIGNE_RELECTURE.format(lecteur=lecteur)},
        {"role": "user", "content": f"Énoncé : {corps.enonce}\nOptions :\n{options}"},
    ]


def local(request: Request) -> bool:
    """Requête locale : ni en-tête du tunnel (x-antares-user), ni x-forwarded-for."""
    headers = request.headers
    return "x-antares-user" not in headers and "x-forwarded-for" not in headers


def proprietaire(request: Request, owner: str) -> bool:
    """Propriétaire par le tunnel : x-antares-user (écrit par ngrok) égal à son adresse."""
    utilisateur = request.headers.get("x-antares-user", "").strip().lower()
    return bool(owner.strip()) and utilisateur == owner.strip().lower()


def origine_etrangere(request: Request) -> bool:
    """Lecture demandée par une page d'un autre site (Sec-Fetch-Site ou Origin hors de
    la liste de la garde des écritures) : refusée pour les routes du propriétaire."""
    headers = request.headers
    if headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
        return True
    origin = headers.get("origin")
    return origin is not None and origin.strip().lower() not in (
        write_guard.allowed_origins(headers)
    )


# Même fuseau que `timezone` de tasks/tasks.yaml (jour du changement)
PARIS = ZoneInfo("Europe/Paris")


def _jour(horodatage: str | None) -> date | None:
    try:
        moment = datetime.fromisoformat(str(horodatage))
    except ValueError:
        return None
    return moment.astimezone(PARIS).date() if moment.tzinfo else moment.date()


def _pages_suivies(etat: presidentielle.Etat) -> set[str] | None:
    """Adresses de surveillance.yaml (pages retirées ou liste vidée : plus signalées) ;
    None si le fichier est illisible."""
    path = etat.dossier / "surveillance.yaml"
    if not path.is_file():
        return set()
    try:
        suivi = schema.charger(schema.Surveillance, path, "surveillance.yaml")
    except schema.ErreurFichier:
        return None
    return {p.url for p in suivi.pages}


def nouveautes(tasks_db: Path | None, etat: presidentielle.Etat) -> dict:
    """Pages suivies modifiées depuis la dernière relecture de la fiche du candidat
    (`relue_le` antérieur au jour du changement, ou fiche absente) ; base des tâches
    absente, ou sans la table (schéma < 5) : aucun signalement."""
    reponse: dict = {
        "signalements": [],
        "pages_suivies": 0,
        "en_erreur": 0,
        "derniere_visite": None,
    }
    if tasks_db is None or not tasks_db.is_file():
        return reponse
    try:
        conn = sqlite3.connect(f"file:{tasks_db}?mode=ro", uri=True, timeout=5)
        try:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT url, candidat, status, checked_at, changed_at "
                "FROM watched_pages ORDER BY url"
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        if "no such table" not in str(exc):
            logger.warning("Nouveautés illisibles : %s", type(exc).__name__)
        return reponse
    suivies = _pages_suivies(etat)
    if suivies is not None:
        rows = [r for r in rows if r["url"] in suivies]
    reponse["pages_suivies"] = len(rows)
    reponse["en_erreur"] = sum(1 for r in rows if r["status"] == "error")
    visites = [str(r["checked_at"]) for r in rows if r["checked_at"]]
    reponse["derniere_visite"] = max(visites) if visites else None
    for row in rows:
        jour = _jour(row["changed_at"])
        if jour is None:
            continue
        fiche = etat.fiches.get(str(row["candidat"]))
        # Relue le jour même : signalement gardé (faux positif plutôt qu'un changement
        # de l'après-midi jamais signalé)
        if fiche is not None and fiche.relue_le is not None and fiche.relue_le > jour:
            continue
        reponse["signalements"].append(
            {
                "url": str(row["url"]),
                "candidat": str(row["candidat"]),
                "nom": fiche.nom_affiche if fiche else str(row["candidat"]),
                "detecte_le": str(row["changed_at"]),
            }
        )
    reponse["signalements"].sort(key=lambda s: s["detecte_le"], reverse=True)
    return reponse


def attente(detail: str = "Appel en cours : extraction après l'appel") -> JSONResponse:
    return JSONResponse(
        {
            "kind": "attente",
            "retry_after": ATTENTE_SECONDES,
            "detail": detail,
        },
        status_code=409,
        headers={"Retry-After": str(ATTENTE_SECONDES)},
    )


def construire(dep: Dependances) -> APIRouter:
    api = APIRouter(prefix=PREFIXE)

    def invite(request: Request) -> bool:
        return dep.sharing() and veille_access.is_guest(request.headers, dep.owner())

    def maintenant() -> datetime:
        return datetime.fromtimestamp(dep.now(), timezone.utc)

    # Lectures de fichiers en `def` : pool de fils, la boucle (et la voix) n'attend pas
    @api.get("")
    def presidentielle_base() -> dict:
        return base_publiee(presidentielle.charger(), maintenant())

    @api.get("/quiz")
    def presidentielle_quiz() -> dict:
        return quiz(presidentielle.charger(), maintenant())

    def fiche_visible(slug: str) -> tuple[presidentielle.Etat, schema.Fiche]:
        """Fiche servie dans la phase en cours (entre les tours : les 2 qualifiés)."""
        etat = presidentielle.charger()
        if etat.base is None:
            raise HTTPException(503, etat.message or "base indisponible")
        fiche = None
        if len(slug) <= 80 and re.fullmatch(schema.IDENTIFIANT, slug):
            fiche = presidentielle.selon_phase(etat).fiches.get(slug)
        if fiche is None:
            raise HTTPException(404, "candidat inconnu")
        return etat, fiche

    @api.get("/evolution/{slug}")
    def presidentielle_evolution_route(slug: str) -> dict:
        etat, fiche = fiche_visible(slug)
        return presidentielle_evolution.evolution(etat, fiche)

    @api.get("/evolution/{slug}/comparaison")
    def presidentielle_comparaison(
        slug: str,
        de: str = Query(max_length=80, pattern=schema.IDENTIFIANT),
        a: str = Query(max_length=80, pattern=schema.IDENTIFIANT),
    ) -> dict:
        etat, fiche = fiche_visible(slug)
        try:
            return presidentielle_evolution.comparaison(
                etat, fiche, de, a, appel_en_cours=appel
            )
        except presidentielle_evolution.ComparaisonImpossible as exc:
            raise HTTPException(exc.statut, str(exc)) from None

    @api.get("/meta")
    async def presidentielle_meta(request: Request) -> dict:
        etat = await asyncio.to_thread(presidentielle.charger)
        guest = invite(request)
        autorises = etat.base.assistant.modeles_autorises if etat.base else []
        meta = {
            **_entete(etat, maintenant()),
            "sharing": dep.sharing(),
            "guest": guest,
            "appel_en_cours": common.appel_en_cours(
                dep.now(), dep.last_voice_at(), dep.idle_seconds()
            ),
            "assistant": await modele_assistant(dep, autorises),
            "cible": cible(),
            "fiches": len(presidentielle.selon_phase(etat).fiches),
        }
        if not guest:
            meta["erreurs"] = [e.as_dict() for e in etat.erreurs]
        return meta

    # Une génération à la fois (créé ici : lié à la boucle d'événements du routeur)
    generation = asyncio.Semaphore(1)

    def appel() -> bool:
        return common.appel_en_cours(dep.now(), dep.last_voice_at(), dep.idle_seconds())

    async def generer(modele: str, messages: list[dict], json_mode: bool) -> str:
        if dep.complete is None:
            raise HTTPException(503, "génération indisponible")
        try:
            return await asyncio.wait_for(
                dep.complete(
                    modele,
                    messages,
                    json_mode=json_mode,
                    max_tokens=EXTRACTION_MAX_TOKENS,
                    temperature=0.1,
                    timeout=EXTRACTION_DELAI,
                ),
                EXTRACTION_DELAI,
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                504, f"modèle sans réponse en {EXTRACTION_DELAI} s"
            ) from None
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - fournisseur : nom de l'erreur seul
            logger.warning("presidentielle/extraire : %s", exc.__class__.__name__)
            raise HTTPException(502, "échec du modèle") from None

    @api.post("/extraire", response_model=None)
    async def presidentielle_extraire(request: Request) -> dict | JSONResponse:
        if not local(request):
            raise HTTPException(403, LOCAL_SEULEMENT)
        try:
            corps = CorpsExtraire.model_validate(await request.json())
        except ValueError as exc:
            # json.JSONDecodeError et ValidationError sont des ValueError ; message sans
            # le texte envoyé
            raise HTTPException(422, erreurs_corps(exc)) from None
        etat = await asyncio.to_thread(presidentielle.charger)
        autorises = (
            etat.base.assistant.modeles_autorises
            if etat.base
            else list(schema.MODELES_PAR_DEFAUT)
        )
        if not common.modele_autorise(dep.load_settings().model, autorises):
            raise HTTPException(503, MODELE_REFUSE)
        modele = (await modele_assistant(dep, autorises))["modele"]
        if modele is None:
            raise HTTPException(503, AUCUN_MODELE)
        if appel():
            return attente()
        async with generation:
            if corps.type == "extraction":
                if appel():
                    return attente()
                reponse = await generer(modele, messages_extraction(corps), True)
                return {"kind": "ok", "modele": modele, "reponse": reponse}
            lectures = []
            for lecteur, qui in LECTEURS:
                if appel():
                    return attente()
                texte = await generer(modele, messages_relecture(corps, qui), False)
                lectures.append({"lecteur": lecteur, "texte": texte})
            return {"kind": "ok", "modele": modele, "lectures": lectures}

    # --- Assistant (lot 2) ---------------------------------------------------------

    async def choisir(modele: str, question: str, trouves: list) -> str:
        """Génération courte : identifiants des passages, en JSON ; panne : nom seul."""
        if dep.complete is None:
            raise HTTPException(503, "génération indisponible")
        try:
            return await asyncio.wait_for(
                dep.complete(
                    modele,
                    assistant.messages(question, trouves),
                    json_mode=True,
                    max_tokens=assistant.MAX_TOKENS,
                    temperature=assistant.TEMPERATURE,
                    timeout=assistant.DELAI_MODELE,
                ),
                assistant.DELAI_MODELE,
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                504, "le modèle a mis trop de temps à répondre"
            ) from None
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - fournisseur : nom de l'erreur seul
            logger.warning("presidentielle/ask : %s", exc.__class__.__name__)
            raise HTTPException(502, "échec du modèle") from None

    async def rechercher(
        etat, question: str, candidats: list[str], ordre: list[str]
    ) -> tuple[list, str]:
        index = dep.index
        if index is None:
            found = presidentielle_index.rechercher_par_mots(
                etat, question, candidats, ordre
            )
            return found, "mots"
        # Version de la base nouvelle : reconstruction en arrière-plan, hors appel vocal
        # (interrompue si un appel commence)
        # En archive : aucune reconstruction d'elle-même (correction par POST /index)
        archivee = (
            presidentielle.phase_effective(etat.base, maintenant())
            == presidentielle.ARCHIVE
        )
        if index.actif() and not index.a_jour(etat) and not appel() and not archivee:
            index.lancer(etat, interrompre=appel)
        return await index.rechercher(etat, question, candidats, ordre)

    # Questions récentes par invité (adresse du compte Google écrite par ngrok)
    questions_invites: dict[str, collections.deque] = {}

    def quota_depasse(request: Request) -> bool:
        if not invite(request):
            return False
        qui = request.headers.get("x-antares-user", "").strip().lower()
        maintenant = time.monotonic()
        recentes = questions_invites.setdefault(qui, collections.deque())
        while recentes and maintenant - recentes[0] > QUOTA_FENETRE:
            recentes.popleft()
        if len(recentes) >= QUOTA_INVITE:
            return True
        recentes.append(maintenant)
        for cle in [c for c, d in questions_invites.items() if not d]:
            del questions_invites[cle]
        return False

    def trop_vite(detail: str) -> JSONResponse:
        return JSONResponse(
            {"detail": detail}, status_code=429, headers={"Retry-After": "30"}
        )

    @api.post("/ask", response_model=None)
    async def presidentielle_ask(request: Request) -> dict | JSONResponse:
        try:
            corps = CorpsQuestion.model_validate(await request.json())
        except ValueError as exc:
            raise HTTPException(422, erreurs_corps(exc)) from None
        if quota_depasse(request):
            return trop_vite(TROP_DE_QUESTIONS)
        etat = presidentielle.selon_phase(
            await asyncio.to_thread(presidentielle.charger)
        )
        if etat.base is None:
            raise HTTPException(503, etat.message or "base indisponible")
        plan = assistant.planifier(etat, corps.question, corps.ordre)
        # Refus, fiche et thème : tout de suite, même pendant un appel, sans modèle
        if plan.reponse is not None:
            return plan.reponse.json(etat)
        candidats = plan.candidats or []
        # Aucune mesure publiée chez les candidats visés (fiches d'identité seules) :
        # rien à chercher ni à choisir, réponse tout de suite, sans modèle
        if not presidentielle_index.passages(etat, candidats):
            return assistant.recherche(etat, [], plan.ordre, None, None).json(etat)
        # Appel vocal, lancé depuis ce navigateur ou ailleurs : ni recherche (requêtes
        # au RAG, reconstruction de l'index) ni modèle
        if corps.appel_en_cours or appel():
            return attente(ATTENTE_ASSISTANT)
        trouves, moteur = await rechercher(etat, corps.question, candidats, plan.ordre)
        if not trouves:
            return assistant.recherche(etat, [], plan.ordre, None, moteur).json(etat)
        autorises = etat.base.assistant.modeles_autorises
        choix = await modele_assistant(dep, autorises)
        modele = choix["modele"]
        if modele is None:
            raise HTTPException(503, choix["message"] or MODELE_REFUSE)
        # Contrôle juste avant le modèle : un appel a pu commencer pendant la recherche
        if appel():
            return attente(ATTENTE_ASSISTANT)
        try:
            await asyncio.wait_for(generation.acquire(), ATTENTE_VERROU)
        except asyncio.TimeoutError:
            return trop_vite(OCCUPE)
        try:
            if appel():
                return attente(ATTENTE_ASSISTANT)
            brut = await choisir(modele, corps.question, trouves)
        finally:
            generation.release()
        choisis = assistant.identifiants_choisis(brut, trouves)
        return assistant.recherche(etat, choisis, plan.ordre, modele, moteur).json(etat)

    @api.post("/index", response_model=None)
    async def presidentielle_index_route(request: Request) -> JSONResponse:
        # Accès local ou propriétaire, que l'indicateur de partage soit posé ou non
        if not (local(request) or proprietaire(request, dep.owner())):
            raise HTTPException(403, INVITE_REFUSE)
        brut = await request.body()
        try:
            corps = (
                CorpsIndex.model_validate_json(brut) if brut.strip() else CorpsIndex()
            )
        except ValueError as exc:
            raise HTTPException(422, erreurs_corps(exc)) from None
        etat = await asyncio.to_thread(presidentielle.charger)
        if (
            presidentielle.phase_effective(etat.base, maintenant())
            == presidentielle.ARCHIVE
        ):
            if not corps.correction:
                return JSONResponse(
                    {"kind": "archive", "detail": ARCHIVE_FIGEE}, status_code=409
                )
            logger.info(
                "presidentielle : index reconstruit en archive, correction : %r",
                corps.correction,
            )
        index = dep.index
        if index is None or not index.actif():
            return JSONResponse(
                {
                    "kind": "mots",
                    "detail": "RAG intégré non sélectionné : recherche par mots seulement",
                }
            )
        if appel():
            return attente("Appel en cours : reconstruction après l'appel")
        if etat.base is None:
            raise HTTPException(503, etat.message or "base indisponible")
        lancee = index.lancer(
            presidentielle.selon_phase(etat), force=True, interrompre=appel
        )
        return JSONResponse(
            {"kind": "index", "etat": "lancee" if lancee else "en_cours"},
            status_code=202,
        )

    # Lecture réservée (GET : hors de la garde des écritures, d'où le contrôle de
    # l'origine ici) ; `def` : lecture de fichiers dans le pool de fils
    @api.get("/nouveautes")
    def presidentielle_nouveautes(request: Request) -> JSONResponse:
        if origine_etrangere(request):
            raise HTTPException(403, "Requête refusée : elle vient d'un autre site")
        if not (local(request) or proprietaire(request, dep.owner())):
            raise HTTPException(403, INVITE_REFUSE)
        tasks_db = dep.tasks_db() if dep.tasks_db else None
        return JSONResponse(
            nouveautes(tasks_db, presidentielle.charger()),
            headers={"Cache-Control": "no-store"},
        )

    return api
