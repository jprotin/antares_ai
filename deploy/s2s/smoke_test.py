"""Test d'appel de bout en bout, sans micro, 100 % hors ligne.

Synthétise une question en français (Pocket TTS, depuis le cache local), l'envoie en
temps réel au serveur Realtime, puis mesure la latence entre la fin de la parole et le
premier son de la réponse. La réponse audio est enregistrée pour écoute.

Lancé par smoke-test.sh dans un conteneur de l'image, sur le réseau isolé antares-local.
"""

import asyncio
import base64
import json
import os
import sys
import time
import wave
from typing import Any

import numpy as np
import soxr
import websockets
from pocket_tts import TTSModel

URL = os.environ.get("S2S_URL", "ws://s2s:8765/v1/realtime")
QUESTION = os.environ.get(
    "QUESTION", "Bonjour, peux-tu me donner une idée de recette rapide pour ce soir ?"
)
# Optionnels, comme le fait l'interface : voix clonée (chemin dans le conteneur) et consigne
VOICE = os.environ.get("S2S_VOICE")
INSTRUCTIONS = os.environ.get("S2S_INSTRUCTIONS")
RATE = 24000
CHUNK_S = 0.02
TRAILING_SILENCE_S = 2.0
REPLY_WAV = "/out/reponse.wav"
TIMEOUT_S = 60


def synthesize_question() -> bytes:
    model = TTSModel.load_model(language="french")
    voice = model.get_state_for_audio_prompt("estelle")
    audio = model.generate_audio(voice, QUESTION).numpy()
    audio = soxr.resample(audio, model.sample_rate, RATE)
    silence = np.zeros(int(TRAILING_SILENCE_S * RATE), dtype=np.float32)
    samples = np.concatenate([audio, silence])
    return (np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes()


async def send_audio(ws, pcm: bytes) -> float:
    """Envoie l'audio au rythme réel ; renvoie l'instant de fin de parole."""
    chunk_bytes = int(CHUNK_S * RATE) * 2
    speech_bytes = len(pcm) - int(TRAILING_SILENCE_S * RATE) * 2
    speech_end = 0.0
    for offset in range(0, len(pcm), chunk_bytes):
        chunk = pcm[offset : offset + chunk_bytes]
        await ws.send(
            json.dumps(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(chunk).decode(),
                }
            )
        )
        if offset + chunk_bytes >= speech_bytes and not speech_end:
            speech_end = time.monotonic()
        await asyncio.sleep(CHUNK_S)
    return speech_end


async def main() -> int:
    pcm = synthesize_question()
    async with websockets.connect(URL, max_size=None) as ws:
        session: dict[str, Any] = {
            "type": "realtime",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": RATE},
                    "turn_detection": {
                        "type": "server_vad",
                        "interrupt_response": True,
                    },
                },
                "output": {"format": {"type": "audio/pcm", "rate": RATE}},
            },
        }
        if VOICE:
            session["audio"]["output"]["voice"] = VOICE
        if INSTRUCTIONS:
            session["instructions"] = INSTRUCTIONS
        await ws.send(json.dumps({"type": "session.update", "session": session}))
        sender = asyncio.create_task(send_audio(ws, pcm))
        user_text, reply_text, reply_audio = "", "", bytearray()
        first_audio_at = None
        deadline = time.monotonic() + TIMEOUT_S + len(pcm) / (2 * RATE)
        while time.monotonic() < deadline:
            event = json.loads(await asyncio.wait_for(ws.recv(), timeout=TIMEOUT_S))
            kind = event["type"]
            if kind == "conversation.item.input_audio_transcription.completed":
                user_text = event["transcript"]
            elif kind == "response.output_audio.delta":
                first_audio_at = first_audio_at or time.monotonic()
                reply_audio += base64.b64decode(event["delta"])
            elif kind == "response.output_audio_transcript.done":
                reply_text = event["transcript"]
            elif kind == "error":
                print(f"ERREUR serveur : {event}")
                return 1
            elif kind == "response.done":
                break
        speech_end = await sender

    with wave.open(REPLY_WAV, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(bytes(reply_audio))
    os.chown(REPLY_WAV, int(os.environ["HOST_UID"]), int(os.environ["HOST_GID"]))

    print(f"Utilisateur (STT) : {user_text!r}")
    print(f"Assistant         : {reply_text!r}")
    print(f"Audio reçu        : {len(reply_audio) / (2 * RATE):.1f} s -> {REPLY_WAV}")
    if first_audio_at is None:
        print("ÉCHEC : aucune réponse audio")
        return 1
    print(f"Latence fin de parole -> premier son : {first_audio_at - speech_end:.2f} s")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
