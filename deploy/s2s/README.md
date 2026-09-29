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

Tout est dans le bloc `x-profile` de `compose.yaml` (l'encart de l'interface suit
automatiquement), puis relancer `./install.sh` pour précharger les nouveaux modèles.
Le prénom est aussi repris dans `--init_chat_prompt`.

## Vérifications

| Script               | Rôle                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `./check-local.sh`   | Prouve l'isolation : Internet bloqué, seul Ollama joignable             |
| `./smoke-test.sh`    | Appel de bout en bout sans micro, mesure la latence (`out/reponse.wav`) |
| `./voice-samples.sh` | Banc d'écoute de toutes les voix (`out/voix/index.html`)                |

## Architecture

```text
Navigateur ──> web (nginx, 127.0.0.1:8765) ──> s2s (réseau antares-local, internal)
                 page + /config.json              VAD Silero, STT Parakeet, TTS Qwen3
                                                   │
                                                   └─> llm-gw ──> ollama (ai-to-boost)
```

Le LLM est appelé directement sur Ollama : LiteLLM perd `reasoning_effort=none` en
streaming, ce qui triplait la latence (gemma4 raisonne par défaut).

VRAM mesurée : ~5,1 Go (moteur) + ~4,9 Go (gemma4) sur 12 Go.
