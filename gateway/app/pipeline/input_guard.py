"""Step 2 (L1). Mistral's inline guardrail on the request.

It is an input-only check and an API feature. With a local model there is no L1
here at all, so the expert guard carries both — see llm/ollama.py.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from ..config import settings
from ..events import Verdict, bus
from ..llm import provider
from ..packs.loader import registry

log = logging.getLogger(__name__)

# Blocked when any of these categories scores above the threshold.
BLOCK_CATEGORIES = ("prompt_injection", "jailbreak", "pii", "selfharm", "violence")
THRESHOLD = 0.5


@dataclass
class GuardOutcome:
    blocked: bool
    score: float | None
    detail: str
    categories: dict[str, float]


def _worst(categories: dict[str, Any]) -> tuple[str, float]:
    worst_name, worst_score = "", 0.0
    for name, score in (categories or {}).items():
        try:
            value = float(score)
        except (TypeError, ValueError):
            continue
        if value > worst_score:
            worst_name, worst_score = name, value
    return worst_name, worst_score


async def check_input(text: str, phone_hash: str) -> GuardOutcome:
    """Run the standalone moderation endpoint. The inline variant is also
    declared on the chat call itself in pipeline/model.py; this one gives the
    admin panel a score to show before the model is ever reached."""
    if not registry.on("input_guard"):
        bus.publish(Verdict(layer="input_guard", decision="info", detail="switch off",
                            pack=registry.active_name, profile=settings.profile,
                            phone_hash=phone_hash))
        return GuardOutcome(False, None, "switch off", {})

    p = provider()
    if not hasattr(p, "moderate"):
        # Local provider: nothing to call. Say so rather than pretending to pass.
        bus.publish(Verdict(
            layer="input_guard", decision="info",
            detail="no inline guardrail on a local model; the expert guard covers the input",
            pack=registry.active_name, profile=settings.profile, phone_hash=phone_hash))
        return GuardOutcome(False, None, "unavailable on local provider", {})

    try:
        body = await p.moderate(text)                      # type: ignore[attr-defined]
    except Exception as exc:                               # noqa: BLE001 — never fail the room
        log.warning("input guard call failed: %s", exc)
        bus.publish(Verdict(layer="input_guard", decision="info",
                            detail=f"guardrail unavailable: {exc}",
                            pack=registry.active_name, profile=settings.profile,
                            phone_hash=phone_hash))
        return GuardOutcome(False, None, "unavailable", {})

    results = body.get("results") or []
    categories = (results[0].get("category_scores") if results else {}) or {}
    name, score = _worst({k: v for k, v in categories.items()
                          if any(k.startswith(c) for c in BLOCK_CATEGORIES)} or categories)
    blocked = score >= THRESHOLD

    bus.publish(Verdict(
        layer="input_guard",
        decision="block" if blocked else "allow",
        detail=f"{name or 'no category'} {score:.2f}",
        score=score,
        pack=registry.active_name, profile=settings.profile, phone_hash=phone_hash,
        extra={"categories": categories},
    ))
    return GuardOutcome(blocked, score, name or "clean", categories)
