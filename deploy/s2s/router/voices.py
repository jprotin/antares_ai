"""Catalogue des voix : catalogue versionné (voices/voices.json) et catalogue local.

Le catalogue local (voices/perso/voices.json, hors git comme les voix personnelles qu'il
décrit) ajoute des voix. Une voix locale peut hériter d'une voix versionnée (`base` :
persona, nom, genre…) ; elle prend les avatars qu'elle déclare, que les voix versionnées
perdent. Une voix locale dont l'extrait manque est ignorée : sans dossier perso (autre
installation), le catalogue versionné s'applique tel quel.
"""

import json
from pathlib import Path


def merge(catalog: dict, local: dict, root: Path) -> dict:
    by_id = {voice["id"]: voice for voice in catalog["voices"]}
    added = []
    for entry in local.get("voices", []):
        voice = {**by_id.get(entry.get("base"), {}), **entry}
        voice.pop("base", None)
        if voice.get("id") and voice.get("file") and (root / voice["file"]).is_file():
            added.append(voice)
    added_ids = {voice["id"] for voice in added}
    claimed = {avatar for voice in added for avatar in voice.get("avatars", [])}
    kept = [
        {**voice, "avatars": [a for a in voice["avatars"] if a not in claimed]}
        if "avatars" in voice
        else voice
        for voice in catalog["voices"]
        if voice["id"] not in added_ids
    ]
    voices = kept + added
    default = local.get("default")
    if default not in {voice["id"] for voice in voices}:
        default = catalog["default"]
    return {**catalog, "default": default, "voices": voices}


def load(catalog_path: Path, local_path: Path) -> dict:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    try:
        local = json.loads(local_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return catalog
    return merge(catalog, local, catalog_path.parent)
