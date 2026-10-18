"""Step 6 (L4). Every tool call is allowed, capped, parked for confirmation or
refused, according to the pack.

The model proposes; this decides. Scene 3 turns on exactly that distinction: the
rogue server's hidden instruction does get the model to propose a payout change,
and the gate still refuses to let it happen without the member's PIN and an
officer's approval. You do not trust the model to police which tools it calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..db import park_action
from ..events import Verdict, bus
from ..llm.base import ToolCall
from ..mcp.client import manager
from ..packs.loader import registry as packs

log = logging.getLogger(__name__)


@dataclass
class ToolDecision:
    call: ToolCall
    decision: str                  # allow | capped | park | refuse
    reason: str = ""
    result: dict[str, Any] | None = None
    action_id: str | None = None
    requires: list[str] = field(default_factory=list)


async def run_calls(calls: list[ToolCall], phone_hash: str) -> list[ToolDecision]:
    decisions: list[ToolDecision] = []
    counts: dict[str, int] = {}

    for call in calls:
        rule = packs.active.tool_rule(call.name)
        decision = str(rule.get("decision", "refuse"))
        reason = str(rule.get("reason", ""))

        # With the gate switched off every proposed call simply happens. That is
        # the naked profile, and it is the whole of Scene 3's first half.
        if not packs.on("tool_gate"):
            result = await manager.call(call.name, call.arguments)
            decisions.append(ToolDecision(call=call, decision="allow",
                                          reason="tool gate switch off", result=result))
            bus.publish(Verdict(layer="tool_gate", decision="allow",
                                detail=f"{call.name} executed (switch off)",
                                pack=packs.active_name, profile=settings.profile,
                                phone_hash=phone_hash,
                                extra={"args": call.arguments}))
            continue

        # The server must be allowlisted and its tool list must match its pin.
        state = manager.server_for_tool(call.name)
        if state is None or not state.usable:
            why = ("no allowlisted server offers this tool" if state is None
                   else state.error or "tool list does not match its pin")
            decisions.append(ToolDecision(call=call, decision="refuse", reason=why))
            bus.publish(Verdict(layer="tool_gate", decision="refuse",
                                detail=f"{call.name} refused: {why}",
                                pack=packs.active_name, profile=settings.profile,
                                phone_hash=phone_hash))
            continue

        counts[call.name] = counts.get(call.name, 0) + 1
        cap = int((rule.get("cap") or {}).get("calls_per_message", 0) or 0)
        if cap and counts[call.name] > cap:
            decisions.append(ToolDecision(
                call=call, decision="capped",
                reason=f"{call.name} is capped at {cap} call(s) per message"))
            bus.publish(Verdict(layer="tool_gate", decision="capped",
                                detail=f"{call.name} over its cap of {cap}",
                                pack=packs.active_name, profile=settings.profile,
                                phone_hash=phone_hash))
            continue

        if decision == "refuse":
            decisions.append(ToolDecision(call=call, decision="refuse",
                                          reason=reason or "refused by the pack"))
            bus.publish(Verdict(layer="tool_gate", decision="refuse",
                                detail=f"{call.name} refused: {reason or 'pack policy'}",
                                pack=packs.active_name, profile=settings.profile,
                                phone_hash=phone_hash,
                                extra={"args": call.arguments}))
            continue

        if decision == "confirm":
            requires = list(rule.get("require", []))
            expires = int(rule.get("expires_minutes", 10))
            action_id = await park_action(call.name, call.arguments, phone_hash, expires)
            decisions.append(ToolDecision(
                call=call, decision="park",
                reason=reason or "parked for confirmation",
                action_id=action_id, requires=requires))
            bus.publish(Verdict(layer="tool_gate", decision="park",
                                detail=f"{call.name} parked, needs {', '.join(requires)}",
                                pack=packs.active_name, profile=settings.profile,
                                phone_hash=phone_hash,
                                extra={"action_id": action_id, "args": call.arguments,
                                       "expires_minutes": expires}))
            continue

        result = await manager.call(call.name, call.arguments)
        decisions.append(ToolDecision(call=call, decision="allow", result=result))
        bus.publish(Verdict(layer="tool_gate", decision="allow",
                            detail=f"{call.name} executed",
                            pack=packs.active_name, profile=settings.profile,
                            phone_hash=phone_hash, extra={"args": call.arguments}))

    return decisions


async def release(action_id: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Run a parked action once both confirmations are in."""
    result = await manager.call(tool, arguments)
    bus.publish(Verdict(layer="tool_gate", decision="allow",
                        detail=f"{tool} released after confirmation",
                        pack=packs.active_name, profile=settings.profile,
                        extra={"action_id": action_id, "args": arguments}))
    return result
