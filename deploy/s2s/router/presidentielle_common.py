"""Contrôles communs de la présidentielle, partagés par l'assistant (lot 2) et
l'extraction (lot 4a) :

- `normaliser(texte)` : forme unique d'un texte pour comparer une citation mot pour mot
  avec le texte d'un PDF (apostrophes, guillemets, ligatures, espaces, coupures) ;
- `modele_autorise(nom, autorises)` : liste blanche lue dans base.yaml, comparaison
  exacte ; jamais de repli (`usable_model`, `fallback_model`) ni de drapeau `local` ;
- `appel_en_cours(maintenant, dernier_tour, idle_seconds)` : un tour vocal (relais
  /v1/chat/completions, cf. router.relay) date de moins de `idle_seconds` ; même
  délai que la veille (`call.idle_seconds` de tasks.yaml, 120 s par défaut).
"""

import re
import unicodedata
from collections.abc import Iterable
from pathlib import Path

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
