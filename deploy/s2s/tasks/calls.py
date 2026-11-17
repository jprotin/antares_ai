"""Report pendant un appel vocal : le routeur expose l'heure du dernier tour de
conversation (`GET /api/turn/last`, champ `at`, 0.0 après un redémarrage). Un tour de moins
de `idle_seconds` signale un appel actif : la veille attend par tranches de `wait_step_s`,
`max_wait_min` au plus, puis s'exécute quand même.

Limites connues : un long silence pendant un appel n'est pas vu ; un tour écrit récent
(conversation écrite) reporte aussi la veille.
"""

import logging
from collections.abc import Awaitable, Callable

import httpx

from settings import Call

logger = logging.getLogger("tasks.calls")

ReadAt = Callable[[], Awaitable[float | None]]
Sleep = Callable[[float], Awaitable[None]]


async def read_last_turn(client: httpx.AsyncClient, router_url: str) -> float | None:
    """Horodatage du dernier tour, ou None si le routeur ne répond pas."""
    try:
        response = await client.get(f"{router_url}/api/turn/last", timeout=3)
        response.raise_for_status()
        return float(response.json().get("at") or 0.0)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
        logger.info("Routeur injoignable (%s) : aucun appel supposé en cours", exc)
        return None


def call_active(at: float | None, now: float, idle_seconds: int) -> bool:
    if not at:  # routeur injoignable, ou aucun tour depuis son démarrage
        return False
    return now - at < idle_seconds


async def wait_quiet(
    read_at: ReadAt, now: Callable[[], float], sleep: Sleep, call: Call
) -> float:
    """Attend la fin d'un appel (borné) ; renvoie le nombre de secondes attendues."""
    waited = 0.0
    limit = call.max_wait_min * 60
    while call_active(await read_at(), now(), call.idle_seconds):
        if waited >= limit:
            logger.info(
                "Appel toujours en cours après %d min : veille lancée", limit // 60
            )
            break
        logger.info("Appel en cours : veille reportée de %d s", call.wait_step_s)
        step = min(call.wait_step_s, limit - waited)
        await sleep(step)
        waited += step
    return waited
