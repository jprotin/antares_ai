"""Contrôles communs de la présidentielle, partagés par l'assistant (lot 2) et
l'extraction (lot 4a) :

- `normaliser(texte)` : forme unique d'un texte pour comparer une citation mot pour mot
  avec le texte d'un PDF (apostrophes, guillemets, ligatures, espaces, coupures) ;
- `texte_de_controle(pages)` et `pages_de_citation(controle, citation)` : recherche
  d'une citation dans le texte d'une source, y compris à cheval sur un ou plusieurs
  sauts de page, numéros de page et titres courants (ligne répétée en tête ou en pied
  de page) ignorés aux abords du saut (seule règle de recherche : outil
  verifier/extraire, vue « Évolution ») ;
- `modele_autorise(nom, autorises)` : liste blanche lue dans base.yaml, comparaison
  exacte ; jamais de repli (`usable_model`, `fallback_model`) ni de drapeau `local` ;
- `appel_en_cours(maintenant, dernier_tour, idle_seconds)` : un tour vocal (relais
  /v1/chat/completions, cf. router.relay) date de moins de `idle_seconds` ; même
  délai que la veille (`call.idle_seconds` de tasks.yaml, 120 s par défaut).
"""

import bisect
import re
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

import veille_prompt

_APOSTROPHES = "\u2019\u2018\u201a\u201b\u02bc\u2032\u00b4`"
_GUILLEMETS = "\u201c\u201d\u201e\u201f\u2033"
_LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
}
# Espaces insécables, fines, tabulations... -> espace simple ; invisibles retirés
_ESPACES = "\u00a0\u202f\u2007\u2009\u200a\u2002\u2003\u2004\u2005\u2006\u2008\t\r\f\v"
_INVISIBLES = "\u00ad\u200b\u200c\u200d\u2060\ufeff"
_TIRETS = "\u2010\u2011\u2012\u2013\u2014\u2212"
_TABLE = str.maketrans(
    {
        **{c: "'" for c in _APOSTROPHES},
        **{c: '"' for c in _GUILLEMETS},
        **_LIGATURES,
        **{c: " " for c in _ESPACES},
        **{c: "" for c in _INVISIBLES},
        **{c: "-" for c in _TIRETS},
        "\u2026": "...",
    }
)


def normaliser(texte: str) -> str:
    """Forme comparable d'un texte, idempotente.

    Règle des coupures de ligne : un tiret en fin de ligne suivi d'une minuscule est une
    césure (« écono-\\nmie » -> « économie ») ; « porte-\\nparole » devient donc
    « porteparole » des deux côtés de la comparaison. Toute autre fin de ligne devient
    une espace. La casse et les mots (« ne … pas ») sont gardés.
    """
    texte = unicodedata.normalize("NFC", texte).translate(_TABLE)
    texte = re.sub(r"(\w)-[ ]*\n[ ]*(?=[a-z\u00e0-\u00ff\u0153\u00e6])", r"\1", texte)
    texte = re.sub(r"\s+", " ", texte)
    # Guillemets français : « texte » -> "texte"
    texte = re.sub(r"«\s*", '"', texte)
    texte = re.sub(r"\s*»", '"', texte)
    return texte.strip()


# Ligne faite seulement d'un numéro de page (pied ou en-tête) : « 12 », « - 12 - »,
# « 12/40 », « 12 / 40 » ; le numéro ne dépasse pas le nombre de pages + MARGE_NUMERO
# (une année, un montant en bord de page n'est pas un numéro de page)
MARGE_NUMERO = 10
_NUMERO_DE_PAGE = re.compile(
    r"[ \t\u00a0\u202f]*[-\u2010-\u2014\u2212]?[ \t\u00a0\u202f]*([0-9]{1,4})"
    r"(?:[ \t\u00a0\u202f]*/[ \t\u00a0\u202f]*[0-9]{1,4})?"
    r"[ \t\u00a0\u202f]*[-\u2010-\u2014\u2212]?[ \t\u00a0\u202f]*"
)
# Césure à cheval sur deux pages, comme dans normaliser (« écono- » | « mie »)
_CESURE_FIN = re.compile(r"\w-$")
_MINUSCULE_DEBUT = re.compile(r"^[a-z\u00e0-\u00ff\u0153\u00e6]")


# Titre courant : ligne répétée à l'identique en tête (ou en pied) de page : titre du
# livret, nom du mouvement, adresse du site. Cherché parmi les LIGNES_DE_BORD premières
# (ou dernières) lignes non vides de chaque page, tête et pied comptés à part ; retenu
# s'il revient sur au moins PAGES_TITRE_COURANT pages, ou sur au moins
# POURCENT_TITRE_COURANT % des pages d'un petit document (jamais moins de 2 pages)
LIGNES_DE_BORD = 3
PAGES_TITRE_COURANT = 3
POURCENT_TITRE_COURANT = 30
_LETTRE = re.compile(r"[^\W\d_]")


class TitresCourants(NamedTuple):
    """Clés (`_cle_de_ligne`) des titres courants de tête et de pied d'un document."""

    tete: frozenset[str]
    pied: frozenset[str]


def _cle_de_ligne(ligne: str, nombre_de_pages: int) -> str:
    """Forme de comparaison d'une ligne de bord : espaces normalisés, chaque nombre qui
    peut être un numéro de page (au plus nombre de pages + MARGE_NUMERO) remplacé par
    « # » (« Programme 2027 - page 12 » = « … page 13 ») ; vide pour une ligne sans
    lettre (un numéro de page seul relève du bornage des numéros)."""
    cle = normaliser(ligne)
    if not _LETTRE.search(cle):
        return ""
    return re.sub(
        r"[0-9]+",
        lambda m: "#" if int(m[0]) <= nombre_de_pages + MARGE_NUMERO else m[0],
        cle,
    )


def _titres_courants(pages: list[str]) -> TitresCourants:
    """Titres courants du document, en tête et en pied de page."""
    # Arrondi au-dessus, en entiers : 30 % de 10 pages = 3 pages
    part = -(-len(pages) * POURCENT_TITRE_COURANT // 100)
    seuil = max(2, min(PAGES_TITRE_COURANT, part))
    tete: dict[str, int] = {}
    pied: dict[str, int] = {}
    for page in pages:
        lignes = [ligne for ligne in page.split("\n") if ligne.strip()]
        for compte, bord in (
            (tete, lignes[:LIGNES_DE_BORD]),
            (pied, lignes[-LIGNES_DE_BORD:]),
        ):
            for cle in {_cle_de_ligne(ligne, len(pages)) for ligne in bord} - {""}:
                compte[cle] = compte.get(cle, 0) + 1
    return TitresCourants(
        *(
            frozenset(cle for cle, nombre in compte.items() if nombre >= seuil)
            for compte in (tete, pied)
        )
    )


def _sans_lignes_de_bord(
    page: str, nombre_de_pages: int, titres: TitresCourants
) -> str:
    """Page sans ses lignes de bord vides, faites d'un numéro de page ou d'un titre
    courant (de tête au début, de pied à la fin), dans les LIGNES_DE_BORD premières et
    dernières lignes non vides."""

    def numero_ou_vide(ligne: str) -> bool:
        if not ligne.strip():
            return True
        numero = _NUMERO_DE_PAGE.fullmatch(ligne)
        return numero is not None and int(numero[1]) <= nombre_de_pages + MARGE_NUMERO

    def retirer(lignes: list[str], rang: int, cles: frozenset[str]) -> None:
        non_vides = 0
        while lignes and non_vides < LIGNES_DE_BORD:
            ligne = lignes[rang]
            if ligne.strip():
                non_vides += 1
            if numero_ou_vide(ligne) or _cle_de_ligne(ligne, nombre_de_pages) in cles:
                lignes.pop(rang)
            else:
                return
        # Au-delà de la fenêtre : seulement des lignes vides ou des numéros, comme avant
        while lignes and numero_ou_vide(lignes[rang]):
            lignes.pop(rang)

    lignes = page.split("\n")
    retirer(lignes, 0, titres.tete)
    retirer(lignes, -1, titres.pied)
    return "\n".join(lignes)


class TexteControle(NamedTuple):
    """Texte d'une source prêt pour la recherche des citations (jamais écrit : le texte
    stocké dans textes/ reste tel quel).

    `pages` : chaque page normalisée telle quelle ; `texte` : les pages réunies, chaque
    saut de page et les lignes voisines faites d'un numéro de page ou d'un titre
    courant remplacés par une espace (césure recollée) ; `debuts` : position de chaque
    page dans `texte`.
    """

    pages: tuple[str, ...]
    texte: str
    debuts: tuple[int, ...]


def texte_de_controle(pages: Iterable[str]) -> TexteControle:
    """Forme de recherche du texte d'une source, page par page (pages séparées par un
    saut de page dans textes/<sha256>.txt)."""
    pages = list(pages)
    titres = _titres_courants(pages)
    morceaux: list[str] = []
    debuts: list[int] = []
    longueur = 0
    # Fin de la dernière page non vide : césure, guillemet ouvrant « (normaliser colle
    # le texte qui le suit)
    cesure = ouvrant = False
    for page in pages:
        brute = _sans_lignes_de_bord(page, len(pages), titres)
        morceau = normaliser(brute)
        if morceaux and morceau:
            if cesure and _MINUSCULE_DEBUT.match(morceau):
                # « écono- » | « mie » -> « économie » (le tiret est retiré)
                morceaux[-1] = morceaux[-1][:-1]
                longueur -= 1
                # Pages vides entre les deux : même début, liste triée (bisect)
                rang = len(debuts) - 1
                while rang >= 0 and debuts[rang] > longueur:
                    debuts[rang] = longueur
                    rang -= 1
            elif not ouvrant and not brute.lstrip().startswith("\u00bb"):
                morceaux.append(" ")
                longueur += 1
        debuts.append(longueur)
        if morceau:
            morceaux.append(morceau)
            longueur += len(morceau)
            cesure = bool(_CESURE_FIN.search(morceau))
            ouvrant = brute.rstrip().endswith("\u00ab")
    return TexteControle(
        tuple(normaliser(p) for p in pages), "".join(morceaux), tuple(debuts)
    )


def pages_de_citation(controle: TexteControle, citation: str) -> list[int]:
    """Pages (numérotées à partir de 1, croissantes) où commence une occurrence de la
    citation normalisée : dans une page seule, ou à cheval sur des sauts de page ;
    liste vide si la citation est introuvable."""
    cible = normaliser(citation)
    if not cible:
        return []
    trouvees = {n for n, page in enumerate(controle.pages, 1) if cible in page}
    position = controle.texte.find(cible)
    while position != -1:
        # Dernière page qui commence à cette position ou avant (une page vide a le même
        # début que la suivante : la suivante l'emporte)
        trouvees.add(max(bisect.bisect_right(controle.debuts, position), 1))
        position = controle.texte.find(cible, position + 1)
    return sorted(trouvees)


def modele_autorise(nom: object, autorises: Iterable[str]) -> bool:
    """Vrai seulement si `nom` figure tel quel dans la liste blanche (liste vide : refus)."""
    if not isinstance(nom, str) or not nom:
        return False
    return nom in set(autorises)


def appel_en_cours(
    maintenant: float, dernier_tour: float | None, idle_seconds: float
) -> bool:
    """Vrai si le dernier tour vocal date de moins de `idle_seconds` (borne stricte)."""
    if not dernier_tour:
        return False
    return maintenant - dernier_tour < idle_seconds


def delai_appel(tasks_config: Path) -> int:
    """`call.idle_seconds` de tasks.yaml, 120 s si le fichier ou la clé manque."""
    return veille_prompt.load_settings(tasks_config).call.idle_seconds
