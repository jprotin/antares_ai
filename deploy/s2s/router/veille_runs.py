"""Passage manuel de la veille (bouton « Nouveau passage ») : le routeur dépose une
demande dans sa base (`run_requests`, cf. veille_votes.py) ; antares-tasks la prend en
10 s au plus (tasks/manual.py) et note l'avancement dans tasks.db (`manual_runs`), lu ici
en lecture seule.

États : idle (aucune demande), pending (déposée, pas encore prise), running, done,
failed, expired (jamais prise : service arrêté). Une demande à la fois, une toutes les
`COOLDOWN` au plus ; refusée pendant un appel vocal (modèle et processeur occupés).
"""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from veille_votes import VotesDB

COOLDOWN = timedelta(minutes=5)
# Même valeur que tasks/manual.py : au-delà, la demande n'est plus prise
REQUEST_TTL = timedelta(minutes=10)


class RunRefused(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _progress(tasks_db: Path, request_id: int) -> dict | None:
    if not tasks_db.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{tasks_db}?mode=ro", uri=True, timeout=5)
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT status, started_at, finished_at, run_id FROM manual_runs "
                "WHERE request_id = ?",
                (request_id,),
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return None
        raise
    return dict(row) if row else None


def status(tasks_db: Path, votes: VotesDB, now: datetime) -> dict:
    last = votes.last_run_request()
    found = {
        "state": "idle",
        "request_id": None,
        "requested_at": None,
        "started_at": None,
        "finished_at": None,
        "run_id": None,
        "retry_after": 0,
    }
    if last is None:
        return found
    requested = datetime.fromisoformat(last["requested_at"])
    progress = _progress(tasks_db, last["id"])
    if progress:
        state = progress["status"]
    elif now - requested < REQUEST_TTL:
        state = "pending"
    else:
        state = "expired"
    return {
        **found,
        **{k: v for k, v in (progress or {}).items() if k != "status"},
        "state": state,
        "request_id": last["id"],
        "requested_at": last["requested_at"],
        "retry_after": max(0, int((COOLDOWN - (now - requested)).total_seconds())),
    }


def check(current: dict, call_active: bool) -> None:
    """Lève RunRefused (statut HTTP, message court) si un passage ne peut pas partir."""
    if current["state"] in ("pending", "running"):
        raise RunRefused(409, "Un passage est déjà en cours")
    if call_active:
        raise RunRefused(409, "Appel vocal en cours : relance après l'appel")
    if current["retry_after"] > 0:
        minutes = -(-current["retry_after"] // 60)
        raise RunRefused(
            429, f"Prochain passage manuel possible dans {minutes} min au plus"
        )
