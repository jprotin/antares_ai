#!/usr/bin/env bash
# Preuve que le moteur speech-to-speech est 100 % local :
#   1. aucune sortie Internet possible depuis le conteneur s2s ;
#   2. le seul service externe joignable est le LLM local (via llm-gw) ;
#   3. le service répond sur l'hôte (127.0.0.1 uniquement).
set -euo pipefail

readonly CONTAINER=antares-s2s
failures=0

probe() {
  docker exec "${CONTAINER}" python -c "
import sys, urllib.request
try:
    urllib.request.urlopen('$1', timeout=5)
except urllib.error.HTTPError:
    pass
except Exception:
    sys.exit(1)
"
}

expect_blocked() {
  if probe "$1"; then
    echo "ÉCHEC  sortie réseau possible vers $1"
    failures=$((failures + 1))
  else
    echo "OK     bloqué : $1"
  fi
}

expect_reachable() {
  if probe "$1"; then
    echo "OK     joignable : $1"
  else
    echo "ÉCHEC  injoignable : $1"
    failures=$((failures + 1))
  fi
}

expect_blocked https://huggingface.co
expect_blocked https://api.openai.com/v1
expect_blocked http://1.1.1.1
expect_reachable http://llm-router:11434/healthz

if curl -fsS --max-time 5 http://127.0.0.1:8765/v1/pool >/dev/null; then
  echo "OK     service local : http://127.0.0.1:8765"
else
  echo "ÉCHEC  service injoignable sur 127.0.0.1:8765"
  failures=$((failures + 1))
fi

networks="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "${CONTAINER}")"
if [[ "${networks}" == "antares-local " ]] &&
  [[ "$(docker network inspect -f '{{.Internal}}' antares-local)" == "true" ]]; then
  echo "OK     réseaux de ${CONTAINER} : antares-local (internal) uniquement"
else
  echo "ÉCHEC  réseaux inattendus : ${networks}"
  failures=$((failures + 1))
fi

((failures == 0)) || {
  echo "${failures} vérification(s) en échec"
  exit 1
}
echo "100 % local : vérifié"
