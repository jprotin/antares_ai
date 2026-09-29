# 0003 — Agents « consignes » : fiches locales, choisies ou citées

- **Status** : accepted
- **Date** : 2026-09-29
- **Auteur(s)** : jprotin
- **Tags** : architecture, LLM, agents

## Contexte

L'utilisateur veut spécialiser le LLM vocal pour des tâches récurrentes (diagnostic,
relecture, rédaction…) avec des agents qu'il construit, sauvegarde et réutilise, et
les retrouver regroupés par domaine et par utilité. Deux familles sont possibles :
des agents qui ne changent que la consigne du LLM, et des agents qui agissent (outils,
fichiers) via le worker Claude Code d'ai-to-boost, asynchrone et hors local.

Contraintes : conserver la latence vocale (~1 s), le 100 % local par défaut, et la
logique déjà retenue pour le RAG (ADR 0002) : un réglage explicite, ou une mention
par nom dans la question, plutôt qu'une décision implicite du modèle.

## Options envisagées

### Option 1 : agents « consignes » gérés par le routeur

- **Description** : fiches (nom, domaine, utilité, instructions, projet, modèle)
  stockées par `llm-router`, ajoutées à la consigne système de chaque requête.
- **Pour** : aucune latence ajoutée, local, fonctionne avec tous les modèles.
- **Contre** : pas d'action (outils, fichiers) : l'agent ne fait que répondre.

### Option 2 : agents « d'action » via le worker ai-to-boost

- **Description** : la demande est transmise au worker (Claude Code outillé).
- **Pour** : peut lire un dépôt, produire un fichier, enchaîner des étapes.
- **Contre** : plusieurs dizaines de secondes, hors local, réponse asynchrone à
  annoncer à la voix.

### Option 3 : le LLM choisit l'agent (appel d'outil)

- **Description** : les agents sont exposés comme outils au modèle.
- **Pour** : automatique.
- **Contre** : +1 à 3 s par question concernée, fiabilité inégale des petits modèles.

## Décision

Nous retenons l'**option 1** maintenant ; l'option 2 viendra ensuite. Un agent
s'applique s'il est choisi dans les Réglages (tout l'appel) ou cité par son nom dans
la question (cette question ; le nom le plus long l'emporte ; une relance courte reste
avec lui). Ses instructions précèdent la documentation RAG dans la consigne ; son
projet remplace celui des Réglages ; son modèle, s'il est renseigné, remplace le
modèle actif pour sa réponse.

Domaine et utilité sont choisis dans des listes proposées (7 domaines, 6 utilités),
complétables par des valeurs personnelles. Les fiches sont stockées dans
`/data/agents.json` (volume du routeur). Un catalogue de départ de 28 agents
(`router/catalogue.json`, 8 domaines) est créé au premier lancement ; `seed_catalogue()`
ajoute ensuite les agents du catalogue absents d'une installation existante.

## Conséquences

### Positives

- Coût nul en latence (mesuré : premier mot 0,40 s avec un agent cité, e4b).
- Agents combinables avec le RAG et avec les modes de conversation à venir.
- Agent utilisé affiché sous la réponse (`/api/turn/last`).

### Négatives / Coûts

- Un agent avec son propre modèle force un chargement en VRAM (quelques secondes),
  puis évince le modèle précédent sur 12 Go.
- Détection par nom sensible à la transcription vocale.

### Neutres / À surveiller

- Qualité dépendante des instructions et du modèle : un petit modèle suit moins
  finement un format imposé.
- Pas de versionnage des fiches : sauvegarder le volume `antares-router-data`.

## Alternatives non explorées (et pourquoi)

- **Personas BMAD d'ai-to-boost** : conçues pour le pipeline de build, pas pour la
  conversation vocale ; réutilisables plus tard comme agents d'action.

## Références

- `deploy/s2s/router/agents.py`, `deploy/s2s/router/router.py`, `frontend/agents.js`
- ADR 0002 (RAG des projets)
