# 0001 — Moteur temps réel : huggingface/speech-to-speech en cascade locale

- **Status** : accepted
- **Date** : 2026-09-29
- **Auteur(s)** : jprotin
- **Tags** : architecture, temps réel, local, voix, LLM

## Contexte

antares_ai doit offrir un appel vocal avec un LLM, 100 % local par défaut, sur un poste
à 12 Go de VRAM (RTX 5070 Ti Laptop) déjà partagé avec la stack ai-to-boost (Ollama,
LiteLLM, speaches, claude-bridge). Exigences : installation en une commande, sortie
réseau impossible à l'usage (prouvée par isolation, pas seulement par configuration),
français, sous-titres en direct, latence perçue d'environ une seconde, et Claude Code
utilisable en option via `claude -p` uniquement (jamais de clé d'API).

L'analyse (`docs/analyse-speech-to-speech-local.md`, § 4-5) recommandait une chaîne en
cascade VAD → STT → LLM → TTS assemblée avec Pipecat. Avant de coder cet assemblage, un
spike (branche `feature/spike-hf-s2s`) a évalué huggingface/speech-to-speech 1.0.0, qui
fournit déjà cette cascade avec un serveur Realtime compatible OpenAI (WebSocket).

## Options envisagées

### Option 1 : cascade assemblée avec Pipecat (recommandation de l'analyse)

- **Description** : backend Python maison, Pipecat pour l'orchestration, briques
  existantes (speaches pour le STT, LiteLLM, TTS à choisir), transport WebRTC.
- **Pour** : contrôle total, transport WebRTC avec annulation d'écho du navigateur.
- **Contre** : tout le temps réel est à écrire et à régler (VAD, découpage en phrases,
  coupure de parole, sous-titres) ; speaches sans TTS vérifié.
- **Coût** : plusieurs jours avant un premier appel mesurable.

### Option 2 : huggingface/speech-to-speech conteneurisé

- **Description** : moteur HF en version figée dans une image Docker, cascade intégrée
  (Smart Turn, Parakeet, LLM compatible OpenAI, Qwen3-TTS), API Realtime en WebSocket ;
  antares_ai n'écrit que l'interface, un routeur LLM et l'outillage d'installation.
- **Pour** : premier appel fonctionnel en un jour ; mesuré à ~1,0 s de latence
  (Parakeet 25 ms, Smart Turn 45 ms) ; texte disponible à chaque étape (sous-titres) ;
  WebSocket compatible avec l'accès distant via ngrok (pas d'UDP).
- **Contre** : dépendance à un projet amont jeune ; défauts amont à neutraliser
  (LLM OpenAI par défaut, groupement de 3 phrases, paramètres de tirage TTS non exposés) ;
  pas d'annulation d'écho WebRTC côté serveur.
- **Coût** : faible ; maintien de quelques correctifs (NLTK, tirage Qwen3).

### Option 3 : modèle speech-to-speech natif (Moshi, Qwen-Omni, Ultravox…)

- **Description** : un seul modèle audio → audio.
- **Pour** : latence théorique minimale.
- **Contre** : français faible ou non garanti, modèles corrects au-delà de 12 Go,
  impossible d'y brancher Ollama ou Claude, sous-titres non garantis.
- **Coût** : non évalué (écarté par l'analyse).

## Décision

Nous retenons l'**option 2** : huggingface/speech-to-speech 1.0.0 en Docker, sur un
réseau `internal` sans route vers Internet, modèles préchargés par `install.sh` puis
mode hors ligne HF. Profil actif (bloc `x-profile` de `deploy/s2s/compose.yaml`) :

- **STT** : Parakeet TDT, français.
- **LLM** : Ollama **en direct** via un routeur maison (`llm-router`) qui applique le
  modèle choisi dans l'interface ; LiteLLM est contourné car il perd
  `reasoning_effort=none` en streaming (latence ×3). Défaut `gemma4:e4b` (~1,0 s),
  `gemma4:26b` pour la qualité (2,1 à 3,5 s).
- **TTS** : Qwen3-TTS 1.7B Base, quantifié Q8_0 (BF16 ne tient pas à côté du LLM),
  voix clonée `sohee` par x-vector, tirage bridé à température 0.3 et top_k 10
  (`qwen3_sampling.py`) ; synthèse dès la première phrase.
- **Claude** : option explicite dans l'interface, via le claude-bridge d'ai-to-boost
  (`claude -p`, sans outils) ; seul cas où du texte quitte la machine, signalé par un
  badge « hors local ».

## Conséquences

### Positives

- Appel vocal opérationnel, 100 % local vérifié par `check-local.sh` (HF, OpenAI,
  1.1.1.1 injoignables), installation en une commande.
- Voix stable : timbre fixé par le clonage (similarité 0,965 contre 0,81 en locuteur
  prédéfini), ton régulier grâce au tirage bridé (écart-type de hauteur 24 → 14 Hz).
- Modèle et voix changeables à chaud depuis l'interface.

### Négatives / Coûts

- VRAM à ~10,1 Go sur 12 avec `gemma4:e4b` : peu de marge ; le préchargement exige
  d'arrêter `s2s`, et un autre usage de la stack peut évincer le LLM.
- Correctifs d'intégration à maintenir à chaque montée de version amont (lien NLTK,
  patch du tirage Qwen3 qui force les valeurs).
- Claude répond en ~7 s (démarrage de Claude Code à chaque appel), silence couvert
  uniquement par l'état « réflexion » de l'orbe.

### Neutres / À surveiller

- Pas d'annulation d'écho serveur : casque recommandé pour la coupure de parole.
- Réévaluer Kokoro `ff_siwis` ou Piper si la charge VRAM devient bloquante (ton plus
  régulier, ~10 Hz, mais timbre jugé moins adapté).
- L'archive des appels (phase 3) reste à construire autour de ce moteur.

## Alternatives non explorées (et pourquoi)

- **LiveKit Agents** : ajoute un serveur média, sans gain pour un usage mono-poste.
- **Voice mode d'Open WebUI** : pas de contrôle sur l'expérience d'appel, l'archive ni
  le routage vers Claude ; banc de comparaison seulement.
- **XTTS-v2, F5-TTS** : licences non commerciales.

## Références

- `docs/analyse-speech-to-speech-local.md` (§ 4, 5, 9, 10)
- `deploy/s2s/README.md`, `deploy/s2s/compose.yaml`
- <https://github.com/huggingface/speech-to-speech>
- ADR 0002 d'ai-to-boost : Claude uniquement via `claude -p`
