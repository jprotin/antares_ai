#!/usr/bin/env bash
# Partage temporaire d'antares avec des invités, via un tunnel ngrok (HTTPS).
#
#   ./share.sh collegue@gmail.com [autre@gmail.com ...]
#
# - Accès protégé par une connexion Google : seules les adresses données passent.
# - Pendant le partage, Claude (ton abonnement) et l'écriture dans le RAG sont
#   désactivés pour tout le monde (drapeau lu par le routeur).
# - Le partage s'arrête avec Ctrl+C : tunnel fermé, drapeau retiré.
#
# Prérequis : NGROK_AUTHTOKEN dans .env (https://dashboard.ngrok.com/get-started/your-authtoken).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly ENV_FILE="${SCRIPT_DIR}/.env"
readonly NGROK_IMAGE="ngrok/ngrok:3@sha256:14d80d083e5b53145f416bbbd36238336c9de4016c43fd950eb2eb845670583b"
readonly CONTAINER=antares-ngrok
readonly ROUTER=antares-llm-router
readonly LOCAL_URL=http://127.0.0.1:8765
readonly EMAIL_RE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31mERREUR :\033[0m %s\n' "$*" >&2
  exit 1
}

(($# > 0)) || die "usage : $0 adresse@gmail.com [autre@gmail.com ...]"
for email in "$@"; do
  [[ "${email}" =~ ${EMAIL_RE} ]] || die "adresse invalide : ${email}"
done

token="$(grep -E '^NGROK_AUTHTOKEN=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- || true)"
[[ -n "${token}" ]] || die "NGROK_AUTHTOKEN absent de ${ENV_FILE} (cf. README, « Partager avec un collègue »)"
curl -fsS -o /dev/null "${LOCAL_URL}" || die "antares ne répond pas sur ${LOCAL_URL} : docker compose up -d"
[[ "$(docker inspect -f '{{.State.Running}}' "${ROUTER}" 2>/dev/null)" == "true" ]] ||
  die "${ROUTER} arrêté : docker compose up -d"

policy="$(mktemp)"
cleaned=0
cleanup() {
  ((cleaned)) && return
  cleaned=1
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  docker exec "${ROUTER}" rm -f /data/sharing >/dev/null 2>&1 || true
  rm -f "${policy}"
  log "Partage fermé"
}
# Ctrl+C / arrêt : fermeture puis sortie (sans reprendre le suivi des journaux)
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM HUP

# Connexion Google, puis refus de toute adresse non autorisée (exemple de la doc ngrok,
# action oauth : https://ngrok.com/docs/traffic-policy/actions/oauth/). Adresses en
# minuscules, comme celles renvoyées par Google.
allowed="$(printf "'%s', " "$@" | tr '[:upper:]' '[:lower:]')"
cat >"${policy}" <<EOF
on_http_request:
  - actions:
      - type: oauth
        config:
          provider: google
  - expressions:
      - "!(actions.ngrok.oauth.identity.email in [${allowed%, }])"
    actions:
      - type: deny
        config:
          status_code: 403
EOF
chmod 644 "${policy}"

log "Partage : Claude et écriture dans le RAG désactivés"
docker exec "${ROUTER}" touch /data/sharing

log "Ouverture du tunnel ngrok (invités : $*)"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
# Jeton transmis par l'environnement, pas en argument (invisible dans la liste des processus)
NGROK_AUTHTOKEN="${token}" docker run -d --name "${CONTAINER}" --network host \
  -e NGROK_AUTHTOKEN \
  -v "${policy}:/etc/antares-policy.yml:ro" \
  "${NGROK_IMAGE}" \
  http "${LOCAL_URL}" --traffic-policy-file /etc/antares-policy.yml --log stdout >/dev/null

url=""
for _ in $(seq 1 30); do
  url="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null |
    python3 -c 'import json, sys; t = json.load(sys.stdin)["tunnels"]; print(t[0]["public_url"] if t else "")' 2>/dev/null || true)"
  [[ -n "${url}" ]] && break
  sleep 1
done
if [[ -z "${url}" ]]; then
  docker logs --tail 20 "${CONTAINER}" >&2
  die "tunnel non ouvert (jeton invalide ?)"
fi

printf '\n  URL à envoyer : \033[1m%s\033[0m\n' "${url}"
printf '  Connexion Google avec : %s\n' "$*"
printf '  Navigateur conseillé : Firefox. Un seul appel vocal à la fois ; réglages communs.\n\n'
log "Ctrl+C pour arrêter le partage"
# Suivi en arrière-plan : bash traite le signal dès qu'il arrive (wait est interruptible)
docker logs -f "${CONTAINER}" 2>&1 | grep --line-buffered -E 'lvl=(warn|eror|crit)' &
wait $!
