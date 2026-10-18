"""MCP client sessions for the allowlisted servers.

Two things matter here more than convenience:

1. Only servers named in the pack's allowed_servers are reachable at all. MCP's
   strength is that any client can talk to any server; that is also how a rogue
   server gets into a conversation, so the allowlist is not optional.
2. Every server's tool list is hashed and compared with the pack's pin before any
   of its tools is offered to the model.

A session is opened per operation. It costs a round trip and removes a whole
class of stale-session failure in front of an audience.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..events import Verdict, bus
from ..packs.loader import registry as packs
from .pinning import verify

log = logging.getLogger(__name__)


@dataclass
class ServerState:
    name: str
    url: str
    expected_pin: str = ""
    actual_pin: str = ""
    pinned_ok: bool = False
    tools: list[dict[str, Any]] = field(default_factory=list)
    error: str = ""

    @property
    def usable(self) -> bool:
        # In the naked profile an unpinned server is still used — that is the
        # behaviour the demo goes on to punish.
        if not settings.hardened:
            return not self.error
        return self.pinned_ok and not self.error


@asynccontextmanager
async def _session(url: str, token: str = ""):
    """Streamable HTTP session against one MCP server."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = {"Authorization": f"Bearer {token}"} if token else None
    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


def _token_for(name: str) -> str:
    # The n8n MCP trigger is bearer-protected in the hardened profile only.
    if name == "n8n" and settings.hardened:
        return settings.n8n_mcp_token
    return ""


class McpManager:
    def __init__(self) -> None:
        self.servers: dict[str, ServerState] = {}

    def configured(self) -> list[dict[str, Any]]:
        """Servers from MCP_SERVERS, filtered by the active pack's allowlist."""
        allowed = set(packs.active.allowed_servers)
        return [s for s in settings.servers if not allowed or s.get("name") in allowed]

    async def refresh(self) -> dict[str, ServerState]:
        """Connect to each allowlisted server, list its tools, check the pin."""
        pins = packs.active.pins
        states: dict[str, ServerState] = {}
        for entry in self.configured():
            name = str(entry.get("name"))
            url = str(entry.get("url"))
            expected = str(pins.get(name) or entry.get("pin") or "")
            state = ServerState(name=name, url=url, expected_pin=expected)
            try:
                async with _session(url, _token_for(name)) as session:
                    listed = await session.list_tools()
                    state.tools = [
                        {"name": t.name, "description": t.description or "",
                         "inputSchema": t.inputSchema}
                        for t in listed.tools
                    ]
            except Exception as exc:                        # noqa: BLE001
                state.error = str(exc)
                log.warning("MCP server %s unreachable: %s", name, exc)

            if not state.error:
                state.pinned_ok, state.actual_pin = verify(state.tools, expected)
                decision = "allow" if state.pinned_ok else ("block" if settings.hardened else "flag")
                if not expected:
                    detail = f"{name}: {len(state.tools)} tools, NOT PINNED (actual {state.actual_pin[:12]}…)"
                elif state.pinned_ok:
                    detail = f"{name}: {len(state.tools)} tools, pin matches"
                else:
                    detail = (f"{name}: TOOL DESCRIPTIONS CHANGED — expected "
                              f"{expected[:12]}…, got {state.actual_pin[:12]}…")
                bus.publish(Verdict(layer="mcp_pin", decision=decision, detail=detail,
                                    pack=packs.active_name, profile=settings.profile,
                                    extra={"server": name, "expected": expected,
                                           "actual": state.actual_pin,
                                           "tools": [t["name"] for t in state.tools]}))
            states[name] = state

        self.servers = states
        return states

    def tool_schemas(self) -> list[dict[str, Any]]:
        """Tool schemas for the model, taken only from allowlisted, pinned,
        reachable servers. A tool the pack refuses outright is never even
        described to the model: the cheapest refusal is the one the model never
        gets the chance to attempt."""
        schemas: list[dict[str, Any]] = []
        for state in self.servers.values():
            if not state.usable:
                continue
            for tool in state.tools:
                rule = packs.active.tool_rule(tool["name"])
                if rule.get("decision") == "refuse":
                    continue
                schemas.append({
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["inputSchema"] or {"type": "object", "properties": {}},
                    },
                })
        return schemas

    def server_for_tool(self, tool_name: str) -> ServerState | None:
        for state in self.servers.values():
            if any(t["name"] == tool_name for t in state.tools):
                return state
        return None

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        state = self.server_for_tool(tool_name)
        if state is None:
            return {"error": f"no allowlisted server offers {tool_name}"}
        if not state.usable:
            return {"error": f"server {state.name} is blocked: "
                             f"{state.error or 'tool list does not match its pin'}"}
        try:
            async with _session(state.url, _token_for(state.name)) as session:
                result = await session.call_tool(tool_name, arguments)
        except Exception as exc:                            # noqa: BLE001
            log.warning("tool %s failed: %s", tool_name, exc)
            return {"error": str(exc)}

        texts: list[str] = []
        for item in result.content:
            text = getattr(item, "text", None)
            if text:
                texts.append(text)
        return {"server": state.name, "content": "\n".join(texts) or "(no content)"}


manager = McpManager()
