"""Agents d'action : confier une tâche au worker agentique d'ai-to-boost.

Le worker (service systemd de l'hôte, `claude -p` avec outils) travaille dans un git
worktree, sur une branche `agent/<id>` : il ne pousse ni ne fusionne jamais. antares
l'utilise en mode `file` uniquement (lecture et écriture de fichiers, sans commande
shell). Le texte de la tâche part chez Anthropic : hors local, signalé dans
l'interface.

Déclenchement :
- à l'écrit, par le bouton « Lancer un agent » (POST /api/actions) ;
- à la voix (et à l'écrit), par « lance l'agent <nom> : <tâche> » : l'assistant répète
  la tâche et attend « oui » avant de lancer (cf. intercept).

Les actions sont suivies ici (ACTIONS_PATH) ; leur état est relu auprès du worker
tant qu'elles tournent.
"""

import json
import logging
import os
import re
import time
from pathlib import Path

import httpx

import agents

AGENT_URL = os.environ.get("AGENT_URL", "http://host.docker.internal:8089")
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")
ACTIONS_PATH = Path(os.environ.get("ACTIONS_PATH", "/data/actions.json"))
KEEP = 50
MAX_TASK_CHARS = 4000
# Au-delà, une demande de confirmation restée sans réponse est oubliée
CONFIRM_TTL_S = 180
RUNNING = ("accepted", "running")

TASK_FRAME = """{instructions}

Tâche demandée par l'utilisateur :
{task}

Ne modifie que les fichiers nécessaires à cette tâche. Termine par un résumé court, en \
français, de ce que tu as fait et de ce qui reste à vérifier."""

LAUNCH_RE = re.compile(r" (lance|lancer|lancez|demarre|demarrer|demarrez) (l )?agent ")
YES_RE = re.compile(
    r"^ (oui|ouais|yes|ok|okay|d accord|vas y|allez y|go|c est bon|je confirme|"
    r"confirme|confirmer|lance|lancez|parfait)\b"
)
NO_RE = re.compile(r"^ (non|annule|annuler|laisse tomber|stop|attends)\b")

logger = logging.getLogger("router.actions")
http = httpx.AsyncClient(base_url=AGENT_URL, timeout=httpx.Timeout(10))
# Demande en attente de « oui » : {"agent", "project", "task", "at"}
pending: dict | None = None


class ActionError(ValueError):
    """Refus explicite, affiché (ou prononcé) tel quel."""


def enabled() -> bool:
    return bool(AGENT_TOKEN)


def _headers() -> dict:
    return {"Authorization": f"Bearer {AGENT_TOKEN}"}


async def projects() -> dict[str, str]:
    """Projets du worker : {nom: chemin du dépôt}, dépôts présents seulement."""
    if not enabled():
        return {}
    try:
        response = await http.get("/projects", headers=_headers())
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("worker ai-to-boost injoignable (%s)", exc)
        return {}
    return {
        p["name"]: p["path"]
        for p in response.json().get("projects", [])
        if p.get("exists") and p.get("path")
    }


def resolve_project(known: dict[str, str], wanted: str) -> str | None:
    """Nom exact, sinon même nom à la casse et à la ponctuation près."""
    if wanted in known:
        return wanted
    target = agents.normalize(wanted)
    return next((n for n in known if agents.normalize(n) == target), None)


def load() -> list[dict]:
    if not ACTIONS_PATH.exists():
        return []
    return json.loads(ACTIONS_PATH.read_text(encoding="utf-8"))


def _store(actions: list[dict]) -> None:
    ACTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ACTIONS_PATH.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(actions[-KEEP:], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    tmp.replace(ACTIONS_PATH)


async def launch(agent: agents.Agent, task: str, project: str) -> dict:
    if not enabled():
        raise ActionError("agents d'action désactivés : AGENT_TOKEN absent")
    if agent.kind != "action":
        raise ActionError(f"« {agent.name} » n'est pas un agent d'action")
    task = task.strip()
    if not task:
        raise ActionError("tâche vide")
    if len(task) > MAX_TASK_CHARS:
        raise ActionError(f"tâche trop longue ({MAX_TASK_CHARS} caractères au plus)")
    known = await projects()
    if not known:
        raise ActionError("worker ai-to-boost injoignable ou sans projet")
    name = resolve_project(known, project or agent.repo)
    if name is None:
        raise ActionError(
            f"projet inconnu du worker : {project or agent.repo or 'aucun'}"
        )
    prompt = TASK_FRAME.format(instructions=agent.instructions, task=task)
    try:
        response = await http.post(
            "/jobs",
            headers=_headers(),
            json={"prompt": prompt, "repo": known[name], "mode": "file"},
        )
    except httpx.HTTPError as exc:
        raise ActionError(f"worker ai-to-boost injoignable : {exc}") from exc
    if response.status_code != 202:
        detail = response.json().get("error", "") if response.content else ""
        raise ActionError(f"lancement refusé ({response.status_code}) : {detail}")
    job_id = response.json()["job_id"]
    action = {
        "id": job_id,
        "agent": agent.name,
        "agent_id": agent.id,
        "project": name,
        "task": task,
        "status": "accepted",
        "started": time.time(),
    }
    _store([*load(), action])
    logger.info("Action %s lancée : %s sur %s", job_id, agent.name, name)
    return action


def _files(name_status: str) -> list[dict]:
    files = []
    for line in (name_status or "").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            files.append({"change": parts[0][:1], "path": parts[-1]})
    return files


async def refresh() -> list[dict]:
    """Relit auprès du worker l'état des actions en cours ; renvoie toutes les actions."""
    actions = load()
    changed = False
    for action in actions:
        if action["status"] not in RUNNING:
            continue
        try:
            response = await http.get(f"/jobs/{action['id']}", headers=_headers())
        except httpx.HTTPError:
            continue  # worker momentanément injoignable : on réessaiera
        if response.status_code == 404:
            action.update(
                status="error",
                error="action perdue (worker redémarré)",
                finished=time.time(),
            )
            changed = True
            continue
        if response.status_code != 200:
            continue
        job = response.json()
        if job.get("status") == action["status"]:
            continue
        action["status"] = job.get("status", action["status"])
        if action["status"] not in RUNNING:
            action.update(
                finished=time.time(),
                summary=job.get("summary", ""),
                error=job.get("error"),
                branch=job.get("branch"),
                base=job.get("base"),
                changed=job.get("changed", False),
                files=_files(job.get("files", "")),
            )
        changed = True
    if changed:
        _store(actions)
    return actions


# --- Déclenchement par la conversation (voix ou écrit), avec confirmation ------------


def _last_user(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            content = message.get("content")
            return content if isinstance(content, str) else ""
    return ""


def _task_after(text: str, agent: agents.Agent) -> str:
    """Texte qui suit le nom de l'agent, sans liaison (« : », « pour », « de »…)."""
    match = re.search(re.escape(agent.name), text, re.I)
    rest = text[match.end() :] if match else ""
    return re.sub(r"^[\s:,.\-–—]*(pour|de|d'|qu'il|qui)?\s*", "", rest, flags=re.I)


async def intercept(messages: list[dict], project: str) -> str | None:
    """Réponse directe (sans LLM) si le message lance un agent ou confirme un lancement.

    « lance l'agent X : tâche » → l'assistant répète la tâche et demande confirmation ;
    « oui » → lancement ; « non » → abandon ; autre chose → demande oubliée.
    """
    global pending
    said = _last_user(messages)
    text = agents.normalize(said)
    asks_launch = bool(LAUNCH_RE.search(text))
    if pending and not asks_launch and time.time() - pending["at"] < CONFIRM_TTL_S:
        waiting, pending = pending, None
        if YES_RE.search(text):
            agent = agents.find(waiting["agent"])
            if agent is None:
                return "Cet agent n'existe plus, je n'ai rien lancé."
            try:
                action = await launch(agent, waiting["task"], waiting["project"])
            except ActionError as exc:
                return f"Je n'ai pas pu lancer l'agent : {exc}."
            return (
                f"C'est lancé. L'agent {agent.name} travaille sur le projet "
                f"{action['project']} ; je vous préviens quand il a terminé."
            )
        if NO_RE.search(text):
            return "D'accord, je n'ai rien lancé."
    pending = None
    if not asks_launch:
        return None
    agent = agents.cited(said, kind="action")
    if agent is None:
        names = ", ".join(a.name for a in agents.load() if a.kind == "action")
        return (
            f"Je ne trouve pas cet agent d'action. Ceux disponibles sont : {names}."
            if names
            else "Aucun agent d'action n'est configuré."
        )
    if not enabled():
        return "Les agents d'action sont désactivés : le jeton du worker est absent."
    task = _task_after(said, agent).strip()
    # Projet nommé dans la phrase (« sur le projet microHabit »), sinon celui de l'agent
    # ou de l'interface ; la tâche est transmise telle que dite
    named = None
    for name in await projects():
        spoken = agents.normalize(name).strip()
        if f" {spoken} " in agents.normalize(task):
            named = name
            break
    if len(task) < 5:
        return (
            f"Que doit faire l'agent {agent.name} ? Redites la demande avec la tâche, "
            f"par exemple : lance l'agent {agent.name} sur le projet microHabit, "
            "pour ajouter une section licence au README."
        )
    target = named or agent.repo or project
    if not target:
        return (
            "Sur quel projet ? Précisez-le dans la demande, par exemple « sur le "
            "projet microHabit »."
        )
    pending = {"agent": agent.id, "project": target, "task": task, "at": time.time()}
    return (
        f"Je confie à l'agent {agent.name}, sur le projet {target}, la tâche "
        f"suivante : {task.rstrip('.')}. Il travaille avec Claude, hors local, et ne "
        "modifie que des fichiers, sur une branche à part. Vous confirmez ?"
    )
