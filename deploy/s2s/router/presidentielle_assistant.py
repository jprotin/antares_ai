"""Assistant de la page « Présidentielle 2027 » (lot 2) : réponses faites uniquement de
passages relus, cités en entier avec leur source, sous une introduction fixe.

Chemins, dans l'ordre :
1. pré-filtre (vote, classement, pronostic, sondage) : refus fixe, sans modèle ;
2. un candidat et un thème : les mesures de sa fiche sur ce thème, sans modèle, ou « Pas
   de position connue à ce jour » ;
3. un thème sans candidat (ou plusieurs candidats nommés) : tous les candidats concernés
   côte à côte, sans modèle ;
4. autre question : recherche (presidentielle_index), puis choix des passages par le
   modèle, qui ne renvoie que des identifiants ; le code ne garde que ceux qui figurent
   parmi les passages retrouvés et relit texte et candidat dans la base publiée. Aucun mot
   du modèle n'est affiché. Sans passage retenu : « Je ne peux pas le confirmer depuis la
   base. »

Neutralité : jamais de recommandation de vote ; même traitement pour chaque candidat ;
candidats présentés dans l'ordre reçu du navigateur (tiré au sort pour la visite) s'il
contient tous les participants et aucun inconnu, sinon dans un ordre tiré ici.

Ce module ne journalise rien et ne garde rien : la question ne vit que le temps de la
requête (presidentielle_api.py).
"""

import json
import random
import re
from collections.abc import Iterable
from dataclasses import dataclass

import presidentielle
import presidentielle_index as index
import presidentielle_schema as schema

REFUS = (
    "Je ne donne pas de recommandation de vote. Je peux vous montrer ce que chaque "
    "candidat propose sur un thème."
)
INTRODUCTION = "Voici les passages relus qui portent sur votre question."
INTRODUCTION_THEME = "Voici les passages relus qui portent sur le thème {theme}."
AUCUN_PASSAGE = "Je ne peux pas le confirmer depuis la base."
PAS_DE_POSITION = "Pas de position connue à ce jour"
QUESTION_MAX = 500
MAX_TOKENS = 200
TEMPERATURE = 0
DELAI_MODELE = 150

# Pré-filtre, sur la question sans accents, en minuscules, ponctuation réduite à des
# espaces (« dois-je » devient « dois je », « l'emporter » reste « l'emporter »).
# Ne refuse pas les questions sur le droit de vote, le vote obligatoire, « meilleur
# accès aux soins »... (jeu de contrôle dans les tests).
# Sujet d'un jugement porté sur un candidat ou un programme
_SUJET = (
    r"(?:qui|lequel|laquelle|lesquels|lesquelles|quel candidat|quelle candidate|"
    r"quels candidats|quel programme|quel projet)"
)
_CIBLE = r"(?:candidat|candidate|programme|projet|president|presidente)s?"
_VOTE = [
    # « pour qui voter », « pour qui dois je voter », « pour qui faut il voter »
    r"\bpour qui (?:\w+ ){0,3}vot(?:er|e|es|ez|erais|erai|eriez)\b",
    # « dois je voter Dupont », « faut il voter pour X » ; pas « voter à 16 ans »,
    # « voter par correspondance », « voter des lois »
    r"\b(?:dois|devrais|doit|devrait|devrions|faut il|faudrait il|vais|va) "
    r"(?:je |j' |on |nous )?(?:\w+ )?voter\b"
    r"(?! (?:a|au|aux|par|des|du|les|la|le|une|un|electronique|en ligne)\b)",
    r"\bvot(?:er|e|ez) pour (?:qui|lequel|laquelle|quel|quelle)\b",
    r"\b(?:quel|quelle|qui|lequel|laquelle) (?:candidat |candidate )?"
    r"(?:choisir|elire|soutenir|preferer)\b",
    r"\b(?:qui|lequel|laquelle|quel candidat|quelle candidate) (?:dois|devrais|faut il|"
    r"faudrait il) (?:je |j' )?(?:choisir|elire|soutenir|preferer)\b",
    r"\b(?:conseil|conseils|consigne|consignes|recommandation|recommandations) de vote\b",
    r"\b(?:conseille|conseillez|recommande|recommandez|suggere|suggerez) (?:moi|nous) "
    r"(?:\w+ ){0,3}(?:candidat|candidate|vote|voter)\b",
    r"\b(?:donner|accorder|apporter) ma voix\b",
    r"\b(?:vote|voter) utile\b",
    r"\bmerite(?:nt)? (?:d'etre elue?s?|mon vote|ma voix|de gagner)\b",
]
_CLASSEMENT = [
    # « qui est le meilleur », « quel candidat est le meilleur », « lequel est le pire »
    rf"\b{_SUJET} (?:est |serait |sera |sont |seraient |parait |semble )?"
    r"(?:le |la |les )?(?:meilleure?s?|pires?)\b",
    # « qui est le plus crédible », « lequel est le plus convaincant »
    rf"\b{_SUJET} (?:est |serait |sera |sont |seraient |parait |semble )"
    r"(?:le |la |les )?(?:plus|moins) \w+",
    # « le programme le plus réaliste », « le candidat le moins sérieux »
    rf"\b{_CIBLE} (?:est |serait )?(?:le |la |les )(?:plus|moins) \w+",
    rf"\bmeilleure?s? {_CIBLE}\b",
    rf"\bpires? {_CIBLE}\b",
    rf"\bclass(?:ement|er|ez|e) (?:des |les |ces |tous les )?{_CIBLE}\b",
    r"\bdu meilleur au pire\b",
    r"\bqui a (?:le plus )?raison\b",
    r"\b(?:qui|quel candidat|quelle candidate) (?:me |m')?(?:correspond|convient)\b",
    rf"\b(?:{_SUJET}) (?:est|sont|sera|serait|arrive|arrivera) "
    r"(?:en tete|mieux place|mieux placee|devant)\b",
]
_PRONOSTIC = [
    r"\b(?:disent|donnent|montrent|indiquent|predisent|placent) (?:les |le )?sondages?\b",
    r"\bsondages? (?:donne|donnent|place|placent|montre|montrent|disent|dit|sur|pour|"
    r"de la presidentielle|du premier tour|du second tour)\b",
    r"\bselon les sondages\b",
    r"\bintentions? de vote\b",
    r"\ben tete (?:des|du) (?:sondages?|intentions|premier tour|scrutin|election)\b",
    r"\bpronostics?\b",
    r"\bprevisions? (?:electorales?|de vote|du scrutin|pour (?:l'election|le premier tour|"
    r"le second tour|la presidentielle))\b",
    r"\bqui (?:va|vont|devrait|devraient|pourrait|pourraient|risque de) "
    r"(?:gagner|l'emporter|emporter|remporter|etre elue?|perdre|passer|se qualifier|"
    r"etre presidente?)\b",
    r"\bqui (?:gagnera|l'emportera|remportera|perdra|sera elue?|sera presidente?|"
    r"seront elus|sera qualifiee?|seront qualifies|passera)\b",
    r"\b(?:va|vont) t (?:il|elle|ils|elles) (?:gagner|remporter|l'emporter|perdre|"
    r"etre elue?)\b",
    r"\bqui (?:sera|seront|ira|iront|passera|passeront) au (?:second|deuxieme) tour\b",
    r"\b(?:chances?|probabilite|probabilites) (?:de |d')(?:gagner|l'emporter|etre elue?|"
    r"passer|se qualifier)\b",
    r"\bfavori(?:te|s|tes)? (?:de|du|des|pour)\b",
    r"\b(?:est|sont) (?:le|la|les) favori(?:te|s|tes)?\b",
    r"\b(?:gagnant|gagnante|vainqueur)s? (?:de|du) (?:l'election|scrutin|premier tour|"
    r"second tour|la presidentielle)\b",
]
PREFILTRE = [re.compile(motif) for motif in _VOTE + _CLASSEMENT + _PRONOSTIC]

CONSIGNE = """Tu choisis des passages. On te donne une question et des passages, \
chacun précédé de son identifiant entre crochets.
Réponds uniquement par un objet JSON de la forme {"passages": ["<identifiant>", ...]}, \
avec les identifiants des passages qui répondent directement à la question, sans en \
inventer.
Si aucun passage ne répond à la question, réponds {"passages": []}.
N'écris aucune phrase, aucun avis, aucun classement."""


def simplifiee(texte: str) -> str:
    """Sans accents ni casse (schema.sans_accents), apostrophes unifiées, ponctuation
    réduite à des espaces."""
    sans = schema.sans_accents(texte)
    sans = sans.replace("’", "'").replace("‘", "'").replace("`", "'")
    return re.sub(r"[^\w']+", " ", sans).strip()


def refuse(question: str) -> bool:
    """Vrai pour une question de vote, de classement ou de pronostic."""
    texte = simplifiee(question)
    return any(motif.search(texte) for motif in PREFILTRE)


# --- Repérage du candidat et du thème -----------------------------------------------


def _motif(nom: str, pluriel: bool = False) -> re.Pattern | None:
    mots = re.findall(r"[\w']+", simplifiee(nom))
    if not mots:
        return None
    fin = r"(?:s|x|e|es)?" if pluriel else ""
    return re.compile(
        r"(?<![\w])" + r"\W+".join(re.escape(m) for m in mots) + fin + r"(?![\w])"
    )


def _noms(fiche: schema.Fiche) -> list[str]:
    """Nom affiché, alias et nom de famille (dernier mot, hors particule)."""
    noms = [fiche.nom_affiche, *fiche.alias]
    mots = re.findall(r"\w+", fiche.nom_affiche)
    if mots and len(mots[-1]) > 2 and mots[-1].casefold() not in schema.PARTICULES:
        noms.append(mots[-1])
    return [n for n in noms if n.strip()]


def candidats_cites(etat: presidentielle.Etat, question: str) -> list[str]:
    """Candidats nommés dans la question (nom, nom de famille, alias, sans accents ni
    casse ; initiales en majuscules, mot entier). Deux candidats du même nom : tous deux."""
    texte = simplifiee(question)
    mots_bruts = set(re.findall(r"\w+", question))
    found = []
    for slug in sorted(etat.fiches):
        fiche = etat.fiches[slug]
        motifs = [_motif(n) for n in _noms(fiche)]
        if any(m and m.search(texte) for m in motifs) or fiche.initiales in mots_bruts:
            found.append(slug)
    return found


def themes_cites(etat: presidentielle.Etat, question: str) -> list[str]:
    """Thèmes servis nommés dans la question (identifiant, libellé, mots-clés) : ceux de
    la grille, ou, sans grille, ceux des mesures publiées (presidentielle.themes_servis)."""
    texte = simplifiee(question)
    found = []
    for theme in presidentielle.themes_servis(etat):
        termes = [theme.id.replace("-", " "), theme.libelle, *theme.mots_cles]
        motifs = [_motif(t, pluriel=True) for t in termes]
        if any(m and m.search(texte) for m in motifs):
            found.append(theme.id)
    return found


# --- Ordre des candidats --------------------------------------------------------------


def ordre_valide(etat: presidentielle.Etat, ordre: object) -> bool:
    """Ordre du navigateur : tous les participants, aucun inconnu, aucun doublon (les
    candidats retirés, connus de la base, peuvent y figurer)."""
    if not isinstance(ordre, list) or not all(isinstance(s, str) for s in ordre):
        return False
    if len(set(ordre)) != len(ordre) or not set(ordre) <= set(etat.fiches):
        return False
    return set(presidentielle.participants(etat)) <= set(ordre)


def ordre_retenu(
    etat: presidentielle.Etat, ordre: object, tirage: random.Random | None = None
) -> list[str]:
    """L'ordre reçu s'il est valide, sinon un ordre tiré ici (toutes les fiches)."""
    if isinstance(ordre, list) and ordre_valide(etat, ordre):
        return [str(slug) for slug in ordre]
    tire = sorted(etat.fiches)
    (tirage or random.SystemRandom()).shuffle(tire)
    return tire


def ranger(slugs: Iterable[str], ordre: list[str]) -> list[str]:
    rang = {slug: i for i, slug in enumerate(ordre)}
    return sorted(set(slugs), key=lambda s: (rang.get(s, len(ordre)), s))


# --- Réponse ------------------------------------------------------------------------


def citation(etat: presidentielle.Etat, slug: str, mesure: schema.Mesure) -> dict:
    """Une mesure de la base, citée en entier avec sa source (forme publiée commune,
    presidentielle.mesure_publiee), repérée par l'identifiant de passage."""
    return {
        **presidentielle.mesure_publiee(etat, mesure),
        "id": index.doc_id(slug, mesure.id),
        "mesure": mesure.id,
        "candidat": slug,
        "nom": etat.fiches[slug].nom_affiche,
    }


@dataclass
class Reponse:
    kind: str
    introduction: str
    ordre: list[str]
    passages: list[dict]
    sans_position: list[dict]
    theme: dict | None = None
    model: str | None = None
    moteur: str | None = None

    def json(self, etat: presidentielle.Etat) -> dict:
        affiches = [p["candidat"] for p in self.passages] + [
            s["candidat"] for s in self.sans_position
        ]
        ordre = self.ordre + [c for c in dict.fromkeys(affiches) if c not in self.ordre]
        return {
            "kind": self.kind,
            "introduction": self.introduction,
            "theme": self.theme,
            "ordre": ordre,
            "passages": self.passages,
            "sans_position": self.sans_position,
            "model": self.model,
            "moteur": self.moteur,
            "base_version": etat.version,
        }


def refus(ordre: list[str]) -> Reponse:
    return Reponse("refus", REFUS, ordre, [], [])


def par_theme(
    etat: presidentielle.Etat,
    theme_id: str,
    qui: list[str],
    ordre: list[str],
    kind: str,
) -> Reponse:
    """Mesures de chaque candidat sur un thème, dans l'ordre ; sans mesure : « Pas de
    position connue à ce jour »."""
    libelle = presidentielle.libelle_theme(etat, theme_id)
    passages: list[dict] = []
    sans_position: list[dict] = []
    for slug in ranger(qui, ordre):
        fiche = etat.fiches[slug]
        mesures = [m for m in fiche.mesures if m.theme == theme_id]
        if mesures:
            passages += [citation(etat, slug, m) for m in mesures]
        else:
            sans_position.append(
                {"candidat": slug, "nom": fiche.nom_affiche, "texte": PAS_DE_POSITION}
            )
    return Reponse(
        kind,
        INTRODUCTION_THEME.format(theme=libelle),
        ordre,
        passages,
        sans_position,
        theme={"id": theme_id, "libelle": libelle},
    )


@dataclass
class Plan:
    """Ce que la question demande : réponse immédiate (`reponse`), ou recherche sur
    `candidats` suivie du choix des passages par le modèle."""

    ordre: list[str]
    reponse: Reponse | None = None
    candidats: list[str] | None = None


def planifier(etat: presidentielle.Etat, question: str, ordre: object) -> Plan:
    retenu = ordre_retenu(etat, ordre)
    if refuse(question):
        return Plan(retenu, reponse=refus(retenu))
    nommes = candidats_cites(etat, question)
    themes = themes_cites(etat, question)
    if len(themes) == 1:
        if len(nommes) == 1:
            return Plan(
                retenu, reponse=par_theme(etat, themes[0], nommes, retenu, "fiche")
            )
        qui = nommes or presidentielle.participants(etat)
        return Plan(retenu, reponse=par_theme(etat, themes[0], qui, retenu, "theme"))
    return Plan(retenu, candidats=nommes or presidentielle.participants(etat))


def messages(question: str, trouves: list[index.Passage]) -> list[dict]:
    lignes = "\n\n".join(f"[{p.id}]\n{p.texte}" for p in trouves)
    return [
        {"role": "system", "content": CONSIGNE},
        {"role": "user", "content": f"Question : {question}\n\nPassages :\n\n{lignes}"},
    ]


def identifiants_choisis(brut: str, trouves: list[index.Passage]) -> list[str]:
    """Identifiants renvoyés par le modèle qui figurent parmi les passages retrouvés ;
    tout le reste (texte autour du JSON, champ inconnu, identifiant inventé, malformé
    ou non retrouvé) est ignoré."""
    if not isinstance(brut, str):
        return []
    data = None
    for essai in (brut, brut[brut.find("{") : brut.rfind("}") + 1]):
        try:
            data = json.loads(essai)
            break
        except (TypeError, ValueError):
            continue
    liste = data.get("passages") if isinstance(data, dict) else None
    if not isinstance(liste, list):
        return []
    connus = {p.id for p in trouves}
    gardes: list[str] = []
    for value in liste:
        if isinstance(value, str) and value in connus and value not in gardes:
            gardes.append(value)
    return gardes


def recherche(
    etat: presidentielle.Etat,
    choisis: list[str],
    ordre: list[str],
    model: str | None,
    moteur: str | None,
) -> Reponse:
    """Passages choisis, relus dans la base, groupés par candidat dans l'ordre."""
    relus = [p for p in (index.retrouver(etat, i) for i in choisis) if p is not None]
    relus = index.borner(relus)
    passages = []
    for slug in ranger({p.candidat for p in relus}, ordre):
        mesures = {m.id: m for m in etat.fiches[slug].mesures}
        passages += [
            citation(etat, slug, mesures[p.mesure]) for p in relus if p.candidat == slug
        ]
    introduction = INTRODUCTION if passages else AUCUN_PASSAGE
    return Reponse(
        "recherche", introduction, ordre, passages, [], model=model, moteur=moteur
    )
