# Moteur temps réel antares_ai : huggingface/speech-to-speech, version figée.
# Les modèles ne sont PAS dans l'image : ils sont préchargés par install.sh dans le
# volume de cache, puis le service tourne hors ligne (HF_HUB_OFFLINE=1).
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ARG S2S_VERSION=1.0.0

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:${PATH} \
    NLTK_DATA=/opt/nltk_data

# espeak-ng : phonémiseur requis par Kokoro pour le français.
# Versions apt non figées : on suit les correctifs de sécurité de l'image de base Ubuntu 24.04.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        espeak-ng \
        libportaudio2 \
        libsndfile1 \
        python3 \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir uv==0.12.20 \
    && uv pip install --no-cache --prerelease=allow \
        "speech-to-speech[pocket,kokoro,supertonic]==${S2S_VERSION}"

# Ressources NLTK embarquées dans l'image : aucun nltk.download() au démarrage.
# Le lien compense un bug amont (s2s_pipeline.py cherche le tagger sous tokenizers/).
RUN python -c "import nltk; [nltk.download(r, download_dir='${NLTK_DATA}') for r in ('punkt_tab', 'averaged_perceptron_tagger_eng')]" \
    && ln -s ../taggers/averaged_perceptron_tagger_eng "${NLTK_DATA}/tokenizers/averaged_perceptron_tagger_eng"

# Réglage du tirage de Qwen3-TTS (température, top_k), absent des options du moteur.
# Chargé par un .pth : Ubuntu fournit déjà un sitecustomize.py prioritaire.
COPY qwen3_sampling.py /opt/venv/lib/python3.12/site-packages/
RUN echo "import qwen3_sampling" > /opt/venv/lib/python3.12/site-packages/qwen3_sampling.pth

EXPOSE 8765

HEALTHCHECK --interval=15s --timeout=5s --start-period=600s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/v1/pool', timeout=4)"

ENTRYPOINT ["speech-to-speech"]
