"""Client MCP minimal (Model Context Protocol) : connexion et liste des outils.

Transports :
- `http` (« streamable HTTP », spécification actuelle) : chaque message JSON-RPC est un
  POST ; la réponse arrive en JSON ou en flux SSE ; l'identifiant de session
  (`Mcp-Session-Id`) est renvoyé dans les requêtes suivantes.
- `sse` (ancien transport) : un GET ouvre un flux SSE qui annonce l'adresse où poster
  (`event: endpoint`) ; les réponses arrivent sur ce flux.

Les serveurs locaux en ligne de commande (stdio) passent par un relais HTTP (ex.
`mcp-proxy`), cf. README. Utilisation des outils dans les conversations : lot suivant.
"""

import asyncio
import json
import time
from urllib.parse import urljoin

import httpx

from connections import McpServer

PROTOCOL_VERSION = "2025-06-18"
TIMEOUT_S = 10
CLIENT_INFO = {"name": "antares", "version": "1.0"}


class McpError(RuntimeError):
    pass


def _headers(server: McpServer) -> dict:
    headers = {"Accept": "application/json, text/event-stream"}
    if server.token:
        headers["Authorization"] = f"Bearer {server.token}"
    return headers


def _request(msg_id: int, method: str, params: dict | None = None) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}}


INITIALIZE = {
    "protocolVersion": PROTOCOL_VERSION,
    "capabilities": {},
    "clientInfo": CLIENT_INFO,
}


def _result(message: dict) -> dict:
    if "error" in message:
        error = message["error"]
        raise McpError(f"{error.get('code')} : {error.get('message')}")
    return message.get("result", {})


async def _read_sse(response: httpx.Response, msg_id: int) -> dict:
    """Premier message JSON-RPC portant `msg_id` dans un flux SSE."""
    data: list[str] = []
    async for line in response.aiter_lines():
        if line.startswith("data:"):
            data.append(line[5:].strip())
        elif not line and data:
            message = json.loads("\n".join(data))
            data = []
            if message.get("id") == msg_id:
                return message
    raise McpError("flux fermé sans réponse")


async def _http_call(
    http: httpx.AsyncClient,
    server: McpServer,
    session: dict,
    msg_id: int | None,
    method: str,
    params: dict | None = None,
) -> dict:
    headers = _headers(server)
    if session.get("id"):
        headers["Mcp-Session-Id"] = session["id"]
    body = (
        _request(msg_id, method, params)
        if msg_id is not None
        else {"jsonrpc": "2.0", "method": method, "params": params or {}}
    )
    async with http.stream("POST", server.url, json=body, headers=headers) as response:
        if response.status_code >= 400:
            raise McpError(f"HTTP {response.status_code}")
        if "mcp-session-id" in response.headers:
            session["id"] = response.headers["mcp-session-id"]
        if msg_id is None:
            return {}
        if "text/event-stream" in response.headers.get("content-type", ""):
            return _result(await _read_sse(response, msg_id))
        return _result(json.loads(await response.aread()))


async def _tools_http(server: McpServer) -> tuple[dict, list[dict]]:
    session: dict = {}
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as http:
        info = await _http_call(http, server, session, 1, "initialize", INITIALIZE)
        await _http_call(http, server, session, None, "notifications/initialized")
        tools = await _http_call(http, server, session, 2, "tools/list")
        if session.get("id"):
            # Fin de session propre (facultatif pour le serveur)
            try:
                await http.delete(
                    server.url,
                    headers={**_headers(server), "Mcp-Session-Id": session["id"]},
                )
            except httpx.HTTPError:
                pass
    return info, tools.get("tools", [])


async def _tools_sse(server: McpServer) -> tuple[dict, list[dict]]:
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as http:
        async with http.stream("GET", server.url, headers=_headers(server)) as stream:
            if stream.status_code >= 400:
                raise McpError(f"HTTP {stream.status_code}")
            lines = stream.aiter_lines()
            endpoint = None
            event = None
            async for line in lines:
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:") and event == "endpoint":
                    endpoint = urljoin(server.url, line[5:].strip())
                    break
            if not endpoint:
                raise McpError("pas d'adresse d'envoi annoncée (event: endpoint)")

            async def call(msg_id: int | None, method: str, params: dict | None = None):
                body = (
                    _request(msg_id, method, params)
                    if msg_id is not None
                    else {"jsonrpc": "2.0", "method": method, "params": params or {}}
                )
                posted = await http.post(endpoint, json=body, headers=_headers(server))
                if posted.status_code >= 400:
                    raise McpError(f"HTTP {posted.status_code}")
                if msg_id is None:
                    return {}
                data: list[str] = []
                async for line in lines:
                    if line.startswith("data:"):
                        data.append(line[5:].strip())
                    elif not line and data:
                        message = json.loads("\n".join(data))
                        data = []
                        if message.get("id") == msg_id:
                            return _result(message)
                raise McpError("flux fermé sans réponse")

            info = await call(1, "initialize", INITIALIZE)
            await call(None, "notifications/initialized")
            tools = await call(2, "tools/list")
    return info, tools.get("tools", [])


async def list_tools(server: McpServer) -> dict:
    """Test d'un serveur : nom annoncé, outils (nom, description), durée ou erreur."""
    start = time.monotonic()
    try:
        info, tools = await asyncio.wait_for(
            _tools_http(server) if server.transport == "http" else _tools_sse(server),
            timeout=TIMEOUT_S * 2,
        )
    except (httpx.HTTPError, McpError, ValueError, asyncio.TimeoutError) as exc:
        reason = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        return {
            "ok": False,
            "error": reason[:300],
            "seconds": round(time.monotonic() - start, 2),
        }
    server_info = info.get("serverInfo", {})
    return {
        "ok": True,
        "seconds": round(time.monotonic() - start, 2),
        "server": f"{server_info.get('name', '?')} {server_info.get('version', '')}".strip(),
        "tools": [
            {"name": t.get("name"), "description": (t.get("description") or "")[:200]}
            for t in tools
        ],
    }
