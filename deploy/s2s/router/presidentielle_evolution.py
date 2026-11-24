"""Vue « Évolution » d'une fiche de la présidentielle (lecture seule, aucun modèle).

Deux lectures du dépôt de données, faites à la demande :

- historique/<slug>/v<N>.yaml : copie figée de chaque version publiée d'une fiche,
  écrite par l'outil de saisie (publier, restaurer, liste-officielle). La frise compare
  chaque version conservée à la précédente conservée : mesures ajoutées, retirées ou
  reformulées (même identifiant, citation ou source changée), nouvelles sources,
  changement de statut ; le motif vient du journal. Une mesure retirée parce qu'erronée
  (`retraits_erreur` de l'entrée du journal, publier --retrait-erreur) n'est plus
  montrée que par la date du retrait, dans toutes les versions qui la contenaient : ni
  citation, ni thème, ni source ; les copies figées restent intactes (git). Une version
  inscrite au journal sans copie (publiée avant l'historique) est listée « non
  conservée ». La fiche publiée sert de copie de sa propre version si celle-ci manque.
- textes/<sha256>.txt : texte extrait de chaque document (pages séparées par un saut
  de page), versionné dans le dépôt de données. Pour un programme en plusieurs versions
  (lignée `remplace` de sources.yaml), comparaison mot pour mot de deux versions,
  paragraphe par paragraphe, et version où chaque citation de la fiche apparaît puis,
  le cas échéant, disparaît (recherche après presidentielle_common.normaliser, comme
  le contrôle des citations de l'outil).

Le calcul se fait ici (difflib, bibliothèque standard) plutôt que dans le navigateur :
un programme pèse plusieurs centaines de milliers de caractères, que le navigateur d'un
invité devrait télécharger en double par le tunnel ; aucune dépendance de comparaison
n'entre dans web/ ; le résultat se garde en cache (textes repérés par leur empreinte).
Tailles bornées : TEXTE_MAX caractères par texte, PARAGRAPHES_MAX paragraphes, BLOCS_MAX
blocs et REPONSE_MAX caractères renvoyés (au-delà : `tronque`), paragraphes de plus de
MOTS_MAX mots jamais appariés ; une comparaison calculée à la fois, attente bornée
(503), aucune comparaison hors cache pendant un appel vocal (409) ; un calcul s'arrête
si un appel commence (409) ou au-delà de DUREE_CALCUL_MAX secondes (422, mémorisé).
Caches bornés en nombre et à CACHE_CARACTERES_MAX caractères en tout.

Une citation dont une version antérieure du document n'a pas de texte est marquée
`premiere_incertaine` : la page ne date jamais une apparition qu'elle ne peut prouver.

Aucun résumé, aucun qualificatif : seulement le texte des fiches et des documents.
"""

import difflib
import os
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path

import presidentielle
import presidentielle_common as common
import presidentielle_schema as schema

HISTORIQUE = "historique"
TEXTES = "textes"
SAUT_DE_PAGE = "\f"
# Versions lues au plus par fiche (les plus récentes)
VERSIONS_MAX = 200
VERSION_FICHIER = re.compile(r"^v([1-9][0-9]{0,5})\.yaml$")
# Texte d'un document : 1 million de caractères (environ 300 pages) au plus
TEXTE_MAX = 1_000_000
PARAGRAPHES_MAX = 10_000
BLOCS_MAX = 1_500
# Mots comparés au plus dans un paragraphe modifié (au-delà : avant et après en entier)
MOTS_MAX = 2_000
# Fin de paragraphe dans un texte extrait d'un PDF (lignes sans ligne vide) : ligne
# terminée par une ponctuation de fin de phrase
FIN_DE_PHRASE = re.compile(r"[.!?:…»\"]\s*$")
# Caches séparés : textes (lourds, brut et normalisé) et résultats (comparaisons,
# copies figées), bornés en nombre et ensemble en taille : CACHE_CARACTERES_MAX
# caractères au plus (une valeur plus lourde n'est pas gardée), les plus anciennes
# lectures sortent d'abord
CACHE_TEXTES_MAX = 48
CACHE_MAX = 256
CACHE_CARACTERES_MAX = 50_000_000
# Réponse de comparaison : 2 millions de caractères de texte au plus (sinon `tronque`)
REPONSE_MAX = 2_000_000
# Attente du calcul en cours au plus (sinon 503, à réessayer)
ATTENTE_CALCUL = 2.0
# Durée d'un calcul au plus : au-delà, arrêté et mémorisé « trop long » (422) pendant
# TROP_LONG_DUREE secondes. Non interruptibles : l'alignement des paragraphes
# (SequenceMatcher sur PARAGRAPHES_MAX clés au plus) et la comparaison mot pour mot d'un
# paragraphe (MOTS_MAX mots au plus) ; bornés par ces deux limites.
DUREE_CALCUL_MAX = 20.0
TROP_LONG_DUREE = 3600.0
VERIFICATION_APPEL = 0.25

_verrou_calcul = threading.Lock()
_verrou_cache = threading.Lock()
_cache: OrderedDict[tuple, object] = OrderedDict()
_cache_textes: OrderedDict[tuple, object] = OrderedDict()
_poids_cache: dict[tuple, int] = {}
_total_cache = 0
# Valeur gardée pour une comparaison arrêtée au-delà de DUREE_CALCUL_MAX
TROP_LONG = "trop long"


def _trop_long_expire(valeur: object) -> bool:
    """Marque « trop long » gardée en cache et périmée."""
    return (
        isinstance(valeur, tuple)
        and len(valeur) == 2
        and valeur[0] == TROP_LONG
        and time.monotonic() > valeur[1]
    )


class CalculInterrompu(Exception):
    """Comparaison arrêtée en cours de calcul : appel vocal commencé, ou durée dépassée
    (`duree` vrai)."""

    def __init__(self, duree: bool = False):
        super().__init__("durée dépassée" if duree else "appel vocal")
        self.duree = duree


def _poids(valeur: object) -> int:
    """Taille approchée d'une valeur gardée en cache, en caractères (une fiche figée ou
    un autre objet compte pour 10 000)."""
    if isinstance(valeur, str):
        return len(valeur)
    if isinstance(valeur, dict):
        return len(valeur) + sum(_poids(v) for v in valeur.values())
    if isinstance(valeur, (list, tuple, set)):
        return len(valeur) + sum(_poids(v) for v in valeur)
    if valeur is None or isinstance(valeur, (bool, int, float)):
        return 1
    return 10_000


def vider_cache() -> None:
    """Vide les deux caches (tests, essais)."""
    global _total_cache
    with _verrou_cache:
        _cache.clear()
        _cache_textes.clear()
        _poids_cache.clear()
        _total_cache = 0


def _lire_cache(cle: tuple) -> tuple[bool, object]:
    with _verrou_cache:
        for cache in (_cache, _cache_textes):
            if cle in cache:
                cache.move_to_end(cle)
                return True, cache[cle]
    return False, None


def _sortir(cache: OrderedDict[tuple, object]) -> None:
    """Retire l'entrée la plus ancienne (sous _verrou_cache)."""
    global _total_cache
    cle, _ = cache.popitem(last=False)
    _total_cache -= _poids_cache.pop(cle, 0)


def _ranger_cache(cle: tuple, valeur: object) -> None:
    global _total_cache
    poids = _poids(valeur)
    if poids > CACHE_CARACTERES_MAX:
        return
    lourd = cle[0] in ("texte", "normalise")
    cache, borne = (_cache_textes, CACHE_TEXTES_MAX) if lourd else (_cache, CACHE_MAX)
    with _verrou_cache:
        if cle in cache:
            _total_cache -= _poids_cache.pop(cle, 0)
        cache[cle] = valeur
        cache.move_to_end(cle)
        _poids_cache[cle] = poids
        _total_cache += poids
        while len(cache) > borne:
            _sortir(cache)
        # Taille totale : les textes d'abord (relus vite), puis les résultats ; jamais
        # la valeur qui vient d'entrer
        for autre in (_cache_textes, _cache):
            while (
                _total_cache > CACHE_CARACTERES_MAX
                and autre
                and (next(iter(autre)) != cle)
            ):
                _sortir(autre)


def _en_cache(cle: tuple, calcul):
    trouve, valeur = _lire_cache(cle)
    if trouve:
        return valeur
    valeur = calcul()
    _ranger_cache(cle, valeur)
    return valeur


def _fichier_sur(racine: Path, chemin: Path) -> os.stat_result | None:
    """Fichier ordinaire dans la base (ni lien symbolique, ni chemin hors base)."""
    try:
        if chemin.is_symlink() or not chemin.is_file():
            return None
        if not chemin.resolve().is_relative_to(racine.resolve()):
            return None
        return chemin.stat()
    except OSError:
        return None


# --- Copies figées des fiches ----------------------------------------------------------


def chemin_version(slug: str, version: int) -> str:
    return f"{HISTORIQUE}/{slug}/v{version}.yaml"


def versions_figees(
    racine: Path, slug: str
) -> tuple[dict[int, schema.Fiche], list[str]]:
    """Copies lisibles de historique/<slug>/ ({version: fiche}) et erreurs (fichier en
    défaut, identifiant ou version différents du chemin)."""
    fiches, erreurs, _ = lire_copies(racine, slug)
    return fiches, erreurs


def lire_copies(
    racine: Path, slug: str
) -> tuple[dict[int, schema.Fiche], list[str], set[int]]:
    """Copies lisibles, erreurs, et numéros des copies présentes mais en défaut."""
    dossier = racine / HISTORIQUE / slug
    if dossier.is_symlink() or not dossier.is_dir():
        return {}, [], set()
    numeros: list[tuple[int, str]] = []
    for entry in os.scandir(dossier):
        found = VERSION_FICHIER.match(entry.name)
        if found:
            numeros.append((int(found.group(1)), entry.name))
    numeros = sorted(numeros)[-VERSIONS_MAX:]
    signature = []
    for numero, nom in numeros:
        stat = _fichier_sur(racine, dossier / nom)
        if stat is not None:
            signature.append((numero, nom, stat.st_mtime_ns, stat.st_size))
    return _en_cache(
        ("versions", str(racine), slug, tuple(signature)),
        lambda: _lire_versions(dossier, slug, signature),
    )


def _lire_versions(
    dossier: Path, slug: str, signature: list[tuple]
) -> tuple[dict[int, schema.Fiche], list[str], set[int]]:
    fiches: dict[int, schema.Fiche] = {}
    erreurs: list[str] = []
    en_defaut: set[int] = set()
    for numero, nom, _, _ in signature:
        rel = chemin_version(slug, numero)
        try:
            fiche = schema.charger(schema.Fiche, dossier / nom, rel)
        except schema.ErreurFichier as exc:
            erreurs.append(str(exc))
            en_defaut.add(numero)
            continue
        if fiche.id != slug or fiche.version != numero:
            erreurs.append(
                f"{rel} : fiche {fiche.id} en version {fiche.version}, différente du"
                " chemin"
            )
            en_defaut.add(numero)
            continue
        fiches[numero] = fiche
    return fiches, erreurs, en_defaut


_source = presidentielle.source_publiee
_mesure = presidentielle.mesure_publiee


def sources_citees(
    fiche: schema.Fiche, exclues: frozenset[str] = frozenset()
) -> list[str]:
    """Sources citées par une fiche, dans l'ordre de la fiche, sans doublon ; les
    mesures `exclues` (retirées pour erreur) ne comptent pas."""
    ids = [fiche.statut_source, fiche.declaration.source_id]
    ids += [ligne.source_id for ligne in fiche.lignes_phares]
    ids += [m.source_id for m in fiche.mesures if m.id not in exclues]
    ids += [vote.source_id for vote in fiche.votes]
    return list(dict.fromkeys(ids))


# Retraits pour erreur d'une fiche : {identifiant de mesure: [(version, date)]}, version
# de la publication qui l'a retirée (journal, publier --retrait-erreur)
RetraitsErreur = dict[str, list[tuple[int, str]]]


def retraits_erreur(etat: presidentielle.Etat, slug: str) -> RetraitsErreur:
    """Mesures de la fiche retirées parce qu'erronées, d'après le journal."""
    retraits: RetraitsErreur = {}
    for ligne in etat.journal:
        if ligne.objet != "fiche" or ligne.cible != slug or not ligne.version:
            continue
        for mesure_id in ligne.retraits_erreur or []:
            retraits.setdefault(mesure_id, []).append(
                (ligne.version, ligne.date.isoformat())
            )
    for liste in retraits.values():
        liste.sort()
    return retraits


def _forme(
    etat: presidentielle.Etat,
    mesure: schema.Mesure,
    version: int,
    retraits: RetraitsErreur,
) -> dict:
    """Forme publiée d'une mesure lue dans la version `version` d'une fiche ; si une
    publication postérieure l'a retirée pour erreur, seulement son identifiant et la
    date du retrait : ni citation, ni thème, ni source (copies figées inchangées)."""
    retrait = next((d for n, d in retraits.get(mesure.id, []) if n > version), None)
    if retrait is not None:
        return {"id": mesure.id, "retrait_erreur": retrait}
    return _mesure(etat, mesure)


def comparer_fiches(
    etat: presidentielle.Etat,
    avant: schema.Fiche,
    apres: schema.Fiche,
    retraits: RetraitsErreur | None = None,
) -> dict:
    """Changements de `avant` à `apres` : mesures (par identifiant), sources, statut.
    Mesure retirée pour erreur (`retraits`) : texte masqué dans les deux versions."""
    retraits = retraits or {}

    def avant_(mesure: schema.Mesure) -> dict:
        return _forme(etat, mesure, avant.version, retraits)

    def apres_(mesure: schema.Mesure) -> dict:
        return _forme(etat, mesure, apres.version, retraits)

    def masquees(fiche: schema.Fiche) -> frozenset[str]:
        return frozenset(
            m.id
            for m in fiche.mesures
            if "retrait_erreur" in _forme(etat, m, fiche.version, retraits)
        )

    anciennes = {m.id: m for m in avant.mesures}
    nouvelles = {m.id: m for m in apres.mesures}
    reformulees = []
    for mesure in apres.mesures:
        ancienne = anciennes.get(mesure.id)
        if ancienne is None:
            continue
        citation = common.normaliser(ancienne.citation) != common.normaliser(
            mesure.citation
        )
        source_changee = (ancienne.source_id, ancienne.page) != (
            mesure.source_id,
            mesure.page,
        )
        if citation or source_changee:
            reformulees.append(
                {
                    "id": mesure.id,
                    "citation_modifiee": citation,
                    "avant": avant_(ancienne),
                    "apres": apres_(mesure),
                }
            )
    # Source citée seulement par une mesure retirée pour erreur : jamais montrée
    deja = set(sources_citees(avant, masquees(avant)))
    statut = None
    if (avant.statut, avant.statut_source) != (apres.statut, apres.statut_source):
        statut = {
            "avant": avant.statut,
            "apres": apres.statut,
            "source": _source(etat, apres.statut_source),
        }
    return {
        "mesures_ajoutees": [apres_(m) for m in apres.mesures if m.id not in anciennes],
        "mesures_retirees": [avant_(m) for m in avant.mesures if m.id not in nouvelles],
        "mesures_reformulees": reformulees,
        "nouvelles_sources": [
            source
            for source_id in sources_citees(apres, masquees(apres))
            if source_id not in deja and (source := _source(etat, source_id))
        ],
        "statut": statut,
    }


def frise(etat: presidentielle.Etat, fiche: schema.Fiche) -> list[dict]:
    """Versions de la fiche, de la plus récente à la plus ancienne."""
    figees, _, en_defaut = lire_copies(etat.dossier, fiche.id)
    figees = {n: f for n, f in figees.items() if n <= fiche.version}
    # La fiche publiée fait foi pour sa propre version
    figees[fiche.version] = fiche
    journal: dict[int, schema.EntreeJournal] = {}
    for ligne in etat.journal:
        if ligne.objet == "fiche" and ligne.cible == fiche.id and ligne.version:
            journal[ligne.version] = ligne
    numeros = sorted(
        {n for n in set(figees) | set(journal) | en_defaut if n <= fiche.version},
        reverse=True,
    )[:VERSIONS_MAX]
    conservees = sorted(figees)
    retraits = retraits_erreur(etat, fiche.id)
    versions = []
    for numero in numeros:
        entree = journal.get(numero)
        copie = figees.get(numero)
        version: dict = {
            "version": numero,
            "date": (
                copie.mise_a_jour.isoformat()
                if copie
                else entree.date.isoformat()
                if entree
                else None
            ),
            "motif": entree.motif if entree else None,
            "conservee": copie is not None,
            # Copie présente mais illisible ou incohérente (signalée par verifier)
            "copie_en_defaut": copie is None and numero in en_defaut,
            "comparee_a": None,
            "changements": None,
        }
        if copie is not None:
            version["statut"] = copie.statut
            version["mesures"] = len(copie.mesures)
            precedentes = [n for n in conservees if n < numero]
            if precedentes:
                version["comparee_a"] = precedentes[-1]
                version["changements"] = comparer_fiches(
                    etat, figees[precedentes[-1]], copie, retraits
                )
        versions.append(version)
    return versions


# --- Textes des documents ---------------------------------------------------------------


def chemin_texte(sha256: str) -> str:
    return f"{TEXTES}/{sha256}.txt"


class TexteTropLong(Exception):
    pass


def _texte(racine: Path, source: schema.Source) -> tuple[list[str], tuple] | None:
    """(pages, clé de cache) du texte versionné d'une source (textes/<sha256>.txt),
    None s'il manque ou s'il est illisible ; TexteTropLong au-delà de TEXTE_MAX."""
    if not source.sha256:
        return None
    chemin = racine / chemin_texte(source.sha256)
    stat = _fichier_sur(racine, chemin)
    if stat is None:
        return None
    # 4 octets au plus par caractère en UTF-8 : refus sans lecture au-delà
    if stat.st_size > TEXTE_MAX * 4:
        raise TexteTropLong(source.id)
    cle = (str(chemin), stat.st_mtime_ns, stat.st_size)

    def lire() -> list[str] | str | None:
        try:
            texte = chemin.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None
        if len(texte) > TEXTE_MAX:
            return "trop long"
        return texte.split(SAUT_DE_PAGE)

    pages = _en_cache(("texte", *cle), lire)
    if pages == "trop long":
        raise TexteTropLong(source.id)
    if pages is None:
        return None
    return pages, cle  # type: ignore[return-value]


def lire_texte(racine: Path, source: schema.Source) -> list[str] | None:
    """Pages du texte versionné d'une source, None s'il manque."""
    found = _texte(racine, source)
    return found[0] if found else None


def _texte_de_controle(
    racine: Path, source: schema.Source
) -> common.TexteControle | None:
    """Texte de recherche des citations (common.texte_de_controle), en cache."""
    try:
        found = _texte(racine, source)
    except TexteTropLong:
        return None
    if found is None:
        return None
    pages, cle = found
    return _en_cache(("normalise", *cle), lambda: common.texte_de_controle(pages))  # type: ignore[return-value]


def presence(controle: common.TexteControle | None, citation: str) -> dict:
    """La citation figure-t-elle dans le texte, et à quelle page commence-t-elle ? Même
    règle que le contrôle des citations de l'outil (y compris à cheval sur des sauts de
    page, cf. common.texte_de_controle)."""
    if controle is None:
        return {"presente": None, "page": None}
    trouvees = common.pages_de_citation(controle, citation)
    if trouvees:
        return {"presente": True, "page": trouvees[0]}
    return {"presente": False, "page": None}


def parcours_citation(ids: list[str], presences: dict[str, dict]) -> dict:
    """Première version qui contient la citation, première qui ne la contient plus et
    retour éventuel. `premiere_incertaine` : une version antérieure n'a pas de texte, la
    citation y figurait peut-être déjà (rien n'est affirmé)."""
    etats = [presences[i]["presente"] for i in ids]
    premiere = next((k for k, e in enumerate(etats) if e is True), None)
    resultat: dict = {
        "premiere": None,
        "page_premiere": None,
        "premiere_incertaine": False,
        "disparue": None,
        "reapparue": None,
    }
    if premiere is None:
        return resultat
    resultat["premiere"] = ids[premiere]
    resultat["page_premiere"] = presences[ids[premiere]]["page"]
    resultat["premiere_incertaine"] = any(e is None for e in etats[:premiere])
    disparue = next(
        (k for k in range(premiere + 1, len(ids)) if etats[k] is False), None
    )
    if disparue is not None:
        resultat["disparue"] = ids[disparue]
        retour = next(
            (k for k in range(disparue + 1, len(ids)) if etats[k] is True), None
        )
        if retour is not None:
            resultat["reapparue"] = ids[retour]
    return resultat


def programmes(etat: presidentielle.Etat, fiche: schema.Fiche) -> list[dict]:
    """Documents du candidat en plusieurs versions, et parcours de chaque citation de la
    fiche qui cite l'une de ces versions."""
    resultat = []
    for chaine in schema.lignees(etat.sources.values(), fiche.id):
        textes = {s.id: _texte_de_controle(etat.dossier, s) for s in chaine}
        ids = [s.id for s in chaine]
        parcours = []
        for mesure in fiche.mesures:
            if mesure.source_id not in ids:
                continue
            presences = {s.id: presence(textes[s.id], mesure.citation) for s in chaine}
            parcours.append(
                {
                    "mesure": _mesure(etat, mesure),
                    **parcours_citation(ids, presences),
                    "presences": presences,
                }
            )
        resultat.append(
            {
                "titre": chaine[-1].titre,
                "versions": [
                    {
                        **(_source(etat, s.id) or {}),
                        "remplace": s.remplace,
                        "texte": textes[s.id] is not None,
                    }
                    for s in chaine
                ],
                "mesures": parcours,
            }
        )
    return resultat


def evolution(etat: presidentielle.Etat, fiche: schema.Fiche) -> dict:
    return {
        "candidat": fiche.id,
        "nom_affiche": fiche.nom_affiche,
        "version": fiche.version,
        "versions": frise(etat, fiche),
        "programmes": programmes(etat, fiche),
    }


# --- Comparaison de deux versions d'un document -----------------------------------------


def paragraphes(pages: list[str]) -> list[tuple[int, str]]:
    """(page, paragraphe) : séparés par une ligne vide, ou par une fin de ligne après
    une ponctuation de fin de phrase (texte de PDF sans ligne vide) ; espaces réunies."""
    resultat: list[tuple[int, str]] = []
    for rang, page in enumerate(pages, start=1):
        courant: list[str] = []
        for ligne in page.split("\n"):
            ligne = ligne.strip()
            if ligne:
                courant.append(ligne)
            if courant and (not ligne or FIN_DE_PHRASE.search(ligne)):
                resultat.append((rang, _joindre(courant)))
                courant = []
        if courant:
            resultat.append((rang, _joindre(courant)))
    return resultat


def _joindre(lignes: list[str]) -> str:
    """Lignes d'un paragraphe réunies ; césure recollée comme dans normaliser
    (« écono-\\nmie » -> « économie »)."""
    texte = "\n".join(lignes)
    texte = re.sub(r"(\w)-\n(?=[a-z\u00e0-\u00ff\u0153\u00e6])", r"\1", texte)
    return texte.replace("\n", " ")


def mots(avant: str, apres: str) -> list[dict] | None:
    """Différences mot pour mot d'un paragraphe modifié (segments égal, retiré,
    ajouté) ; None au-delà de MOTS_MAX mots."""
    a, b = avant.split(), apres.split()
    if len(a) > MOTS_MAX or len(b) > MOTS_MAX:
        return None
    cles_a = [common.normaliser(m) for m in a]
    cles_b = [common.normaliser(m) for m in b]
    segments: list[dict] = []
    matcher = difflib.SequenceMatcher(None, cles_a, cles_b, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            segments.append({"type": "egal", "texte": " ".join(b[j1:j2])})
            continue
        if i2 > i1:
            segments.append({"type": "retire", "texte": " ".join(a[i1:i2])})
        if j2 > j1:
            segments.append({"type": "ajoute", "texte": " ".join(b[j1:j2])})
    return segments


# Paragraphes appariés comme « modifiés » : assez de mots en commun
SIMILARITE_MIN = 0.5
# Au-delà (paragraphes retirés × ajoutés d'une même zone), pas d'appariement : blocs
# retirés puis ajoutés
APPARIEMENT_MAX = 2_500


def _rien() -> None:
    return None


def apparier(
    avant: list[str], apres: list[str], verifier: Callable[[], None] = _rien
) -> list[tuple[int, int]]:
    """Paires (i, j), dans l'ordre du texte, de paragraphes assez semblables pour être
    montrés comme un paragraphe modifié (somme des ressemblances la plus forte) ; les
    autres sont retirés ou ajoutés. `verifier` est appelé avant chaque comparaison de
    deux paragraphes (CalculInterrompu pour arrêter)."""
    n, m = len(avant), len(apres)
    if not n or not m or n * m > APPARIEMENT_MAX:
        return []
    mots_avant = [p.split() for p in avant]
    mots_apres = [p.split() for p in apres]
    # Paragraphe trop long (PDF sans ponctuation en fin de ligne) : jamais apparié, le
    # calcul de ressemblance serait quadratique
    longs_avant = {i for i, m in enumerate(mots_avant) if len(m) > MOTS_MAX}
    longs_apres = {j for j, m in enumerate(mots_apres) if len(m) > MOTS_MAX}
    ressemblance = [[0.0] * m for _ in range(n)]
    for i in range(n):
        if i in longs_avant:
            continue
        matcher = difflib.SequenceMatcher(None, autojunk=False)
        matcher.set_seq2(mots_avant[i])
        for j in range(m):
            if j in longs_apres:
                continue
            verifier()
            matcher.set_seq1(mots_apres[j])
            if matcher.real_quick_ratio() < SIMILARITE_MIN:
                continue
            if matcher.quick_ratio() < SIMILARITE_MIN:
                continue
            ratio = matcher.ratio()
            if ratio >= SIMILARITE_MIN:
                ressemblance[i][j] = ratio
    # Plus longue sous-suite commune pondérée
    total = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            meilleur = max(total[i - 1][j], total[i][j - 1])
            if ressemblance[i - 1][j - 1]:
                meilleur = max(
                    meilleur, total[i - 1][j - 1] + ressemblance[i - 1][j - 1]
                )
            total[i][j] = meilleur
    paires: list[tuple[int, int]] = []
    i, j = n, m
    while i and j:
        if total[i][j] == total[i - 1][j]:
            i -= 1
        elif total[i][j] == total[i][j - 1]:
            j -= 1
        else:
            paires.append((i - 1, j - 1))
            i, j = i - 1, j - 1
    return paires[::-1]


def _bloc(
    type_: str,
    page_avant: int | None,
    page_apres: int | None,
    avant: str | None,
    apres: str | None,
) -> dict:
    return {
        "type": type_,
        "page_avant": page_avant,
        "page_apres": page_apres,
        "avant": avant,
        "apres": apres,
        "mots": None,
    }


def comparer_textes(
    avant: list[str], apres: list[str], verifier: Callable[[], None] = _rien
) -> dict:
    """Blocs ajoutés, retirés, modifiés (avec la page de chaque côté), nombre de
    paragraphes inchangés ; `tronque` au-delà de BLOCS_MAX blocs. `verifier` est appelé
    tout au long du calcul : il lève CalculInterrompu pour l'arrêter."""
    pa, pb = paragraphes(avant), paragraphes(apres)
    if len(pa) > PARAGRAPHES_MAX or len(pb) > PARAGRAPHES_MAX:
        raise TexteTropLong("paragraphes")
    cles_a = [common.normaliser(t) for _, t in pa]
    cles_b = [common.normaliser(t) for _, t in pb]
    blocs: list[dict] = []
    inchanges = 0
    tronque = False

    taille = 0

    def ajouter(bloc: dict) -> None:
        nonlocal tronque, taille
        poids = len(bloc["avant"] or "") + len(bloc["apres"] or "")
        if tronque or len(blocs) >= BLOCS_MAX or taille + poids > REPONSE_MAX:
            tronque = True
            return
        taille += poids
        blocs.append(bloc)

    matcher = difflib.SequenceMatcher(None, cles_a, cles_b, autojunk=False)
    verifier()
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        verifier()
        if op == "equal":
            inchanges += i2 - i1
            continue
        retires, ajoutes = pa[i1:i2], pb[j1:j2]
        paires = apparier(
            [cles_a[i] for i in range(i1, i2)],
            [cles_b[j] for j in range(j1, j2)],
            verifier,
        )
        i = j = 0
        for pi, pj in [*paires, (len(retires), len(ajoutes))]:
            for page, texte in retires[i:pi]:
                ajouter(_bloc("retire", page, None, texte, None))
            for page, texte in ajoutes[j:pj]:
                ajouter(_bloc("ajoute", None, page, None, texte))
            if pi < len(retires) and pj < len(ajoutes):
                verifier()
                (page_a, texte_a), (page_b, texte_b) = retires[pi], ajoutes[pj]
                bloc = _bloc("modifie", page_a, page_b, texte_a, texte_b)
                bloc["mots"] = mots(texte_a, texte_b)
                ajouter(bloc)
            i, j = pi + 1, pj + 1
    return {"blocs": blocs, "inchanges": inchanges, "tronque": tronque}


class ComparaisonImpossible(Exception):
    """Message clair pour l'utilisateur (404 ou 422 côté route)."""

    def __init__(self, message: str, statut: int = 422):
        super().__init__(message)
        self.statut = statut


def comparaison(
    etat: presidentielle.Etat,
    fiche: schema.Fiche,
    de: str,
    a: str,
    appel_en_cours: Callable[[], bool] = lambda: False,
) -> dict:
    """Comparaison de deux versions d'une même lignée de documents du candidat. Hors
    cache : refusée pendant un appel vocal (409, la voix passe d'abord) ou si une autre
    comparaison se calcule depuis plus de ATTENTE_CALCUL secondes (503).

    Le calcul tourne dans le fil de la requête (route `def`, pool de fils du routeur,
    jamais la boucle d'événements) et s'interroge sans cesse : un appel vocal qui
    commence l'arrête (409, rien n'est gardé), et au-delà de DUREE_CALCUL_MAX secondes
    il s'arrête aussi ; le résultat « trop long » est alors gardé une heure pour ces
    deux textes (422 ensuite, sans nouveau calcul). Choix plus simple et plus sûr qu'un processus à
    part : rien à tuer, aucune donnée à faire passer, le verrou garantit un seul calcul
    à la fois."""
    if de == a:
        raise ComparaisonImpossible("deux versions différentes attendues")
    chaine = next(
        (
            c
            for c in schema.lignees(etat.sources.values(), fiche.id)
            if de in {s.id for s in c}
        ),
        None,
    )
    if chaine is None or a not in {s.id for s in chaine}:
        raise ComparaisonImpossible(
            "versions inconnues ou hors d'une même lignée de documents", 404
        )
    sources = {s.id: s for s in chaine}
    try:
        textes = {i: _texte(etat.dossier, sources[i]) for i in (de, a)}
    except TexteTropLong:
        raise ComparaisonImpossible(
            f"texte trop long pour la comparaison ({TEXTE_MAX} caractères au plus)"
        ) from None
    manquants = [i for i, t in textes.items() if t is None]
    if manquants:
        raise ComparaisonImpossible(
            f"texte non disponible : {', '.join(manquants)} (textes/ du dépôt de données)"
        )
    (pages_de, cle_de), (pages_a, cle_a) = textes[de], textes[a]  # type: ignore[misc]
    cle = ("comparaison", *cle_de, *cle_a)

    trouve, resultat = _lire_cache(cle)
    if trouve and _trop_long_expire(resultat):
        trouve = False
    if not trouve:
        if appel_en_cours():
            raise ComparaisonImpossible(
                "Appel en cours : comparaison après l'appel", 409
            )
        # Un calcul à la fois, attente bornée : les invités d'un partage n'occupent ni
        # le processeur ni les fils du routeur
        if not _verrou_calcul.acquire(timeout=ATTENTE_CALCUL):
            raise ComparaisonImpossible(
                "Comparaison en cours : réessayez dans un instant", 503
            )
        limite = time.monotonic() + DUREE_CALCUL_MAX
        prochain = [0.0]

        def verifier() -> None:
            maintenant = time.monotonic()
            if maintenant > limite:
                raise CalculInterrompu(duree=True)
            # Appel vocal relu toutes les VERIFICATION_APPEL secondes (lecture de
            # tasks.yaml) : coût négligeable, arrêt en moins d'une seconde
            if maintenant >= prochain[0]:
                prochain[0] = maintenant + VERIFICATION_APPEL
                if appel_en_cours():
                    raise CalculInterrompu()

        try:
            # Calculée pendant l'attente par une demande identique ?
            trouve, resultat = _lire_cache(cle)
            if not trouve or _trop_long_expire(resultat):
                resultat = comparer_textes(pages_de, pages_a, verifier)
                _ranger_cache(cle, resultat)
        except TexteTropLong:
            raise ComparaisonImpossible(
                f"texte trop long pour la comparaison ({PARAGRAPHES_MAX} paragraphes"
                " au plus)"
            ) from None
        except CalculInterrompu as exc:
            if not exc.duree:
                raise ComparaisonImpossible(
                    "Appel en cours : comparaison après l'appel", 409
                ) from None
            # Mémorisé une heure (TROP_LONG_DUREE) : une lenteur passagère ne bloque
            # pas la comparaison pour de bon
            _ranger_cache(cle, (TROP_LONG, time.monotonic() + TROP_LONG_DUREE))
            resultat = (TROP_LONG, 0.0)
        finally:
            _verrou_calcul.release()
    if isinstance(resultat, tuple) and resultat[:1] == (TROP_LONG,):
        raise ComparaisonImpossible(
            f"comparaison trop longue à calculer ({DUREE_CALCUL_MAX:.0f} s au plus) :"
            " comparez les documents eux-mêmes"
        )
    return {
        "candidat": fiche.id,
        "de": _source(etat, de),
        "a": _source(etat, a),
        **resultat,  # type: ignore[dict-item]
    }
