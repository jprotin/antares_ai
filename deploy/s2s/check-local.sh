#!/usr/bin/env bash
# Preuve que le moteur speech-to-speech est 100 % local :
#   1. aucune sortie Internet possible depuis le conteneur s2s ;
#   2. le seul service externe joignable est le LLM local (via llm-gw) ;
#   3. le service répond sur l'hôte (127.0.0.1 uniquement) ;
#   4. s'il tourne, le RAG intégré (antares-rag, antares-qdrant) n'a pas d'accès Internet.
set -euo pipefail

readonly CONTAINER=antares-s2s
failures=0

# probe <url> [conteneur] : conteneur par défaut, le moteur vocal
probe() {
  docker exec "${2:-${CONTAINER}}" python -c "
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
  if probe "$1" "${2:-}"; then
    echo "ÉCHEC  sortie réseau possible vers $1${2:+ depuis $2}"
    failures=$((failures + 1))
  else
    echo "OK     bloqué : $1${2:+ depuis $2}"
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

# RAG intégré (profil rag-integre) : réseau antares-local seul, comme le moteur vocal
if [[ "$(docker inspect -f '{{.State.Running}}' antares-rag 2>/dev/null)" == "true" ]]; then
  expect_blocked https://huggingface.co antares-rag
  for container in antares-rag antares-qdrant; do
    networks="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "${container}")"
    if [[ "${networks}" == "antares-local " ]]; then
      echo "OK     réseaux de ${container} : antares-local (internal) uniquement"
    else
      echo "ÉCHEC  réseaux inattendus pour ${container} : ${networks}"
      failures=$((failures + 1))
    fi
  done
fi

((failures == 0)) || {
  echo "${failures} vérification(s) en échec"
  exit 1
}
echo "Moteur vocal 100 % local : vérifié (seuls le routeur et SearXNG accèdent à Internet, pour la recherche web et Claude)"
