# Moteur speech-to-speech local

Appel vocal avec un LLM local, 100 % hors ligne, basé sur
[huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech) 1.0.0.

## Prérequis

- Docker + plugin compose, runtime NVIDIA (`nvidia-container-toolkit`)
- Stack `ai-to-boost` démarrée (conteneur `ollama`, réseau `ai-assistant-net`) avec `gemma4:e4b`

## Installation et usage

```bash
./install.sh            # une fois, en ligne : image + préchargement des modèles
docker compose up -d    # ensuite, hors ligne
```

Interface d'appel : <http://127.0.0.1:8765>

## Changer de modèle ou de voix

Depuis l'interface : bouton **Réglages** (roue dentée). Le choix est appliqué dès la
phrase suivante, même en cours d'appel, et persisté par le routeur LLM.

- **Modèle** : tout modèle de chat installé dans Ollama (`docker exec ollama ollama pull …`).
- **Voix** : voix clonées décrites dans `voices/voices.json`. Pour en ajouter une, déposer
  un extrait `.wav` propre (5 à 15 s, une seule voix) dans `voices/` et l'ajouter au
  catalogue (`id`, `name`, `gender`, `file`, `source`). Le prénom et le genre servent à
  la consigne donnée au LLM (« Tu es Ryan, un assistant vocal… »).

### Claude Code comme modèle (hors local)

Si le `claude-bridge` d'ai-to-boost tourne sur l'hôte (port 8088), `install.sh` recopie
son token dans `.env` et les modèles **Claude Opus** et **Claude Sonnet** apparaissent
dans les Réglages. Le routeur envoie l'historique de la conversation (texte seul) au
bridge, qui exécute `claude -p` sur l'abonnement, sans outils ni accès web.

- **Hors local** : la conversation écrite part chez Anthropic (l'audio et la
  transcription restent locaux). Le badge « hors local » le rappelle.
- **Latence** : ~7 s par réponse (démarrage de Claude Code à chaque appel), pendant
  lesquelles l'orbe reste sur l'état « réflexion ».

Le profil par défaut (modèle de démarrage, moteurs STT/TTS) est dans le bloc
`x-profile` de `compose.yaml` ; le modifier impose de relancer `./install.sh`.

### Pourquoi des voix clonées

Les locuteurs prédéfinis de Qwen3-TTS (modèle CustomVoice) changent de timbre d'une
phrase à l'autre. Mesuré sur 10 phrases : similarité de timbre minimale 0,81-0,85 pour
`sohee`, contre 0,965 une fois clonée (x-vector depuis un extrait, modèle Base).

### Pourquoi un tirage bridé

Le clonage fixe le timbre mais pas le ton : avec le tirage amont (température 0.9,
top_k 50), la voix alterne entre deux intonations. Mesuré sur 11 phrases enchaînées,
3 passages : écart-type de hauteur 24 Hz, contre 14 Hz à température 0.3 et top_k 10.
Le moteur n'exposant pas ces paramètres, `qwen3_sampling.py` (copié dans l'image) les
applique depuis `tts-temperature` et `tts-top-k` du bloc `x-profile`.

## Vérifications

| Script                            | Rôle                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| `./check-local.sh`                | Prouve l'isolation : Internet bloqué, seul Ollama joignable             |
| `./smoke-test.sh`                 | Appel de bout en bout sans micro, mesure la latence (`out/reponse.wav`) |
| `./voice-samples.sh`              | Banc d'écoute de toutes les voix (`out/voix/index.html`)                |
| `python3 llm_bench.py <modèles…>` | Compare des LLM Ollama en conditions réelles (`out/llm/index.html`)     |

## Architecture

```text
Navigateur ──> web (nginx, 127.0.0.1:8765) ──> s2s (réseau antares-local, internal)
                 │ page, /voices, /config.json      VAD Silero, STT Parakeet, TTS Qwen3
                 │                                  │
                 └── /api (réglages) ──────────> llm-router ──> ollama (ai-to-boost)
                                                  réécrit `model` selon les réglages
```

Le LLM est appelé directement sur Ollama (via `llm-router`) : LiteLLM perd
`reasoning_effort=none` en streaming, ce qui triplait la latence (gemma4 raisonne par défaut).

VRAM mesurée : ~5,1 Go (moteur) + ~4,9 Go (gemma4) sur 12 Go.

## Choix du LLM : mesures (2026-09-29, RTX 5070 Ti 12 Go, voix chargée)

| Modèle     | Part GPU | 1er mot | Débit       | Appel de bout en bout | Qualité observée                      |
| ---------- | -------- | ------- | ----------- | --------------------- | ------------------------------------- |
| gemma4:e4b | 100 %    | 0,33 s  | 95 tok/s    | ~1,0 s                | Correcte, réponses courtes            |
| qwen3.5:9b | 72 %     | 0,42 s  | 28 tok/s    | non mesuré            | Plus riche, fautes de français        |
| gemma4:12b | 60 %     | 0,78 s  | 12 tok/s    | 3,2-4,5 s             | Nettement meilleure                   |
| gemma4:26b | experts  | 1,0 s   | 17-19 tok/s | 2,1-3,5 s             | La meilleure (empathie, explications) |

gemma4:26b est un modèle à experts (~4 milliards de paramètres actifs par token) : il
tourne en grande partie sur le processeur mais reste plus rapide que gemma4:12b.
Détail des réponses : `python3 llm_bench.py gemma4:e4b gemma4:26b` puis `out/llm/index.html`.
