"""Index des passages relus de la présidentielle (lot 2) : ce que l'assistant peut citer.

Un passage est une mesure d'une fiche publiée : identifiant `p27:<slug>:<mesure_id>`,
texte de recherche de moins de 1 000 caractères (thème, citation, résumé). Le texte
affiché n'est jamais celui de l'index : l'assistant le relit dans la base publiée, et un
identifiant qui n'y existe plus est écarté.

Deux moteurs de recherche :
- par mots, en Python, sans service : toujours disponible (portabilité local et cloud) ;
- par le sens, par le RAG intégré d'antares (Connexions : RAG intégré), seulement quand
  l'index est à jour pour la version de la base ; sinon, et en cas de panne, par mots.

Reconstruction (POST /api/presidentielle/index, ou d'elle-même quand la version change) :
sous un verrou, l'index est marqué périmé (état sans version), les collections des
candidats de la base et celles de l'index précédent (liste gardée dans l'état) sont
supprimées dans Qdrant (jamais les autres `proj-p27-*`), puis recréées par un appel direct à `POST /documents` du service
RAG avec le jeton du mode intégré (ragstore.add_document reste inchangé) ; l'état
(version de la base) n'est écrit qu'à la fin. Après un retour arrière de la base, aucun
ancien passage ne peut donc être cité. Le RAG d'ai-to-boost (mode existant) n'est
jamais écrit.

Aucun texte de question n'est journalisé ; une panne ne laisse que le nom de l'erreur.
"""

import asyncio
import json
import logging
import math
import os
import re
import tempfile
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

import httpx

import presidentielle
import presidentielle_schema as schema
import rag

PREFIXE_DOC = "p27"
# Collections du RAG : proj-p27-<slug> (masquées des Réglages et des projets, cf. rag.py)
PREFIXE_COLLECTION = "proj-p27-"
PASSAGE_MAX = 999
PAR_CANDIDAT = 2
TOTAL = 12
# Recherche par le sens : une requête par candidat (qui a des mesures), toutes en
# parallèle, au plus PAR_CANDIDAT résultats chacune (aucun candidat ne prend la place des
# autres), dans un délai borné (DELAI_SENS pour l'ensemble)
DELAI_SENS = 20
REQUETES_SIMULTANEES = 6
# Après une reconstruction en échec, pas de nouvel essai automatique avant ce délai
REESSAI_SECONDES = 300
_SEGMENT = r"[a-z0-9]+(?:-[a-z0-9]+)*"
DOC_ID = re.compile(rf"^{PREFIXE_DOC}:({_SEGMENT}):({_SEGMENT})$")
# Mots trop courants pour départager deux passages
MOTS_VIDES = frozenset(
    """
    a au aux avec ce ces cet cette comment dans de des du elle elles en est et etre il ils
    je la le les leur leurs lui ma mais me mes moi mon ne nos notre nous on ou par pas
    pense pensent plus pour pourquoi propose proposent proposer qu que quel quelle quelles
    quels qui quoi sa se ses son sont sur ta te tes toi ton tu un une vos votre vous y
    dit disent veut veulent fait font sujet question candidat candidate candidats
    candidates programme programmes position positions mesure mesures
    """.split()
)

logger = logging.getLogger("router")


@dataclass(frozen=True)
class Passage:
    id: str
    candidat: str
    mesure: str
    theme: str
    texte: str


def doc_id(candidat: str, mesure: str) -> str:
    return f"{PREFIXE_DOC}:{candidat}:{mesure}"


def lire_doc_id(value: object) -> tuple[str, str] | None:
    """(candidat, mesure) d'un identifiant bien formé, None sinon (« p27:../x »...)."""
    if not isinstance(value, str):
        return None
    found = DOC_ID.fullmatch(value)
    return (found.group(1), found.group(2)) if found else None


def collection(candidat: str) -> str:
    return f"{PREFIXE_COLLECTION}{candidat}"


def _texte(libelle: str, mesure: schema.Mesure) -> str:
    morceaux = [libelle, mesure.citation, mesure.resume or ""]
    texte = "\n".join(m.strip() for m in morceaux if m and m.strip())
    return texte[:PASSAGE_MAX]


def passages(
    etat: presidentielle.Etat, candidats: Iterable[str] | None = None
) -> list[Passage]:
    """Passages des fiches publiées (de `candidats` seulement, s'ils sont donnés)."""
    retenus = set(etat.fiches) if candidats is None else set(candidats)
    found = []
    for slug in sorted(retenus & set(etat.fiches)):
        for mesure in etat.fiches[slug].mesures:
            found.append(
                Passage(
                    doc_id(slug, mesure.id),
                    slug,
                    mesure.id,
                    mesure.theme,
                    _texte(presidentielle.libelle_theme(etat, mesure.theme), mesure),
                )
            )
    return found


def retrouver(etat: presidentielle.Etat, identifiant: object) -> Passage | None:
    """Passage d'un identifiant, relu dans la base publiée ; None s'il n'y est plus."""
    lu = lire_doc_id(identifiant)
    if lu is None or lu[0] not in etat.fiches:
        return None
    for passage in passages(etat, [lu[0]]):
        if passage.mesure == lu[1]:
            return passage
    return None


def borner(
    trouves: Iterable[Passage], par_candidat: int = PAR_CANDIDAT, total: int = TOTAL
) -> list[Passage]:
    """Au plus `par_candidat` passages par candidat et `total` en tout, dans l'ordre."""
    gardes: list[Passage] = []
    compte: dict[str, int] = {}
    vus: set[str] = set()
    for passage in trouves:
        if passage.id in vus or compte.get(passage.candidat, 0) >= par_candidat:
            continue
        gardes.append(passage)
        vus.add(passage.id)
        compte[passage.candidat] = compte.get(passage.candidat, 0) + 1
        if len(gardes) >= total:
            break
    return gardes


# --- Recherche par mots -------------------------------------------------------------


def _racine(mot: str) -> str:
    """Pluriels simples : « médecins » et « médecin » se valent."""
    if len(mot) > 4 and mot[-1] in "sx":
        return mot[:-1]
    return mot


def mots(texte: str) -> set[str]:
    """Racines des mots significatifs, sans accents ni casse (« éducation » = « education »)."""
    brut = re.findall(r"[a-z0-9]+", schema.sans_accents(texte).replace("'", " "))
    return {_racine(m) for m in brut if len(m) > 2 and m not in MOTS_VIDES}


def rang_candidat(ordre: Iterable[str] | None) -> Callable[[str], int]:
    """Rang d'un candidat dans l'ordre tiré au sort (inconnus à la fin)."""
    rangs = {slug: i for i, slug in enumerate(ordre or [])}
    return lambda slug: rangs.get(slug, len(rangs))


def rechercher_par_mots(
    etat: presidentielle.Etat,
    question: str,
    candidats: Iterable[str],
    ordre: Iterable[str] | None = None,
) -> list[Passage]:
    """Passages qui partagent le plus de mots avec la question, bornés (2 par candidat,
    12 en tout) ; aucun si aucun mot commun. À score égal, l'ordre tiré au sort départage
    les candidats (jamais l'ordre alphabétique)."""
    cherches = mots(question)
    if not cherches:
        return []
    rang = rang_candidat(ordre)
    notes = []
    for position, passage in enumerate(passages(etat, candidats)):
        communs = len(cherches & mots(passage.texte))
        if communs:
            notes.append((-communs, rang(passage.candidat), position, passage))
    notes.sort(key=lambda n: n[:3])
    return borner(n[3] for n in notes)


# --- Index par le sens (RAG intégré) -------------------------------------------------


class Index:
    """Index par le sens dans le RAG intégré ; `config` rend la connexion RAG
    (connections.rag), `http` le client du service et de Qdrant."""

    def __init__(self, etat_index: Path, config, http: httpx.AsyncClient) -> None:
        self.etat_index = etat_index
        self.config = config
        self.http = http
        self.verrou = asyncio.Lock()
        self.tache: asyncio.Task | None = None
        self.echec_le: float | None = None

    def actif(self) -> bool:
        config = self.config()
        return (
            config.mode == "integrated"
            and bool(config.url)
            and bool(config.qdrant_url)
            and bool(config.write_token)
        )

    def _etat_lu(self) -> dict:
        try:
            data = json.loads(self.etat_index.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def version_indexee(self) -> str | None:
        version = self._etat_lu().get("version")
        return version if isinstance(version, str) else None

    def collections_indexees(self) -> set[str]:
        """Collections écrites par le dernier index enregistré (bien formées seulement)."""
        noms = self._etat_lu().get("collections")
        if not isinstance(noms, list):
            return set()
        return {
            n
            for n in noms
            if isinstance(n, str)
            and n.startswith(PREFIXE_COLLECTION)
            and re.fullmatch(_SEGMENT, n.removeprefix(PREFIXE_COLLECTION))
        }

    def a_jour(self, etat: presidentielle.Etat) -> bool:
        return (
            self.actif()
            and bool(etat.version)
            and self.version_indexee() == etat.version
        )

    def en_cours(self) -> bool:
        return self.verrou.locked() or (
            self.tache is not None and not self.tache.done()
        )

    def _perimer(self, collections: Iterable[str]) -> None:
        """Index périmé (sans version) ; la liste des collections qui peuvent exister
        est gardée, pour qu'une reconstruction en échec ne les fasse pas oublier."""
        self._ecrire_etat(None, 0, collections)

    def _ecrire_etat(
        self, version: str | None, nombre: int, collections: Iterable[str] = ()
    ) -> None:
        self.etat_index.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.etat_index.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fichier:
            json.dump(
                {
                    "version": version,
                    "passages": nombre,
                    "collections": sorted(collections),
                    "le": int(time.time()),
                },
                fichier,
            )
        os.replace(tmp, self.etat_index)

    async def _collections_p27(self, config) -> list[str]:
        response = await self.http.get(f"{config.qdrant_url}/collections")
        response.raise_for_status()
        noms = [c["name"] for c in response.json()["result"]["collections"]]
        return sorted(n for n in noms if n.startswith(PREFIXE_COLLECTION))

    async def reconstruire(
        self,
        etat: presidentielle.Etat,
        interrompre: Callable[[], bool] | None = None,
    ) -> int:
        """Efface puis recrée tout l'index ; nombre de passages indexés. `interrompre`
        (appel vocal commencé) est lu entre deux passages : la reconstruction s'arrête,
        l'index reste périmé et l'assistant cherche par mots."""
        async with self.verrou:
            if not self.actif():
                raise RuntimeError("RAG intégré non sélectionné")
            config = self.config()
            # Collections à remplacer : celles des candidats de la base et celles de
            # l'index précédent (candidat retiré de la vue, entre les tours) ; jamais
            # tout le préfixe proj-p27-*, qui pourrait désigner un projet RAG d'un autre
            # usage. Lues avant d'effacer l'état.
            connues = {collection(slug) for slug in etat.fiches}
            connues |= await asyncio.to_thread(self.collections_indexees)
            # Index périmé pendant la reconstruction : l'assistant cherche par mots
            await asyncio.to_thread(self._perimer, connues)
            for nom in await self._collections_p27(config):
                if nom not in connues:
                    continue
                response = await self.http.delete(
                    f"{config.qdrant_url}/collections/{nom}"
                )
                if response.status_code not in (200, 404):
                    raise RuntimeError(f"suppression refusée ({response.status_code})")
            tous = passages(etat)
            for passage in tous:
                if interrompre is not None and interrompre():
                    raise RuntimeError("reconstruction interrompue par un appel vocal")
                response = await self.http.post(
                    f"{config.url}/documents",
                    json={
                        "collection": collection(passage.candidat),
                        "doc_id": passage.id,
                        "text": passage.texte,
                        "metadata": {
                            "source": f"{passage.candidat}/{passage.mesure}",
                            "origin": "presidentielle",
                            "kind": "passage",
                        },
                    },
                    headers={"Authorization": f"Bearer {config.write_token}"},
                )
                if response.status_code != 200:
                    raise RuntimeError(f"indexation refusée ({response.status_code})")
            # Collections écrites : à remplacer à la prochaine reconstruction
            ecrites = {collection(p.candidat) for p in tous}
            await asyncio.to_thread(self._ecrire_etat, etat.version, len(tous), ecrites)
            rag.invalidate_projects()
            return len(tous)

    def lancer(
        self,
        etat: presidentielle.Etat,
        force: bool = False,
        interrompre: Callable[[], bool] | None = None,
    ) -> bool:
        """Reconstruction en tâche de fond, si aucune n'est en cours (ni, sauf `force`,
        n'a échoué il y a moins de REESSAI_SECONDES) ; vrai si lancée."""
        if not self.actif() or self.en_cours():
            return False
        recent = (
            self.echec_le is not None
            and time.monotonic() - self.echec_le < REESSAI_SECONDES
        )
        if recent and not force:
            return False

        async def tache() -> None:
            try:
                nombre = await self.reconstruire(etat, interrompre)
                logger.info("presidentielle : index reconstruit (%d passages)", nombre)
            except Exception as exc:  # noqa: BLE001 - nom de l'erreur seul
                self.echec_le = time.monotonic()
                logger.warning(
                    "presidentielle : index non reconstruit (%s)",
                    exc.__class__.__name__,
                )

        self.tache = asyncio.get_running_loop().create_task(tache())
        return True

    async def rechercher_par_le_sens(
        self,
        etat: presidentielle.Etat,
        question: str,
        candidats: Iterable[str],
        ordre: Iterable[str] | None = None,
    ) -> list[Passage]:
        """Passages retrouvés par le RAG : une requête par candidat qui a au moins une
        mesure, toutes en parallèle (au plus PAR_CANDIDAT résultats chacune : aucun
        candidat ne prend la place des autres) ; candidat et mesure tirés de `doc_id`,
        passage relu dans la base (un identifiant absent de la base, ou rangé dans la
        collection d'un autre candidat, est écarté). Classement comme la recherche par
        mots : score renvoyé d'abord, puis l'ordre tiré au sort ; puis bornes."""
        config = self.config()
        rang = rang_candidat(ordre)
        retenus = sorted(
            {c for c in candidats if c in etat.fiches and etat.fiches[c].mesures},
            key=lambda c: (rang(c), c),
        )

        # Requêtes simultanées bornées : 27 candidats ne font pas 27 calculs
        # d'embedding à la fois dans le service RAG
        simultanees = asyncio.Semaphore(REQUETES_SIMULTANEES)

        async def requete(slug: str) -> list[tuple[float, Passage]]:
            async with simultanees:
                response = await self.http.post(
                    f"{config.url}/query",
                    json={
                        "collections": [collection(slug)],
                        "query": question,
                        "limit": PAR_CANDIDAT,
                    },
                )
            response.raise_for_status()
            data = response.json()
            hits = data.get("hits", []) if isinstance(data, dict) else []
            found = []
            for hit in hits if isinstance(hits, list) else []:
                if not isinstance(hit, dict):
                    continue
                passage = retrouver(etat, hit.get("doc_id"))
                if passage is None or passage.candidat != slug:
                    continue
                if hit.get("collection") != collection(slug):
                    continue
                score = hit.get("score")
                valeur = (
                    float(score)
                    if isinstance(score, (int, float)) and math.isfinite(score)
                    else 0.0
                )
                found.append((valeur, passage))
            return found

        # Une requête en échec (ou le délai dépassé) annule les autres : aucun calcul
        # d'embedding ne continue en arrière-plan ; l'erreur remonte, recherche par mots
        taches = [asyncio.ensure_future(requete(slug)) for slug in retenus]
        try:
            reponses = await asyncio.gather(*taches)
        except BaseException:
            for tache in taches:
                tache.cancel()
            raise
        notes = [
            (-score, rang(passage.candidat), position, passage)
            for position, (score, passage) in enumerate(
                trouve for liste in reponses for trouve in liste
            )
        ]
        notes.sort(key=lambda n: n[:3])
        return borner(n[3] for n in notes)

    async def rechercher(
        self,
        etat: presidentielle.Etat,
        question: str,
        candidats: Iterable[str],
        ordre: Iterable[str] | None = None,
    ) -> tuple[list[Passage], str]:
        """(passages, moteur) : par le sens si l'index est à jour (et qu'aucune
        reconstruction n'est en cours), sinon, en cas de panne ou au-delà de DELAI_SENS,
        par mots."""
        candidats = list(candidats)
        ordre = list(ordre or [])
        if self.a_jour(etat) and not self.en_cours():
            try:
                found = await asyncio.wait_for(
                    self.rechercher_par_le_sens(etat, question, candidats, ordre),
                    DELAI_SENS,
                )
                return found, "sens"
            except (
                httpx.HTTPError,
                asyncio.TimeoutError,
                KeyError,
                ValueError,
                TypeError,
                AttributeError,
            ) as exc:
                logger.warning(
                    "presidentielle : recherche par le sens indisponible (%s)",
                    exc.__class__.__name__,
                )
        return rechercher_par_mots(etat, question, candidats, ordre), "mots"
