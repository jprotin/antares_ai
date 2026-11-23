"""Garde des écritures sur /api/ (audit de sécurité 2026-11, point 3) : requêtes
intersites et DNS rebinding.

Toute requête POST, PUT, PATCH ou DELETE sous /api/ est refusée (403) :
- si elle vient d'un autre site (`Sec-Fetch-Site: cross-site`) ;
- si elle porte un en-tête `Origin` qui n'est ni l'interface locale
  (http://127.0.0.1:8765, http://localhost:8765) ni l'adresse publique du partage en
  cours ;
- si elle ne porte pas l'en-tête maison `X-Antares: 1`. Un navigateur ne l'ajoute à une
  requête intersite qu'après une requête de contrôle CORS (preflight), que le routeur ne
  valide jamais : une page tierce ne peut donc pas l'envoyer, même par un formulaire ou
  une requête « simple ». L'interface l'ajoute à chacune de ses écritures (web/src/lib/api.ts).

Adresse publique du partage : ngrok (politique de trafic de share.sh) retire l'en-tête
`x-antares-origin` envoyé par le client puis l'écrit avec le schéma et l'hôte public de
la requête, comme il le fait pour `x-antares-user` (adresse Google de l'invité). Il n'est
pris en compte que si la requête porte aussi `x-antares-user` : les deux sont écrits
ensemble par ngrok, seulement après la connexion Google. Une requête locale qui porterait
un `x-antares-origin` sans `x-antares-user` (outil local, page tierce qui tenterait de
l'ajouter : bloquée de toute façon par le preflight) ne peut pas élargir la liste.

Les lectures (GET, HEAD, OPTIONS), le flux vocal (/v1/, WebSocket du moteur) et les routes
hors /api/ (/healthz) ne sont pas concernés. Les clients locaux (rag-index.sh, curl) envoient
`X-Antares: 1` et pas d'Origin ; antares-tasks ne fait que des lectures (GET /api/turn/last).
"""

import logging
from collections.abc import Mapping

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
LOCAL_ORIGINS = frozenset({"http://127.0.0.1:8765", "http://localhost:8765"})
MARKER_HEADER = "x-antares"
SHARE_ORIGIN_HEADER = "x-antares-origin"
USER_HEADER = "x-antares-user"

logger = logging.getLogger("router")


def allowed_origins(headers: Mapping[str, str]) -> set[str]:
    """Interface locale, plus l'adresse publique du partage si la requête vient du
    tunnel (x-antares-origin et x-antares-user, tous deux écrits par ngrok)."""
    origins = set(LOCAL_ORIGINS)
    shared = headers.get(SHARE_ORIGIN_HEADER, "").strip().lower()
    if shared and headers.get(USER_HEADER, "").strip():
        origins.add(shared)
    return origins


def refusal(method: str, path: str, headers: Mapping[str, str]) -> str | None:
    """Motif du refus d'une requête, None si elle passe."""
    if method.upper() not in WRITE_METHODS or not path.startswith("/api/"):
        return None
    if headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
        return "Requête refusée : elle vient d'un autre site"
    origin = headers.get("origin")
    if origin is not None and origin.strip().lower() not in allowed_origins(headers):
        return f"Requête refusée : origine non autorisée ({origin})"
    if headers.get(MARKER_HEADER, "").strip() != "1":
        return "Requête refusée : en-tête X-Antares manquant (écriture hors de l'interface)"
    return None


class WriteGuard:
    """Middleware ASGI pur (ne touche pas aux réponses en flux ni aux WebSocket)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            reason = refusal(scope["method"], scope["path"], Headers(scope=scope))
            if reason:
                logger.warning("%s %s : %s", scope["method"], scope["path"], reason)
                await JSONResponse({"detail": reason}, status_code=403)(
                    scope, receive, send
                )
                return
        await self.app(scope, receive, send)
