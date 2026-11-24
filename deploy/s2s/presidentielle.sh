#!/usr/bin/env bash
# Outil de saisie de la présidentielle : lance router/presidentielle_tool.py dans
# l'image du routeur, sur le dépôt de données réelles (PRESIDENTIELLE_DATA du .env)
# monté en écriture. Le jeu fictif d'antares_ai n'est jamais modifiable par ici.
#
#   ./presidentielle.sh etat
#   ./presidentielle.sh source ajouter <candidat|-> <fichier> --niveau candidat \
#       --titre "…" --url https://… [--publie-le AAAA-MM-JJ] [--id …] \
#       [--remplace <ancienne_source_id>]   # nouvelle version d'un programme
#       [--lecture brute]   # PDF aux colonnes mêlées : pdftotext -raw
#   ./presidentielle.sh source lecture <source_id> ordre|brute   # texte régénéré
#   ./presidentielle.sh textes reconstruire   # textes/ depuis documents/ (rattrapage)
#   ./presidentielle.sh extraire <candidat> <source_id>
#   ./presidentielle.sh verifier [brouillons/<candidat>.yaml]
#   ./presidentielle.sh publier <candidat> [--motif "…"] [--retrait-erreur <mesure>…]
#   ./presidentielle.sh restaurer <candidat> <revision>
#   ./presidentielle.sh rattacher <question> <candidat> <option> <mesure>
#   ./presidentielle.sh quiz-relire <question>
#   ./presidentielle.sh liste-officielle --source <id> --officiels <candidat>…
#   ./presidentielle.sh phase entre-tours <a> <b> --source <id>
#   ./presidentielle.sh surveillance ajouter|retirer <url> [--candidat <slug>]
#   ./presidentielle.sh surveillance geler
#   ./presidentielle.sh scrutins verifier|geler
#   ./presidentielle.sh votes importer <candidat> --acteur PA… --archive <Scrutins.json.zip>…
#   ./presidentielle.sh index
#
# Base archivée (après archive_apres de base.yaml) : les commandes qui écrivent sont
# refusées, sauf avec --correction "<motif>", inscrit au journal.
#
# L'outil n'enregistre rien dans git : il affiche la commande, vous la lancez.
# La restauration lit l'ancienne version dans git, ici sur l'hôte (l'image n'a pas git).
#
# PRESIDENTIELLE_DATA déjà présent dans l'environnement l'emporte sur le .env (essais).
# PRESIDENTIELLE_ISOLE=1 (essais, presidentielle-test-restaurer.sh) : conteneur jetable
# sans réseau, hors compose ; aucun service n'est touché, le routeur est injoignable.
set -euo pipefail

cd "$(dirname "$0")"
readonly ENV_FILE=.env
readonly IMAGE=antares/s2s:1.0.0
readonly CIBLE=/presidentielle-rw
readonly MAX_OCTETS=$((15 * 1024 * 1024))
REPO_ROOT="$(cd ../.. && pwd -P)"
readonly REPO_ROOT

die() {
  printf '\033[1;31mERREUR :\033[0m %s\n' "$*" >&2
  exit 1
}

data="${PRESIDENTIELLE_DATA:-}"
if [[ -z "${data}" ]]; then
  data="$(grep -E '^PRESIDENTIELLE_DATA=' "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  # Guillemets éventuels du .env (PRESIDENTIELLE_DATA="/chemin")
  data="${data%\"}"
  data="${data#\"}"
fi
[[ -n "${data}" ]] ||
  die "PRESIDENTIELLE_DATA vide dans deploy/s2s/${ENV_FILE} : chemin du dépôt de données réelles attendu"
[[ -d "${data}" ]] || die "dépôt de données introuvable : ${data}"
data="$(cd "${data}" && pwd -P)"
# « : » ou « , » couperaient l'option -v de docker (chemin:cible[:mode]), comme pour
# les archives des scrutins
[[ "${data}" != *[:,]* ]] ||
  die "PRESIDENTIELLE_DATA refusé (« : » ou « , ») : ${data}"
case "${data}/" in
  "${REPO_ROOT}/"*) die "PRESIDENTIELLE_DATA désigne antares_ai (${data}) : seul le dépôt de données réelles est modifiable" ;;
esac
[[ -f "${data}/base.yaml" ]] || die "base.yaml absent de ${data} : ce n'est pas un dépôt de données"

# Fichiers temporaires dans le dépôt (documents/ et brouillons/, hors git), retirés à la fin
temporaires=()
nettoyer() {
  local chemin
  for chemin in "${temporaires[@]}"; do
    rm -rf -- "${chemin}"
  done
}
trap nettoyer EXIT

# Montages supplémentaires en lecture seule (archive des scrutins, cf. votes_importer)
montages=()

outil() {
  if [[ "${PRESIDENTIELLE_ISOLE:-}" == 1 ]]; then
    docker run --rm --network none --user "$(id -u):$(id -g)" \
      -v "${PWD}/router:/app:ro" -v "${data}:${CIBLE}" -e PRESIDENTIELLE_DIR="${CIBLE}" \
      "${montages[@]}" --entrypoint python "${IMAGE}" /app/presidentielle_tool.py "$@"
    return
  fi
  # Cible distincte du montage en lecture seule du service (/presidentielle), qui
  # l'emporterait sur un second montage au même endroit ; --user : fichiers à vous.
  docker compose run --rm --no-deps --user "$(id -u):$(id -g)" \
    -v "${data}:${CIBLE}" -e PRESIDENTIELLE_DIR="${CIBLE}" "${montages[@]}" \
    --entrypoint python llm-router /app/presidentielle_tool.py "$@"
}

# source ajouter <candidat> <fichier> … : le fichier de l'hôte est d'abord copié dans
# documents/ du dépôt, seul dossier visible du conteneur
source_ajouter() {
  # Ordre imposé (argparse accepterait les options avant) : candidat puis fichier
  # « - » seul (aucun candidat) est admis, pas une option
  if (($# < 4)) || [[ "$3" == -?* || "$4" == -* ]]; then
    die "usage : $0 source ajouter <candidat|-> <fichier> --niveau … --titre … --url …"
  fi
  local fichier="$4" taille nom entrant
  [[ -f "${fichier}" ]] || die "fichier introuvable : ${fichier}"
  taille="$(stat -c %s -- "${fichier}")"
  ((taille <= MAX_OCTETS)) ||
    die "fichier trop volumineux : ${taille} octets (15 Mo au maximum)"
  mkdir -p "${data}/documents"
  entrant="$(mktemp -d "${data}/documents/.entrant.XXXXXX")"
  temporaires+=("${entrant}")
  nom="$(basename -- "${fichier}")"
  cp -- "${fichier}" "${entrant}/${nom}"
  local args=("$@")
  args[3]="${CIBLE}/documents/${entrant##*/}/${nom}"
  outil "${args[@]}"
}

# restaurer <candidat> <revision> : l'ancienne fiche est lue dans git sur l'hôte, puis
# contrôlée, publiée (version + 1) et journalisée par l'outil ; en cas d'échec, la
# fiche en place reste intacte
restaurer() {
  local correction=()
  if (($# == 5)) && [[ "$4" == --correction ]]; then
    correction=(--correction "$5")
  else
    (($# == 3)) || die "usage : $0 restaurer <candidat> <revision> [--correction \"<motif>\"]"
  fi
  local slug="$2" revision="$3" commit restauration
  [[ "${slug}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "identifiant de candidat invalide : ${slug}"
  [[ -n "${revision}" && "${revision}" != -* ]] || die "révision invalide : ${revision}"
  git -C "${data}" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
    die "${data} n'est pas un dépôt git"
  commit="$(git -C "${data}" rev-parse --verify --quiet --end-of-options "${revision}^{commit}")" ||
    die "révision inconnue : ${revision} (fiche inchangée)"
  mkdir -p "${data}/brouillons"
  restauration="$(mktemp "${data}/brouillons/.restaurer-${slug}.XXXXXX")"
  temporaires+=("${restauration}")
  git -C "${data}" show "${commit}:candidats/${slug}.yaml" >"${restauration}" 2>/dev/null ||
    die "candidats/${slug}.yaml absent de la révision ${revision} (fiche inchangée)"
  outil restaurer "${slug}" "${commit}" --depuis "${CIBLE}/brouillons/${restauration##*/}" \
    "${correction[@]}"
}

# votes importer <candidat> --acteur PA… --archive <fichier> : l'archive de l'hôte
# (plusieurs dizaines de Mo) est montée en lecture seule, jamais copiée dans le dépôt
# (une par législature, --archive répétable)
votes_importer() {
  local args=("$@") i archive n=0
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [[ "${args[i]}" == --archive ]] && ((i + 1 < ${#args[@]})); then
      archive="${args[i + 1]}"
      [[ -f "${archive}" ]] || die "archive introuvable : ${archive}"
      archive="$(cd "$(dirname -- "${archive}")" && pwd -P)/$(basename -- "${archive}")"
      [[ "${archive}" != *[:,]* ]] ||
        die "chemin d'archive refusé (« : » ou « , ») : ${archive}"
      n=$((n + 1))
      montages+=(-v "${archive}:/archive-an/${n}.zip:ro")
      args[i + 1]="/archive-an/${n}.zip"
    fi
  done
  ((n > 0)) ||
    die "usage : $0 votes importer <candidat> --acteur PA… --archive <Scrutins.json.zip>…"
  outil "${args[@]}"
}

case "${1:-}" in
  source)
    if [[ "${2:-}" == ajouter ]]; then
      source_ajouter "$@"
    else
      outil "$@"
    fi
    ;;
  restaurer) restaurer "$@" ;;
  votes)
    if [[ "${2:-}" == importer ]]; then
      votes_importer "$@"
    else
      outil "$@"
    fi
    ;;
  *) outil "$@" ;;
esac
