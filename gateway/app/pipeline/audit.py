"""Step 9. Every verdict, score and tool decision written to Postgres, keyed by
the hashed phone number.

The audit table is the part that outlives the demo: it is how you answer "what
did the assistant do, and why" a week later.
"""

from __future__ import annotations

import logging
from dataclasses import asdict

from ..config import settings
from ..db import audit as write_audit
from ..events import Verdict
from ..packs.loader import registry as packs

log = logging.getLogger(__name__)


async def record(verdict: Verdict) -> None:
    try:
        await write_audit(
            profile=verdict.profile or settings.profile,
            pack=verdict.pack or packs.active_name,
            phone_hash=verdict.phone_hash,
            layer=verdict.layer,
            decision=verdict.decision,
            score=verdict.score,
            detail={"detail": verdict.detail, **verdict.extra},
        )
    except Exception as exc:                                # noqa: BLE001
        # An audit write must never be the thing that breaks the answer on stage,
        # but it must be loud in the log when it fails.
        log.error("audit write failed for %s/%s: %s", verdict.layer, verdict.decision, exc)


async def record_all(verdicts: list[Verdict]) -> None:
    for verdict in verdicts:
        await record(verdict)


def as_dict(verdict: Verdict) -> dict:
    return asdict(verdict)
