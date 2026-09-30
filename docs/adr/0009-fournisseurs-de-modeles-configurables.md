# 0009 — Fournisseurs de modèles configurables et liste découverte à la volée

- **Status** : accepted
- **Date** : 2026-09-30
- **Auteur(s)** : jprotin
- **Tags** : portabilité, LLM, configuration

## Contexte

antares est lié à la stack ai-to-boost : Ollama à une adresse fixe, appelé par son API
native, plus Claude via le bridge. L'utilisateur veut rendre l'outil portable (autre
PC, cloud) et brancher d'autres sources de modèles (LiteLLM, API externes) depuis une
page de configuration, avec une liste de modèles dynamique. C'est le premier lot d'un
plan plus large : connexions RAG (existant ou installé), MCP, installation sans
ai-to-boost, déploiement cloud.

## Options envisagées

### Option 1 : tout faire passer par LiteLLM

- **Pour** : une seule API (OpenAI) côté antares.
- **Contre** : impose LiteLLM partout ; perd les capacités natives d'Ollama
  (`num_ctx` pour les documents longs, préchargement, taille des modèles) ; LiteLLM
  perd `reasoning_effort=none` en flux (latence ×3, cf. ADR 0001).

### Option 2 : fournisseurs typés (Ollama natif, API compatible OpenAI), configurables

- **Pour** : Ollama garde ses capacités ; toute API OpenAI-compatible (LiteLLM, vLLM,
  OpenAI, Mistral…) se branche sans code ; configuration à chaud.
- **Contre** : deux chemins d'appel à maintenir.

### Option 3 : configuration par variables d'environnement seulement

- **Pour** : simple.
- **Contre** : redémarrage à chaque changement ; pas de test ni de liste dans
  l'interface.

## Décision

Nous retenons l'**option 2**.

- `connections.py` : fournisseurs enregistrés dans `/data/connections.json` (volume du
  routeur, mode 600), initialisés depuis `OLLAMA_URL` ; clés jamais renvoyées à
  l'interface.
- `providers.py` : découverte (Ollama : `/api/tags` + `/api/show` ; OpenAI :
  `/models`, filtrée des modèles non conversationnels), appels complets et en flux,
  préchargement (Ollama). Liste en cache 30 s, invalidée à chaque modification.
- Nommage `<fournisseur>/<modèle>` ; un nom ancien sans fournisseur désigne `ollama`
  (réglages, agents et mesures migrés à la lecture).
- Un fournisseur déclaré **hors local** suit la règle de Claude : coupé hors ligne et
  pendant un partage, repli sur le modèle par défaut signalé sous la réponse.
- Option **« Couper le raisonnement »** par fournisseur (défaut : oui si local) :
  `reasoning_effort: none` + `allowed_openai_params`, sans quoi LiteLLM (`drop_params`)
  retire le paramètre et gemma4 réfléchit 3 à 30 s avant le premier mot (mesuré :
  0,3 s avec l'option, identique à Ollama direct). « Tester » mesure le premier mot.
- Interface : Réglages → Connexions (ajout, test, modification, retrait) ; modèles
  groupés par fournisseur.

## Conséquences

### Positives

- LiteLLM d'ai-to-boost, un Ollama distant ou une API externe se branchent en quelques
  secondes, sans redémarrage (testé : LiteLLM, écrit et voix).
- Base des lots suivants (RAG, MCP, autre PC, cloud).

### Négatives / Coûts

- Paramètres propres à Ollama retirés pour les autres API ; pas de contexte long
  garanti ailleurs qu'avec Ollama.
- Des clés d'API sont stockées sur le disque du routeur (fichier 600, volume Docker).

### Neutres / À surveiller

- Le filtrage des modèles non conversationnels des API externes se fait par le nom.
- La page Connexions permet de viser n'importe quelle adresse : elle est réservée au
  propriétaire (bloquée pendant un partage ; authentification requise en cloud).

## Références

- ADR 0001 (moteur, LiteLLM écarté pour la latence), ADR 0008 (hors ligne), partage ngrok
- `deploy/s2s/router/providers.py`, `deploy/s2s/router/connections.py`
