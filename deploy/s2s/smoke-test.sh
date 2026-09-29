#!/usr/bin/env bash
# Appel de bout en bout sans micro (voir smoke_test.py). Réponse audio : ./out/reponse.wav
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

mkdir -p "${SCRIPT_DIR}/out"
docker run --rm \
  --network antares-local \
  -e HF_HUB_OFFLINE=1 \
  -v antares-s2s-cache:/root/.cache:ro \
  -v "${SCRIPT_DIR}/smoke_test.py:/smoke_test.py:ro" \
  -v "${SCRIPT_DIR}/out:/out" \
  -e S2S_URL="${S2S_URL:-ws://s2s:8765/v1/realtime}" \
  -e QUESTION -e S2S_VOICE -e S2S_INSTRUCTIONS \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  --entrypoint python \
  antares/s2s:1.0.0 /smoke_test.py
