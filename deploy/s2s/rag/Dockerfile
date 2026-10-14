# RAG intégré d'antares (profil compose rag-integre) : FastEmbed nomic sur le processeur
# + Qdrant. Le modèle d'embeddings est préchargé par install.sh dans /cache (volume) ;
# le service tourne ensuite hors ligne (réseau antares-local, sans Internet).
FROM python:3.12-slim@sha256:d764629ce0ddd8c71fd371e9901efb324a95789d2315a47db7e4d27e78f1b0e9

WORKDIR /app

# Mêmes versions que le service rag d'ai-to-boost (embeddings identiques)
RUN pip install --no-cache-dir qdrant-client==1.18.0 fastembed==0.8.0 onnxruntime==1.27.0

COPY server.py /app/server.py

ENV FASTEMBED_CACHE_PATH=/cache \
    RAG_PORT=8100

EXPOSE 8100

CMD ["python", "/app/server.py"]
