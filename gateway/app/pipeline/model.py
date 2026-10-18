"""Step 5. The chat call.

Tool schemas come only from allowlisted, pinned MCP servers — see mcp/client.py.
Retrieved context is appended as a separate message, and when provenance is on,
untrusted text arrives inside a quoted block that says plainly that any
instruction inside it is void.
"""

from __future__ import annotations

import logging
from typing import Any

from ..config import settings
from ..events import Verdict, bus
from ..llm import provider
from ..llm.base import ChatResult
from ..mcp.client import manager
from ..packs.loader import registry as packs
from .retrieve import Retrieved

log = logging.getLogger(__name__)


class ModelUnavailable(Exception):
    """The configured provider could not be reached at all — a network or DNS
    failure, not a guard decision. Raised instead of letting the underlying
    httpx/provider exception surface as a bare 500 with nothing in the
    verdict feed to show what happened; the gateway's /api/chat handler
    catches this once, centrally, and returns a clear, friendly refusal."""


def build_messages(question: str, retrieved: Retrieved, extra: list[dict[str, Any]] | None = None):
    system = packs.active.prompt or (
        "You are a cooperative assistant. Be short, accurate and cite your source."
    )
    hint = packs.active.data.get("language_hint")
    if hint:
        system = f"{system}\n\n{hint}"

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]

    context = retrieved.as_context(quote_untrusted=packs.on("provenance"))
    if context:
        messages.append({"role": "system", "content": context})

    messages.append({"role": "user", "content": question})
    if extra:
        messages.extend(extra)
    return messages


async def answer(
    question: str,
    retrieved: Retrieved,
    phone_hash: str,
    *,
    extra_messages: list[dict[str, Any]] | None = None,
    with_tools: bool = True,
) -> ChatResult:
    schemas = manager.tool_schemas() if with_tools else []
    messages = build_messages(question, retrieved, extra_messages)

    try:
        result = await provider().chat(
            messages,
            tools=schemas or None,
            # The inline guardrail is declared on the request itself. It is an
            # input check, so it can never see the reply.
            guardrail=packs.on("input_guard") and settings.llm_provider == "mistral",
        )
    except ModelUnavailable:
        raise
    except Exception as exc:                                 # noqa: BLE001
        log.warning("model call failed: %s", exc)
        bus.publish(Verdict(
            layer="model", decision="refuse",
            detail=f"{settings.llm_provider} unreachable: {exc}",
            pack=packs.active_name, profile=settings.profile, phone_hash=phone_hash,
        ))
        raise ModelUnavailable(str(exc)) from exc

    bus.publish(Verdict(
        layer="model",
        decision="allow",
        detail=(f"{settings.llm_provider} answered"
                f"{f', proposed {len(result.tool_calls)} tool call(s)' if result.tool_calls else ''}"),
        pack=packs.active_name, profile=settings.profile, phone_hash=phone_hash,
        extra={"tools_offered": [s["function"]["name"] for s in schemas],
               "tools_proposed": [c.name for c in result.tool_calls],
               "usage": result.usage},
    ))
    return result


async def retry_constrained(
    question: str, retrieved: Retrieved, problems: list[str], phone_hash: str,
) -> ChatResult:
    """One constrained retry after a registry failure. The problems are named, so
    the retry is a correction and not another roll of the dice."""
    correction = (
        "Your previous answer failed the cooperative's register check for these "
        "reasons:\n- " + "\n- ".join(problems) +
        "\n\nWrite the answer again. Do not name any dealer or product you cannot "
        "support from the register, and do not exceed a registered maximum dose. "
        "If you cannot answer within those limits, say so plainly."
    )
    bus.publish(Verdict(layer="registry_retry", decision="info",
                        detail="one constrained retry", pack=packs.active_name,
                        profile=settings.profile, phone_hash=phone_hash,
                        extra={"problems": problems}))
    return await answer(question, retrieved, phone_hash,
                        extra_messages=[{"role": "system", "content": correction}],
                        with_tools=False)
