"""Fusion du catalogue des voix (voices.py) : python3 -m unittest test_voices (dans router/)."""

import json
import tempfile
import unittest
from pathlib import Path

import voices

CATALOG = {
    "default": "sohee",
    "voices": [
        {
            "id": "bender",
            "name": "Bender",
            "file": "bender.wav",
            "effect": "robot",
            "persona": "un robot",
            "avatars": ["bender"],
        },
        {
            "id": "sohee",
            "name": "Miss Antares",
            "file": "sohee.wav",
            "avatars": ["orb"],
        },
    ],
}
LOCAL = {
    "voices": [
        {
            "id": "bender-perso",
            "base": "bender",
            "file": "perso/bender-perso.wav",
            "effect": "rauque",
            "avatars": ["bender"],
        },
    ]
}


class Merge(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "voices.json").write_text(json.dumps(CATALOG), encoding="utf-8")
        self.local = self.root / "perso" / "voices.json"

    def add_local(self, with_file=True):
        self.local.parent.mkdir()
        self.local.write_text(json.dumps(LOCAL), encoding="utf-8")
        if with_file:
            (self.root / "perso" / "bender-perso.wav").write_bytes(b"RIFF")

    def load(self):
        return voices.load(self.root / "voices.json", self.local)

    def test_sans_catalogue_local(self):
        self.assertEqual(self.load(), CATALOG)

    def test_voix_locale_herite_et_prend_l_avatar(self):
        self.add_local()
        catalog = {v["id"]: v for v in self.load()["voices"]}
        perso = catalog["bender-perso"]
        self.assertEqual(perso["persona"], "un robot")
        self.assertEqual(perso["effect"], "rauque")
        self.assertNotIn("base", perso)
        self.assertEqual(perso["avatars"], ["bender"])
        self.assertEqual(catalog["bender"]["avatars"], [])
        self.assertEqual(catalog["sohee"]["avatars"], ["orb"])

    def test_extrait_absent_catalogue_versionne(self):
        self.add_local(with_file=False)
        self.assertEqual(self.load(), CATALOG)

    def test_defaut_local_inconnu_ignore(self):
        self.add_local()
        self.local.write_text(
            json.dumps({**LOCAL, "default": "absente"}), encoding="utf-8"
        )
        self.assertEqual(self.load()["default"], "sohee")


if __name__ == "__main__":
    unittest.main()
