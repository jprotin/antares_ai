# 0002 — Documentation des projets : RAG d'ai-to-boost, projet choisi ou cité

- **Status** : accepted
- **Date** : 2026-09-29
- **Auteur(s)** : jprotin
- **Tags** : architecture, RAG, LLM, confidentialité

## Contexte

L'usage principal d'antares_ai est un assistant vocal qui répond sur les projets de
l'utilisateur. Cette documentation est déjà indexée par ai-to-boost : Qdrant, embeddings
nomic 768d, une collection commune `knowledge` et une collection `proj-<slug>` par
projet, alimentée par `ai-to-boost-rag-sync.sh`. Le service `rag:8100` expose la
recherche (`POST /query`) et sert déjà le chat de la webui. Le `llm-router` d'antares
est déjà branché sur le réseau `ai-assistant-net`.

Contraintes : ne pas dupliquer l'indexation, garder la latence vocale (~1 s) et ne pas
polluer les conversations banales. Mesure : les scores de similarité ne séparent pas
une question projet (0,645) d'une recette (0,611) ou d'un « salut » (0,581). Un seuil
de score ne peut donc pas décider seul quand consulter la documentation.

## Options envisagées

### Option 1 : projet choisi dans les Réglages

- **Description** : un projet actif ; sa documentation accompagne chaque question.
- **Pour** : fiable, prévisible, ~50-100 ms.
- **Contre** : il faut penser à choisir le projet avant de poser la question.

### Option 2 : outil de recherche appelé par le LLM

- **Description** : le routeur expose un outil « rechercher dans mes projets » et
  exécute la recherche quand le modèle l'appelle.
- **Pour** : entièrement automatique.
- **Contre** : un aller-retour LLM de plus (~1 s avec e4b, 2-3 s avec 26b), appels
  d'outils inégaux avec les petits modèles.

### Option 3 : hybride — projet choisi, ou projet cité par son nom

- **Description** : option 1, plus détection du nom d'un projet indexé dans la question
  (normalisée : casse, accents, séparateurs), valable pour cette question.
- **Pour** : rapide et prévisible, couvre la question ponctuelle sans réglage.
- **Contre** : un projet mal transcrit par le STT n'est pas détecté.

## Décision

Nous retenons l'**option 3**. Le `llm-router` interroge `rag:8100` sur `knowledge` et
les projets choisis ou cités, puis ajoute jusqu'à 4 extraits (600 caractères) à la
consigne système, avec la règle : résumer à l'oral, ne pas inventer si l'information
manque. Une relance courte (« et ensuite ? ») est complétée par la question précédente.
La liste des projets est lue dans Qdrant (collections `proj-*` non vides).

Le RAG reste actif avec les modèles Claude : les extraits partent alors chez Anthropic
avec la conversation, choix assumé par l'utilisateur et signalé par le badge
« hors local ».

## Conséquences

### Positives

- Aucune indexation dupliquée : un projet synchronisé côté ai-to-boost apparaît dans
  les Réglages sous une minute.
- Coût mesuré : recherche 40-100 ms, premier mot +0,1 s (0,46 s contre 0,34 s, e4b).
- Projets consultés affichés sous la réponse (`/api/rag/last`).
- Le moteur vocal reste isolé : seul le routeur parle au RAG.

### Négatives / Coûts

- Dépendance au service `rag` d'ai-to-boost ; indisponible, la réponse part sans
  documentation (dégradation douce, journalisée).
- Qualité limitée par l'indexation (extraits PDF bruts, embeddings sans préfixes
  `search_query`/`search_document` de nomic).

### Neutres / À surveiller

- Détection par nom sensible à la transcription : prévoir des alias si besoin.
- L'option 2 reste possible plus tard derrière le même routeur.

## Alternatives non explorées (et pourquoi)

- **Serveur MCP `qdrant`** : conçu pour Claude Code, pas pour un LLM Ollama en streaming.
- **Index propre à antares** : duplication de l'ingestion et des embeddings.

## Références

- `deploy/s2s/router/rag.py`, `deploy/s2s/README.md`
- ai-to-boost : `services/rag/server.py`, `docs/runbooks/phase5-rag.md`,
  `docs/runbooks/phase6b-worker.md`
- ADR 0001 (moteur temps réel)
