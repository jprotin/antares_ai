"""Banc d'écoute des voix TTS disponibles dans l'image, en français.

Génère la même phrase avec chaque voix de chaque moteur, mesure le temps avant le
premier son (TTFC) et la vitesse de synthèse (RTF), puis écrit une page d'écoute
/out/voix/index.html. Lancé par voice-samples.sh ; ENGINES=qwen3,mms pour n'en
relancer que certains (les autres résultats sont conservés).
"""

import html
import json
import os
import time
import traceback
import wave
from pathlib import Path
from queue import Queue
from threading import Event

import numpy as np

from speech_to_speech.pipeline.messages import TTSInput

TEXT = (
    "Bonjour, je suis là pour vous aider. Prenez votre temps : "
    "on peut en parler tranquillement, dès que vous êtes prêt."
)
RATE = 16000
OUT = Path("/out/voix")

# Genre d'après la documentation des moteurs ; « ? » quand il n'est pas documenté.
POCKET_VOICES = {
    "estelle": "F (française native)",
    "alba": "F",
    "marius": "M",
    "javert": "M",
    "jean": "M",
    "fantine": "F",
    "cosette": "F",
    "eponine": "F",
    "azelma": "F",
    "anna": "F",
    "vera": "F",
    "charles": "M",
    "paul": "M",
    "george": "M",
    "mary": "F",
    "jane": "F",
    "michael": "M",
    "eve": "F",
    "bill_boerst": "M",
    "peter_yearsley": "M",
    "stuart_bell": "M",
    "caro_davy": "F",
    "giovanni": "M",
    "lola": "F",
    "juergen": "M",
    "rafael": "M",
    "daan": "M",
}
KOKORO_VOICES = {
    "ff_siwis": "F (française native)",
    "am_michael": "M",
    "am_onyx": "M",
    "bm_george": "M",
    "af_heart": "F",
}
SUPERTONIC_VOICES = {f"{g}{i}": g for g in ("M", "F") for i in range(1, 6)}
QWEN3_GENDERS = {
    "vivian": "F",
    "serena": "F",
    "ono_anna": "F",
    "sohee": "F",
    "uncle_fu": "M",
    "dylan": "M",
    "eric": "M",
    "ryan": "M",
    "aiden": "M",
}


def make_handler(handler_cls, **setup_kwargs):
    return handler_cls(
        Event(),
        queue_in=Queue(),
        queue_out=Queue(),
        setup_args=(Event(),),
        setup_kwargs=setup_kwargs,
    )


def synthesize(handler) -> tuple[np.ndarray, float, float]:
    start = time.perf_counter()
    ttfc = None
    chunks = []
    for chunk in handler.process(TTSInput(text=TEXT, language_code="fr")):
        if chunk is None:
            continue
        ttfc = ttfc or time.perf_counter() - start
        chunks.append(np.asarray(chunk, dtype=np.int16).reshape(-1))
    elapsed = time.perf_counter() - start
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)
    return audio, ttfc or elapsed, elapsed


def save(engine: str, voice: str, gender: str, handler, results: list) -> None:
    try:
        audio, ttfc, elapsed = synthesize(handler)
        filename = f"{engine}-{voice}.wav"
        with wave.open(str(OUT / filename), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(audio.tobytes())
        duration = len(audio) / RATE
        results.append(
            {
                "engine": engine,
                "voice": voice,
                "gender": gender,
                "file": filename,
                "ttfc": round(ttfc, 2),
                "rtf": round(elapsed / duration, 2) if duration else None,
            }
        )
        print(f"OK   {engine:<10} {voice:<16} TTFC {ttfc:.2f}s", flush=True)
    except Exception as exc:
        results.append(
            {
                "engine": engine,
                "voice": voice,
                "gender": gender,
                "error": str(exc)[:200],
            }
        )
        print(f"ERR  {engine:<10} {voice:<16} {exc}", flush=True)


def run_engine(name: str, build, results: list) -> None:
    try:
        build(results)
    except Exception as exc:
        traceback.print_exc()
        results.append(
            {"engine": name, "voice": "*", "gender": "", "error": str(exc)[:200]}
        )
    finally:
        import torch

        torch.cuda.empty_cache()


def pocket(results):
    from speech_to_speech.TTS.pocket_tts_handler import PocketTTSHandler

    handler = make_handler(
        PocketTTSHandler, device="cpu", language="french", voice="estelle"
    )
    for voice, gender in POCKET_VOICES.items():
        try:
            handler.voice_state = handler.model.get_state_for_audio_prompt(voice)
        except Exception as exc:
            results.append(
                {
                    "engine": "pocket",
                    "voice": voice,
                    "gender": gender,
                    "error": str(exc)[:200],
                }
            )
            print(f"ERR  pocket     {voice:<16} {exc}", flush=True)
            continue
        save("pocket", voice, gender, handler, results)


def kokoro(results):
    from speech_to_speech.TTS.kokoro_handler import KokoroTTSHandler

    handler = make_handler(
        KokoroTTSHandler, device="cuda", voice="ff_siwis", lang_code="f"
    )
    for voice, gender in KOKORO_VOICES.items():
        handler.voice = voice
        save("kokoro", voice, gender, handler, results)


def supertonic(results):
    from speech_to_speech.TTS.supertonic_tts_handler import SupertonicTTSHandler

    handler = make_handler(SupertonicTTSHandler, voice="M1", lang="fr")
    for voice, gender in SUPERTONIC_VOICES.items():
        handler.voice = voice
        handler.voice_style = handler.tts.get_voice_style(voice_name=voice)
        save("supertonic", voice, gender, handler, results)


def qwen3(results):
    from speech_to_speech.TTS.qwen3_tts_handler import Qwen3TTSHandler

    backend = os.environ.get("QWEN3_BACKEND", "ggml")
    handler = make_handler(
        Qwen3TTSHandler,
        device="cuda",
        language="french",
        backend=backend,
        ggml_quantization=os.environ.get("QWEN3_QUANT", "BF16"),
    )
    for speaker in handler._supported_speakers() or list(QWEN3_GENDERS):
        handler.speaker = speaker
        save(
            "qwen3", speaker, QWEN3_GENDERS.get(speaker.lower(), "?"), handler, results
        )


def mms(results):
    from speech_to_speech.TTS.facebookmms_handler import FacebookMMSTTSHandler

    handler = make_handler(FacebookMMSTTSHandler, device="cuda", language="fr")
    save("mms", "fra", "?", handler, results)


def write_page(results: list) -> None:
    rows = []
    for r in results:
        if "error" in r:
            player = f"<span class=err>échec : {html.escape(r['error'])}</span>"
            metrics = ""
        else:
            player = f"<audio controls preload=none src='{r['file']}'></audio>"
            metrics = f"{r['ttfc']} s</td><td>{r['rtf']}"
        rows.append(
            f"<tr><td>{r['engine']}</td><td>{r['voice']}</td><td>{r['gender']}</td>"
            f"<td>{player}</td><td>{metrics}</td></tr>"
        )
    (OUT / "index.html").write_text(
        f"""<!doctype html><meta charset=utf-8>
<title>Banc d'écoute des voix</title>
<style>body{{font-family:system-ui;margin:2rem;max-width:70rem}}td,th{{padding:.3rem .6rem;text-align:left}}
tr:nth-child(even){{background:#8881}}.err{{color:#c33;font-size:.85em}}</style>
<h1>Banc d'écoute des voix</h1><p>Phrase : « {html.escape(TEXT)} »</p>
<p>TTFC : délai avant le premier son. RTF : temps de synthèse / durée audio (&lt; 1 = plus rapide que le temps réel).</p>
<table><tr><th>Moteur</th><th>Voix</th><th>Genre</th><th>Écoute</th><th>TTFC</th><th>RTF</th></tr>
{''.join(rows)}</table>""",
        encoding="utf-8",
    )
    (OUT / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    engines = {
        "pocket": pocket,
        "kokoro": kokoro,
        "supertonic": supertonic,
        "qwen3": qwen3,
        "mms": mms,
    }
    selected = os.environ.get("ENGINES", ",".join(engines)).split(",")
    previous = OUT / "results.json"
    results: list = json.loads(previous.read_text()) if previous.exists() else []
    results = [r for r in results if r["engine"] not in selected]
    for name in selected:
        run_engine(name, engines[name], results)
        write_page(results)


if __name__ == "__main__":
    main()
