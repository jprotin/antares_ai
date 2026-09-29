#!/usr/bin/env bash
# Génère le banc d'écoute des voix : ./out/voix/index.html
# Accès Internet (réseau antares-download) le temps de télécharger les modèles TTS
# non encore en cache ; ils y restent ensuite pour l'usage hors ligne.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

mkdir -p "${SCRIPT_DIR}/out"
docker run --rm \
  --gpus all \
  --network antares-download \
  -e HF_HUB_DISABLE_TELEMETRY=1 \
  -e ENGINES -e QWEN3_BACKEND -e QWEN3_QUANT \
  -v antares-s2s-cache:/root/.cache \
  -v "${SCRIPT_DIR}/voice_samples.py:/voice_samples.py:ro" \
  -v "${SCRIPT_DIR}/out:/out" \
  --entrypoint python \
  antares/s2s:1.0.0 /voice_samples.py
docker run --rm -v "${SCRIPT_DIR}/out:/out" --entrypoint chown antares/s2s:1.0.0 -R "$(id -u):$(id -g)" /out
