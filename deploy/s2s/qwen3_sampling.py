"""Réglage du tirage de Qwen3-TTS (GGML), chargé au démarrage de Python via un .pth.

Le moteur s2s n'expose ni la température ni le top_k de Qwen3-TTS : le runtime tire
avec ses valeurs amont (température 0.9, top_k 50), d'où une voix qui change de ton
d'une phrase à l'autre. Ce module impose QWEN3_TTS_TEMPERATURE et QWEN3_TTS_TOP_K
à chaque appel du runtime : faster_qwen3_tts transmet toujours explicitement les
valeurs amont, qu'un simple défaut ne remplacerait pas. Sans ces variables, rien
n'est modifié.
"""

import os

_OVERRIDES = {
    name: cast(os.environ[var])
    for name, var, cast in (
        ("temperature", "QWEN3_TTS_TEMPERATURE", float),
        ("top_k", "QWEN3_TTS_TOP_K", int),
    )
    if os.environ.get(var)
}


def _patch_qwen3_sampling() -> None:
    from qwentts_cpp._binding import QwenTTS

    for method in ("stream", "synthesize"):
        original = getattr(QwenTTS, method)

        def wrapper(self, *args, _original=original, **kwargs):
            kwargs.update(_OVERRIDES)
            return _original(self, *args, **kwargs)

        setattr(QwenTTS, method, wrapper)


if _OVERRIDES:
    _patch_qwen3_sampling()
