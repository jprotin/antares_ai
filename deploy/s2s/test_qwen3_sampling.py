"""Tirage par voix de qwen3_sampling.py, dans l'image s2s (le module y est chargé par .pth) :

docker run --rm --entrypoint python -v "$PWD/qwen3_sampling.py:/opt/venv/lib/python3.12/site-packages/qwen3_sampling.py:ro" \
  -v "$PWD/test_qwen3_sampling.py:/test_qwen3_sampling.py:ro" -e QWEN3_TTS_TEMPERATURE=0.3 -e QWEN3_TTS_TOP_K=10 \
  antares/s2s:1.0.0 -m unittest /test_qwen3_sampling.py
"""

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

import qwen3_sampling


class SamplingForVoice(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.catalog = self.dir / "voices.json"
        self.write(
            [
                {"id": "sohee", "file": "sohee.wav"},
                {
                    "id": "bender-perso",
                    "file": "perso/bender-perso.wav",
                    "sampling": {"temperature": 0.6, "top_k": 30, "inconnu": 1},
                },
            ]
        )
        qwen3_sampling._CATALOG = self.catalog
        qwen3_sampling._LOCAL = self.dir / "perso" / "voices.json"
        qwen3_sampling._catalog_cache = ((), {})

    def write(self, voices):
        self.catalog.write_text(json.dumps({"voices": voices}), encoding="utf-8")

    def test_global_sans_voix(self):
        self.assertEqual(
            qwen3_sampling.sampling_for(None), {"temperature": 0.3, "top_k": 10}
        )

    def test_voix_sans_reglage_propre(self):
        voice = str(self.dir / "sohee.wav")
        self.assertEqual(
            qwen3_sampling.sampling_for(voice), {"temperature": 0.3, "top_k": 10}
        )

    def test_voix_avec_reglage_propre(self):
        voice = str(self.dir / "perso" / "bender-perso.wav")
        self.assertEqual(
            qwen3_sampling.sampling_for(voice), {"temperature": 0.6, "top_k": 30}
        )

    def test_catalogue_absent(self):
        qwen3_sampling._CATALOG = self.dir / "absent.json"
        voice = str(self.dir / "perso" / "bender-perso.wav")
        self.assertEqual(
            qwen3_sampling.sampling_for(voice), {"temperature": 0.3, "top_k": 10}
        )

    def test_catalogue_relu_quand_il_change(self):
        voice = str(self.dir / "perso" / "bender-perso.wav")
        qwen3_sampling.sampling_for(voice)
        self.write(
            [
                {
                    "id": "bender-perso",
                    "file": "perso/bender-perso.wav",
                    "sampling": {"temperature": 0.45},
                }
            ]
        )
        later = time.time() + 5
        os.utime(self.catalog, (later, later))
        self.assertEqual(
            qwen3_sampling.sampling_for(voice), {"temperature": 0.45, "top_k": 10}
        )

    def test_catalogue_local(self):
        local = self.dir / "perso" / "voices.json"
        local.parent.mkdir()
        local.write_text(
            json.dumps(
                {
                    "voices": [
                        {
                            "id": "perso",
                            "file": "perso/ma-voix.wav",
                            "sampling": {"temperature": 0.5},
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        voice = str(self.dir / "perso" / "ma-voix.wav")
        self.assertEqual(
            qwen3_sampling.sampling_for(voice), {"temperature": 0.5, "top_k": 10}
        )


class VoiceTracking(unittest.TestCase):
    def test_voix_relevee_a_chaque_phrase(self):
        from speech_to_speech.TTS.qwen3_tts_handler import Qwen3TTSHandler

        class Handler:
            ref_audio = "/voices/perso/bender-perso.wav"

        phrase = Qwen3TTSHandler._process_voice_clone(Handler(), "Bonjour.")
        # Le corps d'origine échoue sur ce faux gestionnaire : la voix est relevée avant
        with self.assertRaises(Exception):
            next(phrase)
        self.assertEqual(
            qwen3_sampling._current_voice, "/voices/perso/bender-perso.wav"
        )


if __name__ == "__main__":
    unittest.main()
