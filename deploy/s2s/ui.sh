#!/usr/bin/env bash
# Interface servie sur 127.0.0.1:8765 :
#   ./ui.sh legacy          ancienne interface (frontend/), retour arrière en une commande
#   ./ui.sh new [--build]   nouvelle interface (web/), image reconstruite si périmée
# Le choix persiste dans .env (COMPOSE_FILE) : un simple `docker compose up -d` le garde.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly ENV_FILE="${SCRIPT_DIR}/.env"
readonly LEGACY_FILES="compose.yaml:compose.legacy-ui.yaml"
readonly URL="http://127.0.0.1:8765"
readonly IMAGE="antares/web:latest"
readonly WAIT_S=30

cd "${SCRIPT_DIR}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mATTENTION :\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mERREUR :\033[0m %s\n' "$*" >&2
  exit 1
}

env_keys() { grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "${ENV_FILE}" 2>/dev/null | sort || true; }

# COMPOSE_FILE dans .env (vide : retiré) ; les autres clés sont conservées telles quelles
set_compose_file() {
  local value="$1" before after
  before="$(env_keys | grep -v '^COMPOSE_FILE=' || true)"
  (
    umask 077
    {
      grep -v '^COMPOSE_FILE=' "${ENV_FILE}" 2>/dev/null || true
      [[ -n "${value}" ]] && printf 'COMPOSE_FILE=%s\n' "${value}"
    } >"${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
  )
  after="$(env_keys | grep -v '^COMPOSE_FILE=' || true)"
  [[ "${before}" == "${after}" ]] || die ".env : clés modifiées par erreur, vérifier ${ENV_FILE}"
}

# Interface servie : legacy (app.js), new (theme-init.js) ou rien
served() {
  local page
  page="$(curl -fsS --max-time 3 "${URL}/" 2>/dev/null || true)"
  if grep -q 'src="app.js"' <<<"${page}"; then
    echo legacy
  elif grep -q 'theme-init.js' <<<"${page}"; then
    echo new
  else
    echo none
  fi
}

wait_served() {
  local expected="$1" elapsed=0
  while ((elapsed < WAIT_S)); do
    [[ "$(served)" == "${expected}" ]] && return 0
    sleep 1
    elapsed=$((elapsed + 1))
  done
  die "interface ${expected} non servie sur ${URL} après ${WAIT_S} s"
}

image_rev() {
  docker run --rm --entrypoint cat "${IMAGE}" /usr/share/nginx/html/version.json 2>/dev/null |
    grep -oE '"rev": *"[^"]*"' | cut -d'"' -f4 || true
}

legacy() {
  log "Ancienne interface (frontend/)"
  set_compose_file "${LEGACY_FILES}"
  docker compose up -d --no-deps web
  wait_served legacy
  log "Servie sur ${URL} : ancienne interface"
}

new() {
  local force="${1:-}" rev
  docker compose -f compose.yaml config web 2>/dev/null | grep -q "image: ${IMAGE}" ||
    die "compose.yaml ne construit pas encore la nouvelle interface (bascule non faite)"
  [[ -n "$(git status --porcelain -- ../../web 2>/dev/null)" ]] &&
    warn "web/ contient des modifications non commitées : l'empreinte ne couvre que le commité"
  rev="$(git rev-parse HEAD:web)"
  if [[ "${force}" == "--build" || "$(image_rev)" != "${rev}" ]]; then
    log "Construction de l'interface (npm, en ligne)"
    # Construite et vérifiée avant de toucher à .env : un échec laisse tout en place
    ANTARES_WEB_REV="${rev}" ANTARES_COMMIT="$(git rev-parse --short HEAD)" \
      docker compose -f compose.yaml build web ||
      die "construction impossible (registre npm injoignable ?) : interface et .env inchangés"
    [[ "$(image_rev)" == "${rev}" ]] || die "image construite sans la bonne empreinte"
  fi
  log "Nouvelle interface (web/)"
  set_compose_file ""
  docker compose up -d --no-deps web
  wait_served new
  [[ "$(curl -fsS "${URL}/version.json" | grep -oE '"rev": *"[^"]*"' | cut -d'"' -f4)" == "${rev}" ]] ||
    die "version servie différente de ${rev}"
  log "Servie sur ${URL} : nouvelle interface (${rev:0:12})"
}

case "${1:-}" in
  legacy) legacy ;;
  new) new "${2:-}" ;;
  *)
    echo "usage : $0 legacy | new [--build]" >&2
    exit 2
    ;;
esac
