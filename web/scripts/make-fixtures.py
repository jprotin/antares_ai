"""Fixtures audio des tests (synthèse locale, hors ligne), via l'image s2s :

    docker run --rm -e HF_HUB_OFFLINE=1 -v antares-s2s-cache:/root/.cache:ro \
      -v "$PWD/scripts:/scripts:ro" -v "$PWD/tests/fixtures:/out" \
      -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
      --entrypoint python antares/s2s:1.0.0 /scripts/make-fixtures.py

question-fr.wav : question courte puis 2 s de silence (déclenche speech_stopped) ;
silence.wav : 3 s de silence (calibrage du filtre de bruit). PCM16 mono 48 kHz.
"""

import os
import wave

import numpy as np
import soxr
from pocket_tts import TTSModel

RATE = 48000
QUESTION = "Bonjour, quelle est la capitale de la France ?"


def write(path: str, samples: np.ndarray) -> None:
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    os.chown(path, int(os.environ["HOST_UID"]), int(os.environ["HOST_GID"]))


model = TTSModel.load_model(language="french")
voice = model.get_state_for_audio_prompt("estelle")
audio = soxr.resample(
    model.generate_audio(voice, QUESTION).numpy(), model.sample_rate, RATE
)
lead = np.zeros(int(0.3 * RATE), dtype=np.float32)
tail = np.zeros(int(2.0 * RATE), dtype=np.float32)
write("/out/question-fr.wav", np.concatenate([lead, audio, tail]))
write("/out/silence.wav", np.zeros(3 * RATE, dtype=np.float32))
print(f"question : {len(audio) / RATE:.2f} s de parole")
