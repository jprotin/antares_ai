"""Textes de la veille : clés de titre, mots, renvois « (a11) » retirés, une seule phrase.

Règles fixées (et figées par les tests, cf. spec C4) :
- `title_key` : minuscules, accents et ponctuation retirés, mots vides retirés ;
- `clean_refs` : groupe entre parenthèses ou crochets qui contient un renvoi (« (a11) »,
  « [c3, c7] », « (cf. c12) ») retiré ; renvoi isolé retiré seulement s'il désigne un
  candidat connu ; espaces resserrés, ponctuation orpheline corrigée ;
- `one_sentence` : coupure à la première fin de phrase, point final ajouté s'il manque,
  longueur bornée (coupure au dernier mot, « … »).
"""

import difflib
import re
import unicodedata
from collections.abc import Iterable

STOPWORDS = set(
    "a au aux avec ce ces d dans de des du en et l la le les leur un une ou par pour "
    "sur sans son sa ses se qu que qui the of to for and an in on with by is".split()
)

REF_GROUP_RE = re.compile(r"\s*[\[(][^\])]*\b[ac]\d{1,3}\b[^\])]*[\])]", re.IGNORECASE)
REF_RE = re.compile(r"\b[ac]\d{1,3}\b", re.IGNORECASE)
SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,.;:!?…])")
DOUBLE_PUNCT_RE = re.compile(r"([,;:])\s*([.!?…])")
REPEATED_COMMA_RE = re.compile(r",\s*,+")
LEADING_PUNCT_RE = re.compile(r"^[\s,;:.]+")
SENTENCE_END_RE = re.compile(r"(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Ý«\"0-9])")


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def title_key(title: str) -> str:
    """Minuscules, accents et ponctuation retirés, mots vides retirés."""
    words = re.findall(r"[a-z0-9]+", strip_accents(title.lower()))
    return " ".join(w for w in words if w not in STOPWORDS)


def title_words(title: str, limit: int = 8) -> list[str]:
    """Mots d'un titre pour l'apprentissage : 3 lettres ou plus, pas de nombre seul,
    `limit` premiers, sans doublon."""
    words: list[str] = []
    for word in title_key(title).split():
        if len(word) >= 3 and not word.isdigit() and word not in words:
            words.append(word)
        if len(words) == limit:
            break
    return words


def stems(title: str) -> set[str]:
    """Mots réduits à leurs 5 premières lettres (comparaison idée / fonctionnalité)."""
    return {w[:5] for w in title_key(title).split() if not w.isdigit()}


def overlap(title: str, other: str | set[str]) -> float:
    """Part des mots de `title` présents dans `other` (0 si `title` n'a aucun mot)."""
    mine = stems(title)
    theirs = other if isinstance(other, set) else stems(other)
    return len(mine & theirs) / len(mine) if mine else 0.0


def similar(a: str, b: str, threshold: float) -> bool:
    return difflib.SequenceMatcher(None, a, b).ratio() >= threshold


def clean_refs(text: str, known: Iterable[str] = ()) -> str:
    """Renvois aux candidats retirés (cf. docstring du module)."""
    known_refs = {k.lower() for k in known}
    text = REF_GROUP_RE.sub("", text or "")
    text = REF_RE.sub(
        lambda m: "" if m.group(0).lower() in known_refs else m.group(0), text
    )
    text = " ".join(text.split())
    text = SPACE_BEFORE_PUNCT_RE.sub(r"\1", text)
    text = REPEATED_COMMA_RE.sub(",", text)
    text = DOUBLE_PUNCT_RE.sub(r"\2", text)
    text = LEADING_PUNCT_RE.sub("", text)
    return text.strip()


def cut(text: str, limit: int) -> str:
    """Au plus `limit` caractères, coupure au dernier mot entier, « … » compris."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    head = text[: limit - 1]
    if " " in head:
        head = head[: head.rfind(" ")]
    return head.rstrip(" ,;:.") + "…"


def one_sentence(text: str, limit: int) -> str:
    """Première phrase seulement, terminée par un point, `limit` caractères au plus."""
    text = " ".join((text or "").split())
    if not text:
        return ""
    text = SENTENCE_END_RE.split(text, maxsplit=1)[0].strip()
    if text[-1] not in ".!?…":
        text += "."
    return cut(text, limit)


# Noms propres usuels en français sans équivalent littéral dans une source anglaise
GENERIC_NAMES = set(
    "ia ue europe europeenne europeen etats-unis etats unis americain americaine chine "
    "chinois chinoise france francais francaise japon inde royaume-uni allemagne".split()
)
NAME_RE = re.compile(
    r"\b[A-ZÀ-Ý][\w-]{2,}|\b\w*[A-Za-z]\w*\d[\w-]*|\b\d+\w*[A-Za-z][\w-]*"
)


def _normalized(text: str) -> str:
    return strip_accents(text.lower())


def unsupported_names(sentence: str, source: str) -> list[str]:
    """Noms propres et références (« OpenAI », « Qwen4 ») du résumé absents de la
    source (titre + extrait du flux) : signe d'un résumé inventé ou d'un autre article.
    Le premier mot de la phrase est ignoré (majuscule de début de phrase)."""
    body = sentence.split(" ", 1)[1] if " " in sentence else ""
    known = _normalized(source)
    missing: list[str] = []
    for match in NAME_RE.finditer(body):
        name = _normalized(match.group(0).strip("-"))
        if name in GENERIC_NAMES or name in known or name[:5] in known:
            continue
        if name not in missing:
            missing.append(match.group(0))
    return missing


def off_topic(sentence: str, source: str) -> str | None:
    """Raison d'écarter un résumé sans rapport avec son article, sinon None."""
    missing = unsupported_names(sentence, source)
    if missing:
        return f"noms absents de l'article : {', '.join(missing[:3])}"
    if not stems(sentence) & stems(source):
        return "aucun mot commun avec l'article"
    return None
