"""Votes réels à l'Assemblée nationale (présidentielle, lot 4b) : lecture de l'archive
des scrutins publiée en données ouvertes (data.assemblee-nationale.fr), positions d'un
député sur la liste fixée de quiz/scrutins.yaml. Fonctions pures, sans réseau : l'archive
est téléchargée à la main (cf. docs/runbooks/presidentielle-votes-et-surveillance.md),
puis lue par `presidentielle.sh votes importer` (presidentielle_tool.py).

Format lu (jeu « Scrutins » d'une législature, archive Scrutins.json.zip) : un fichier
`json/VTANR5L<législature>V<numéro>.json` par scrutin, de la forme

    {"scrutin": {
        "uid": "VTANR5L17V1234", "numero": "1234", "legislature": "17",
        "dateScrutin": "2025-01-28", "titre": "…",
        "ventilationVotes": {"organe": {"groupes": {"groupe": [
            {"organeRef": "PO…", "vote": {"decompteNominatif": {
                "pours": {"votant": [{"acteurRef": "PA…", "mandatRef": "PM…",
                                      "parDelegation": "false"}]},
                "contres": null, "abstentions": {"votant": {…}},
                "nonVotants": null, "nonVotantsVolontaires": null}}}]}}}}}

Particularités du format : un groupe ou un votant seul est un objet au lieu d'une
liste ; une catégorie vide vaut null ; les nombres sont des chaînes. Les mises au point
(`miseAuPoint`, intentions de vote déclarées après le scrutin) ne changent pas le vote
enregistré : elles ne sont pas lues.

Positions : `pour`, `contre`, `abstention`, `non_votant` (nonVotants et
nonVotantsVolontaires), et `sans_vote` quand le député ne figure dans aucune liste
(absence, ou mandat non en cours à cette date). La même liste de scrutins est rendue
pour tous les députés, `sans_vote` compris.
"""

import hashlib
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import presidentielle_schema as schema

ACTEUR = re.compile(r"^PA\d{1,8}$")
# Un fichier de scrutin pèse quelques centaines de kilo-octets : borne contre une
# archive piégée (bombe de décompression)
MEMBRE_MAX_OCTETS = 10 * 1024 * 1024
# Une législature compte quelques milliers de scrutins
MEMBRES_MAX = 100_000
CATEGORIES = (
    ("pours", "pour"),
    ("contres", "contre"),
    ("abstentions", "abstention"),
    ("nonVotants", "non_votant"),
    ("nonVotantsVolontaires", "non_votant"),
)
SANS_VOTE = "sans_vote"


class ErreurArchive(Exception):
    """Archive illisible, scrutin absent ou incohérent : rien n'est écrit."""


@dataclass(frozen=True)
class Decompte:
    uid: str
    numero: int
    legislature: int
    date: date
    # Position de chaque député (acteurRef) inscrit dans une liste du scrutin
    positions: dict[str, str]
    # Empreinte SHA-256 du fichier du scrutin dans l'archive
    sha256: str


def acteur_valide(valeur: str) -> bool:
    return bool(ACTEUR.match(valeur or ""))


def _liste(valeur: Any) -> list:
    """Objet seul ou liste (format de l'Assemblée) ; null : liste vide."""
    if valeur is None:
        return []
    return valeur if isinstance(valeur, list) else [valeur]


def _entier(valeur: Any, quoi: str, uid: str) -> int:
    try:
        return int(str(valeur))
    except ValueError:
        raise ErreurArchive(f"{uid} : {quoi} illisible") from None


def lire_decompte(octets: bytes, uid_attendu: str) -> Decompte:
    """Décompte nominatif d'un fichier de scrutin ; ErreurArchive s'il est illisible ou
    s'il ne s'agit pas du scrutin attendu."""
    try:
        data = json.loads(octets)
        scrutin = data["scrutin"]
        uid = str(scrutin["uid"])
        groupes = scrutin["ventilationVotes"]["organe"]["groupes"]
    except (ValueError, KeyError, TypeError, RecursionError):
        raise ErreurArchive(f"{uid_attendu} : fichier de scrutin illisible") from None
    if uid != uid_attendu:
        raise ErreurArchive(f"{uid_attendu} : le fichier contient le scrutin {uid}")
    # Anciennes archives : seuls les votes contraires à la position du groupe sont
    # listés (DecompteDissidentsPositionGroupe) ; les lire donnerait des votes faux
    mode = scrutin.get("modePublicationDesVotes")
    if mode is not None and mode != "DecompteNominatif":
        raise ErreurArchive(f"{uid} : publication des votes « {mode} » non gérée")
    try:
        jour = date.fromisoformat(str(scrutin["dateScrutin"])[:10])
    except (KeyError, ValueError):
        raise ErreurArchive(f"{uid} : date du scrutin illisible") from None
    positions: dict[str, str] = {}
    for groupe in _liste((groupes or {}).get("groupe")):
        if not isinstance(groupe, dict):
            raise ErreurArchive(f"{uid} : groupe illisible")
        vote = groupe.get("vote")
        nominatif = vote.get("decompteNominatif") if isinstance(vote, dict) else None
        if not isinstance(nominatif, dict):
            raise ErreurArchive(f"{uid} : décompte nominatif illisible")
        for cle, position in CATEGORIES:
            categorie = nominatif.get(cle) or {}
            if not isinstance(categorie, dict):
                raise ErreurArchive(f"{uid} : liste {cle} illisible")
            for votant in _liste(categorie.get("votant")):
                acteur = votant.get("acteurRef") if isinstance(votant, dict) else None
                if not isinstance(acteur, str) or not acteur_valide(acteur):
                    raise ErreurArchive(f"{uid} : votant illisible")
                if positions.get(acteur, position) != position:
                    raise ErreurArchive(f"{uid} : {acteur} inscrit dans deux listes")
                positions[acteur] = position
    return Decompte(
        uid=uid,
        numero=_entier(scrutin.get("numero"), "numéro", uid),
        legislature=_entier(scrutin.get("legislature"), "législature", uid),
        date=jour,
        positions=positions,
        sha256=hashlib.sha256(octets).hexdigest(),
    )


class Archive:
    """Archive Scrutins.json.zip, lue sans rien extraire sur le disque ; seuls les
    scrutins demandés sont ouverts."""

    def __init__(self, chemin: Path):
        self.chemin = chemin
        self.membres: dict[str, zipfile.ZipInfo] = {}
        try:
            self._zip = zipfile.ZipFile(chemin)
        except (OSError, zipfile.BadZipFile):
            raise ErreurArchive(
                f"{chemin.name} : archive zip des scrutins illisible"
            ) from None
        infos = self._zip.infolist()
        if len(infos) > MEMBRES_MAX:
            self._zip.close()
            raise ErreurArchive(f"{chemin.name} : plus de {MEMBRES_MAX} fichiers")
        for info in infos:
            nom = Path(info.filename)
            if not info.is_dir() and nom.suffix == ".json":
                self.membres.setdefault(nom.stem, info)

    def __enter__(self) -> "Archive":
        return self

    def __exit__(self, *exc: object) -> None:
        self._zip.close()

    def octets(self, uid: str) -> bytes | None:
        membre = self.membres.get(uid)
        if membre is None:
            return None
        if membre.file_size > MEMBRE_MAX_OCTETS:
            raise ErreurArchive(f"{uid} : fichier trop volumineux")
        with self._zip.open(membre) as flux:
            octets = flux.read(MEMBRE_MAX_OCTETS + 1)
        if len(octets) > MEMBRE_MAX_OCTETS:
            raise ErreurArchive(f"{uid} : fichier trop volumineux")
        return octets


def decompte(archives: list[Archive], scrutin: schema.ScrutinRetenu) -> Decompte:
    """Décompte du scrutin, lu dans la première archive qui le contient (une archive
    par législature), contrôlé contre quiz/scrutins.yaml."""
    octets = next(
        (o for archive in archives if (o := archive.octets(scrutin.uid)) is not None),
        None,
    )
    if octets is None:
        raise ErreurArchive(
            f"scrutin {scrutin.id} ({scrutin.uid}) absent des archives : archive "
            "d'une autre législature, ou trop ancienne"
        )
    decompte = lire_decompte(octets, scrutin.uid)
    if (decompte.numero, decompte.legislature) != (
        scrutin.numero,
        scrutin.legislature,
    ):
        raise ErreurArchive(f"scrutin {scrutin.id} : numéro ou législature différent")
    if decompte.date != scrutin.date:
        raise ErreurArchive(
            f"scrutin {scrutin.id} : date {decompte.date} dans l'archive, "
            f"{scrutin.date} dans quiz/scrutins.yaml"
        )
    return decompte


@dataclass(frozen=True)
class VoteLu:
    scrutin: schema.ScrutinRetenu
    position: str
    sha256: str


def votes_de(
    archives: list[Archive], scrutins: list[schema.ScrutinRetenu], acteur: str
) -> list[VoteLu]:
    """Position du député sur chaque scrutin de la liste, dans l'ordre de la liste ;
    ErreurArchive si un scrutin manque (la liste est la même pour tous)."""
    if not acteur_valide(acteur):
        raise ErreurArchive(f"identifiant de député invalide : {acteur} (PA… attendu)")
    lus = []
    for scrutin in scrutins:
        lu = decompte(archives, scrutin)
        lus.append(
            VoteLu(
                scrutin=scrutin,
                position=lu.positions.get(acteur, SANS_VOTE),
                sha256=lu.sha256,
            )
        )
    return lus


def source_id(scrutin: schema.ScrutinRetenu) -> str:
    return f"scrutin-{scrutin.id}"


def source_du_scrutin(lu: VoteLu, consulte_le: date) -> dict:
    """Entrée de sources.yaml (niveau vote_reel) pour un scrutin de la liste."""
    s = lu.scrutin
    return {
        "id": source_id(s),
        "titre": (
            f"Assemblée nationale, scrutin n° {s.numero} ({s.legislature}e "
            f"législature) : {s.titre}"
        ),
        "url": s.url,
        "niveau": "vote_reel",
        "publie_le": s.date,
        "consulte_le": consulte_le,
        "sha256": lu.sha256,
    }


def vote_de_fiche(lu: VoteLu) -> dict:
    """Entrée `votes` d'une fiche pour un scrutin de la liste."""
    s = lu.scrutin
    return {
        "id": source_id(s),
        "scrutin": f"Scrutin n° {s.numero} ({s.legislature}e législature) : {s.titre}",
        "date": s.date,
        "position": lu.position,
        "theme": s.theme,
        "source_id": source_id(s),
    }


def empreinte(scrutins: list[schema.ScrutinRetenu]) -> str:
    """Empreinte de la liste (journal du gel) : sha256 du JSON canonique."""
    texte = json.dumps(
        [s.model_dump(mode="json") for s in scrutins],
        sort_keys=True,
        ensure_ascii=False,
    )
    return "sha256:" + hashlib.sha256(texte.encode("utf-8")).hexdigest()
