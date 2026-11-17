"""Passage manuel demandé depuis l'interface (bouton « Nouveau passage ») : le routeur
dépose une ligne dans la table `run_requests` de sa base (VOTES_DB, cf.
router/veille_runs.py) ; le service la lit ici en lecture seule toutes les
`REQUEST_POLL_S` secondes, la prend dans tasks.db (`manual_runs`, une seule fois) et fait
un passage complet. Le routeur lit l'avancement dans tasks.db.

Une demande plus vieille que `REQUEST_TTL` (service arrêté entre-temps) est ignorée :
le routeur la montre expirée.
"""

import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger("tasks.manual")

REQUEST_POLL_S = 10.0
REQUEST_TTL = timedelta(minutes=10)


def pending(path: Path, after_id: int, now: datetime) -> int | None:
    """Numéro de la dernière demande non prise et récente, ou None ; jamais
    d'exception."""
    if not path.exists():
        return None
    since = (now - REQUEST_TTL).astimezone(timezone.utc).isoformat(timespec="seconds")
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            row = conn.execute(
                "SELECT MAX(id) FROM run_requests WHERE id > ? AND requested_at >= ?",
                (after_id, since),
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        if "no such table" not in str(exc):
            logger.warning("Demandes de passage illisibles (%s) : ignorées", exc)
        return None
    return int(row[0]) if row and row[0] is not None else None
