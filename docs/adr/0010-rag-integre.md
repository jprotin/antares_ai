# 0010 — RAG intégré à antares, à la même API que celui d'ai-to-boost

- **Status** : proposed
- **Date** : 2026-10-07
- **Auteur(s)** : jprotin
- **Tags** : portabilité, RAG, hors ligne

## Contexte

La documentation des projets vient du RAG d'ai-to-boost (service `rag`, Qdrant,
embeddings nomic ; ADR 0002, 0006). Sur une machine sans ai-to-boost (lot 5 : autre PC,
lot 6 : cloud), antares n'a plus de RAG. Le plan portabilité prévoit de proposer
l'installation d'un RAG quand il n'en existe pas, et de pouvoir comparer les deux.
Contraintes : 100 % local et hors ligne après l'installation, et pas de VRAM en plus
(12 Go déjà occupés par la voix et le LLM : saturation constatée le 2026-10-01).

## Options envisagées

### Option 1 : copie du service rag d'ai-to-boost + Qdrant, sous un profil compose

- **Pour** : même API (`/query`, `/documents`) et mêmes embeddings : le routeur ne
  change pas, on passe d'un RAG à l'autre par un réglage ; embeddings sur le
  processeur (FastEmbed), sans VRAM.
- **Contre** : code dupliqué entre les deux dépôts ; ~2 Go de RAM quand il tourne.

### Option 2 : embeddings par Ollama (nomic-embed-text) et Qdrant appelé par le routeur

- **Pour** : un service de moins.
- **Contre** : vecteurs différents de ceux d'ai-to-boost (pas comparables) ; les
  embeddings prennent de la VRAM et déchargent le modèle de conversation.

### Option 3 : base vectorielle embarquée dans le routeur (SQLite, Chroma…)

- **Pour** : aucun conteneur supplémentaire.
- **Contre** : deux familles de RAG à maintenir ; image du routeur alourdie (modèle
  d'embeddings) ; s'écarte de l'existant.

## Décision

Nous retenons l'**option 1**.

- `deploy/s2s/rag/` : `server.py` copié d'ai-to-boost (develop a4de23b), mêmes
  versions de `qdrant-client`, `fastembed` et `onnxruntime` ; Qdrant 1.18.2 figé.
- Profil compose `rag-integre` (services `antares-rag`, `antares-qdrant`), réseau
  `antares-local` seul : aucun accès Internet (vérifié par `check-local.sh`).
  `install.sh` précharge le modèle d'embeddings (~520 Mo, conteneur `rag-warmup`),
  génère `RAG_INTEGRATED_TOKEN` et pose `COMPOSE_PROFILES=rag-integre` si le RAG
  d'ai-to-boost est absent.
- Connexions → RAG, mode « RAG intégré » : adresses et jeton fixés par le déploiement ;
  celles du RAG existant restent enregistrées pour y revenir.
- Alimentation (mode intégré seulement) : fenêtre « Projets du RAG intégré » (dépôt de
  Markdown, texte, code, PDF, Word ; un projet = collection `proj-<projet>` créée au
  premier document) et `rag-index.sh <projet> <dossier>`. Le RAG d'ai-to-boost reste
  alimenté par ses propres outils : antares n'y écrit que les fiches de connaissance.

## Conséquences

### Positives

- antares a un RAG sans ai-to-boost, hors ligne, sans VRAM.
- Comparaison possible entre les deux RAG par simple changement de mode.
- Mesuré : recherche 31 ms ; indexation de 176 000 caractères (180 extraits) en 9,5 s ;
  11 ADR (98 extraits) en 29 s.

### Négatives / Coûts

- Code du service dupliqué : une évolution de l'API côté ai-to-boost est à reporter ici.
- ~1,9 Go de RAM (modèle ONNX) + ~160 Mo (Qdrant) quand le profil tourne.

### Neutres / À surveiller

- Les données des deux RAG sont séparées : pas de copie d'ai-to-boost vers le RAG
  intégré (choix du 2026-10-07).
- Le nom d'un fichier indexé par `rag-index.sh` remplace `/` par `_`.

## Références

- ADR 0002 (RAG des projets), ADR 0006 (fiches), ADR 0009 (connexions)
- `deploy/s2s/rag/`, `deploy/s2s/router/ragstore.py`, `deploy/s2s/rag-index.sh`
