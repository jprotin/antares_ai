"""Réglage du tirage de Qwen3-TTS (GGML), chargé au démarrage de Python via un .pth.

Le moteur s2s n'expose ni la température ni le top_k de Qwen3-TTS : le runtime tire
avec ses valeurs amont (température 0.9, top_k 50), d'où une voix qui change de ton
d'une phrase à l'autre. Ce module impose QWEN3_TTS_TEMPERATURE, QWEN3_TTS_TOP_K et
QWEN3_TTS_REPETITION_PENALTY à chaque appel du runtime : faster_qwen3_tts transmet
toujours explicitement les valeurs amont, qu'un simple défaut ne remplacerait pas.

Une voix du catalogue (VOICES_CATALOG, /voices/voices.json, ou catalogue local
VOICES_LOCAL, /voices/perso/voices.json) peut imposer son propre tirage (champ
`sampling`, ex. {"temperature": 0.6, "top_k": 30}) : il remplace le réglage global pour
cette voix seulement. La voix en cours est l'extrait de référence
du gestionnaire Qwen3-TTS (voix de session de l'appel), relevé à chaque phrase.

QWEN3_TTS_MAX_FRAMES_PER_CHAR plafonne la longueur générée selon le texte : si le
modèle n'émet pas sa fin de phrase (emballement), la voix déraille jusqu'au plafond
du moteur, bien plus long que la phrase. Sans ces variables ni catalogue, rien n'est
modifié.
"""

import importlib.abc
import importlib.util
import json
import os
import sys
from pathlib import Path

# Marge du plafond, en trames de 80 ms : ~1 s pour les phrases très courtes
_MARGIN_FRAMES = 12
_SAMPLING_KEYS = {"temperature": float, "top_k": int, "repetition_penalty": float}
_HANDLER_MODULE = "speech_to_speech.TTS.qwen3_tts_handler"

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
_CATALOG = Path(os.environ.get("VOICES_CATALOG", "/voices/voices.json"))
_LOCAL = Path(
    os.environ.get("VOICES_LOCAL", str(_CATALOG.parent / "perso" / "voices.json"))
)

# Extrait de référence de la phrase en cours (None : voix par défaut du moteur)
_current_voice: str | None = None
# Tirage propre à chaque extrait, relu quand un catalogue change :
# (dates de modification, {chemin: tirage})
_catalog_cache: tuple[tuple, dict[Path, dict]] = ((), {})


def _mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def _voice_sampling() -> dict[Path, dict]:
    global _catalog_cache
    # Fichiers relatifs au dossier des voix dans les deux catalogues ; le local l'emporte
    catalogs = (_CATALOG, _LOCAL)
    mtimes = tuple(_mtime(path) for path in catalogs)
    if mtimes == _catalog_cache[0]:
        return _catalog_cache[1]
    sampling: dict[Path, dict] = {}
    for path, mtime in zip(catalogs, mtimes):
        if mtime is None:
            continue
        try:
            voices = json.loads(path.read_text(encoding="utf-8")).get("voices", [])
        except (OSError, ValueError):
            return _catalog_cache[1]
        for voice in voices:
            if voice.get("file") and isinstance(voice.get("sampling"), dict):
                sampling[(_CATALOG.parent / voice["file"]).resolve()] = {
                    key: _SAMPLING_KEYS[key](value)
                    for key, value in voice["sampling"].items()
                    if key in _SAMPLING_KEYS
                }
    _catalog_cache = (mtimes, sampling)
    return sampling


def sampling_for(voice: str | None) -> dict:
    """Tirage appliqué pour l'extrait `voice` : global, remplacé par celui de la voix."""
    if not voice:
        return dict(_OVERRIDES)
    return {**_OVERRIDES, **_voice_sampling().get(Path(voice).resolve(), {})}


def _patch_qwen3_sampling() -> None:
    from qwentts_cpp._binding import QwenTTS

    for method in ("stream", "synthesize"):
        original = getattr(QwenTTS, method)

        def wrapper(self, *args, _original=original, **kwargs):
            kwargs.update(sampling_for(_current_voice))
            if _FRAMES_PER_CHAR and kwargs.get("text"):
                cap = int(len(kwargs["text"]) * _FRAMES_PER_CHAR) + _MARGIN_FRAMES
                kwargs["max_new_tokens"] = min(kwargs.get("max_new_tokens", cap), cap)
            return _original(self, *args, **kwargs)

        setattr(QwenTTS, method, wrapper)


def _track_voice(handler_cls) -> None:
    original = handler_cls._process_voice_clone

    def _process_voice_clone(self, text):
        global _current_voice
        _current_voice = str(self.ref_audio) if self.ref_audio else None
        yield from original(self, text)

    handler_cls._process_voice_clone = _process_voice_clone


class _HandlerHook(importlib.abc.MetaPathFinder):
    """Relève la voix du gestionnaire Qwen3-TTS dès son import, sans l'importer d'avance."""

    def find_spec(self, name, path, target=None):
        if name != _HANDLER_MODULE:
            return None
        sys.meta_path.remove(self)
        spec = importlib.util.find_spec(name)
        if spec is None or spec.loader is None:
            return spec
        exec_module = spec.loader.exec_module

        def patched(module):
            exec_module(module)
            _track_voice(module.Qwen3TTSHandler)

        spec.loader.exec_module = patched
        return spec


if _OVERRIDES or _FRAMES_PER_CHAR or _CATALOG.exists() or _LOCAL.exists():
    _patch_qwen3_sampling()
    sys.meta_path.insert(0, _HandlerHook())
