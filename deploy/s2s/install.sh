#!/usr/bin/env bash
# Installation one-shot du moteur speech-to-speech local d'antares_ai.
#
#   ./install.sh            (seule étape nécessitant Internet : image + modèles)
#
# Étapes : prérequis (stack ai-to-boost, modèle LLM) -> build -> préchargement des modèles
# -> démarrage hors ligne -> vérification de l'isolation réseau.
# Idempotent : relançable sans effet de bord.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly LLM_MODEL=gemma4:e4b
readonly AI_TO_BOOST_ENV="${AI_TO_BOOST_ENV:-/datadisk/ai-projects/ai-to-boost/.env}"
readonly ENV_FILE="${SCRIPT_DIR}/.env"
readonly READY_TIMEOUT_S=1800

cd "${SCRIPT_DIR}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31mERREUR :\033[0m %s\n' "$*" >&2
  exit 1
}

check_prerequisites() {
  log "Vérification des prérequis"
  command -v docker >/dev/null || die "docker introuvable"
  docker compose version >/dev/null 2>&1 || die "plugin docker compose introuvable"
  command -v curl >/dev/null || die "curl introuvable"
  docker info 2>/dev/null | grep -q nvidia || die "runtime NVIDIA absent de Docker (nvidia-container-toolkit)"
  docker network inspect ai-assistant-net >/dev/null 2>&1 ||
    die "réseau ai-assistant-net absent : démarrer la stack ai-to-boost d'abord"
  [[ "$(docker inspect -f '{{.State.Running}}' ollama 2>/dev/null)" == "true" ]] ||
    die "conteneur ollama arrêté : démarrer la stack ai-to-boost d'abord"
  docker exec ollama ollama show "${LLM_MODEL}" >/dev/null 2>&1 ||
    die "modèle ${LLM_MODEL} absent d'Ollama : docker exec ollama ollama pull ${LLM_MODEL}"
}

# Jetons recopiés depuis ai-to-boost, tous optionnels :
#   BRIDGE_TOKEN    -> CLAUDE_BRIDGE_TOKEN : modèles Claude dans l'interface
#   RAG_WRITE_TOKEN -> RAG_WRITE_TOKEN     : indexation des fiches de connaissance
ensure_tokens() {
  local source target token lines=""
  for pair in BRIDGE_TOKEN:CLAUDE_BRIDGE_TOKEN RAG_WRITE_TOKEN:RAG_WRITE_TOKEN; do
    source="${pair%%:*}"
    target="${pair##*:}"
    token="$(grep -E "^${source}=" "${AI_TO_BOOST_ENV}" 2>/dev/null | cut -d= -f2- || true)"
    if [[ -z "${token}" ]]; then
      log "${source} absent d'ai-to-boost : fonction correspondante désactivée"
      continue
    fi
    lines+="${target}=${token}"$'\n'
    log "${source} recopié dans .env"
  done
  (
    umask 077
    printf '%s' "${lines}" >"${ENV_FILE}"
  )
}

wait_healthy() {
  local container="$1" elapsed=0 state
  while ((elapsed < READY_TIMEOUT_S)); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "${container}" 2>/dev/null || echo absent)"
    case "${state}" in
      healthy) return 0 ;;
      unhealthy)
        docker logs --tail 50 "${container}" >&2
        die "${container} en échec"
        ;;
    esac
    sleep 10
    elapsed=$((elapsed + 10))
  done
  docker logs --tail 50 "${container}" >&2
  die "${container} pas prêt après ${READY_TIMEOUT_S} s"
}

warmup_models() {
  log "Préchargement des modèles (premier lancement : plusieurs minutes)"
  # Libère la VRAM : le moteur en place et le préchargement ne tiennent pas ensemble
  docker compose stop s2s >/dev/null 2>&1 || true
  docker compose --profile warmup rm -sf warmup >/dev/null
  docker compose --profile warmup up -d warmup
  local container
  container="$(docker compose --profile warmup ps -q warmup)"
  wait_healthy "${container}"
  docker compose --profile warmup rm -sf warmup >/dev/null
}

main() {
  check_prerequisites
  ensure_tokens
  log "Construction de l'image"
  docker compose build
  warmup_models
  log "Démarrage hors ligne"
  docker compose up -d --remove-orphans
  wait_healthy antares-s2s
  "${SCRIPT_DIR}/check-local.sh"
  log "Prêt : ouvrir http://127.0.0.1:8765"
}

main "$@"
