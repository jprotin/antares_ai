"""Réglage du tirage de Qwen3-TTS (GGML), chargé au démarrage de Python via un .pth.

Le moteur s2s n'expose ni la température ni le top_k de Qwen3-TTS : le runtime tire
avec ses valeurs amont (température 0.9, top_k 50), d'où une voix qui change de ton
d'une phrase à l'autre. Ce module impose QWEN3_TTS_TEMPERATURE, QWEN3_TTS_TOP_K et
QWEN3_TTS_REPETITION_PENALTY à chaque appel du runtime : faster_qwen3_tts transmet
toujours explicitement les valeurs amont, qu'un simple défaut ne remplacerait pas.

QWEN3_TTS_MAX_FRAMES_PER_CHAR plafonne la longueur générée selon le texte : si le
modèle n'émet pas sa fin de phrase (emballement), la voix déraille jusqu'au plafond
du moteur, bien plus long que la phrase. Sans ces variables, rien n'est modifié.
"""

import os

# Marge du plafond, en trames de 80 ms : ~1 s pour les phrases très courtes
_MARGIN_FRAMES = 12

_OVERRIDES = {
    name: cast(os.environ[var])
    for name, var, cast in (
        ("temperature", "QWEN3_TTS_TEMPERATURE", float),
        ("top_k", "QWEN3_TTS_TOP_K", int),
        ("repetition_penalty", "QWEN3_TTS_REPETITION_PENALTY", float),
    )
    if os.environ.get(var)
}
_FRAMES_PER_CHAR = float(os.environ.get("QWEN3_TTS_MAX_FRAMES_PER_CHAR") or 0)


def _patch_qwen3_sampling() -> None:
    from qwentts_cpp._binding import QwenTTS

    for method in ("stream", "synthesize"):
        original = getattr(QwenTTS, method)

        def wrapper(self, *args, _original=original, **kwargs):
            kwargs.update(_OVERRIDES)
            if _FRAMES_PER_CHAR and kwargs.get("text"):
                cap = int(len(kwargs["text"]) * _FRAMES_PER_CHAR) + _MARGIN_FRAMES
                kwargs["max_new_tokens"] = min(kwargs.get("max_new_tokens", cap), cap)
            return _original(self, *args, **kwargs)

        setattr(QwenTTS, method, wrapper)


if _OVERRIDES or _FRAMES_PER_CHAR:
    _patch_qwen3_sampling()
