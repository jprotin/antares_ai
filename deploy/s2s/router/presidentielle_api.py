"""Routes de lecture de la base « Présidentielle 2027 » (cf. presidentielle.py), branchées
dans le routeur par `app.include_router(presidentielle_api.construire(...))`.

- GET /api/presidentielle       : base publiée (candidats triés par identifiant ; l'ordre
                                  affiché est tiré au sort par l'interface), thèmes,
                                  journal ;
- GET /api/presidentielle/meta  : partage, invité, appel en cours, modèle de l'assistant,
                                  cible (local ou cloud), jeu, version ; erreurs de
                                  fichiers pour le propriétaire et l'accès local seulement ;
- GET /api/presidentielle/quiz  : grille, rattachements, éligibilité de chaque question.

Lecture pour tous, invités d'un partage compris (veille_access.is_guest, inchangé).
Les dépendances du routeur (partage, propriétaire, réglages, disponibilité d'un modèle,
heure du dernier tour vocal, délai d'appel) sont injectées et lues à chaque requête.
Routes prévues par le plan sous /api/presidentielle (inventaire testé) : celles-ci,
puis POST ask et index (lot 2), POST extraire (lot 4a), GET nouveautes (lot 4b).
"""

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Request

import presidentielle
import presidentielle_common as common
import presidentielle_schema as schema
import veille_access

PREFIXE = "/api/presidentielle"
MODELE_REFUSE = "modèle non autorisé pour cette page"
AUCUN_MODELE = "aucun modèle autorisé disponible"


@dataclass
class Dependances:
    sharing: Callable[[], bool]
    owner: Callable[[], str]
    load_settings: Callable[[], Any]
    model_available: Callable[[str], Awaitable[bool]]
    last_voice_at: Callable[[], float]
    idle_seconds: Callable[[], int]
    now: Callable[[], float] = time.time


def cible() -> str:
    """« cloud » si ANTARES_TARGET le dit, « local » sinon."""
    value = os.environ.get("ANTARES_TARGET", "").strip().lower()
    return "cloud" if value == "cloud" else "local"


def _source(etat: presidentielle.Etat, source_id: str) -> dict | None:
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
        "mesures": [
            {
                "id": mesure.id,
                "theme": mesure.theme,
                "citation": mesure.citation,
                "nature": "candidat",
                "resume": mesure.resume,
                "source": _source(etat, mesure.source_id),
                "page": mesure.page,
                "ajoutee_le": mesure.ajoutee_le.isoformat(),
            }
            for mesure in fiche.mesures
        ],
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


def _entete(etat: presidentielle.Etat) -> dict:
    base = etat.base
    return {
        "disponible": base is not None,
        "message": etat.message or None,
        "jeu": base.jeu if base else None,
        "liste": base.liste if base else None,
        "phase": base.phase if base else None,
        "version": etat.version,
    }


def base_publiee(etat: presidentielle.Etat) -> dict:
    base = etat.base
    grille = etat.grille
    journal = sorted(etat.journal, key=lambda e: e.date, reverse=True)
    return {
        **_entete(etat),
        "tours": base.tours.model_dump(mode="json") if base else None,
        "archive_apres": base.archive_apres.isoformat() if base else None,
        "axes_statut": grille.axes_statut if grille else None,
        "themes": [
            {"id": t.id, "libelle": t.libelle, "axe": t.axe.model_dump()}
            for t in (grille.themes if grille else [])
        ],
        "candidats": [_candidat(etat, etat.fiches[s]) for s in sorted(etat.fiches)],
        "journal": [e.model_dump(mode="json", exclude_none=True) for e in journal],
    }


def quiz(etat: presidentielle.Etat) -> dict:
    grille = etat.grille
    if grille is None:
        return {
            **_entete(etat),
            "disponible": False,
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
        **_entete(etat),
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


def construire(dep: Dependances) -> APIRouter:
    api = APIRouter(prefix=PREFIXE)

    def invite(request: Request) -> bool:
        return dep.sharing() and veille_access.is_guest(request.headers, dep.owner())

    # Lectures de fichiers en `def` : pool de fils, la boucle (et la voix) n'attend pas
    @api.get("")
    def presidentielle_base() -> dict:
        return base_publiee(presidentielle.charger())

    @api.get("/quiz")
    def presidentielle_quiz() -> dict:
        return quiz(presidentielle.charger())

    @api.get("/meta")
    async def presidentielle_meta(request: Request) -> dict:
        etat = await asyncio.to_thread(presidentielle.charger)
        guest = invite(request)
        autorises = etat.base.assistant.modeles_autorises if etat.base else []
        meta = {
            **_entete(etat),
            "sharing": dep.sharing(),
            "guest": guest,
            "appel_en_cours": common.appel_en_cours(
                dep.now(), dep.last_voice_at(), dep.idle_seconds()
            ),
            "assistant": await modele_assistant(dep, autorises),
            "cible": cible(),
            "fiches": len(etat.fiches),
        }
        if not guest:
            meta["erreurs"] = [e.as_dict() for e in etat.erreurs]
        return meta

    return api
