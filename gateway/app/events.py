"""Server-sent event fan-out to the admin panel.

Every layer that reaches a verdict publishes it here, which is what makes the
pipeline visible on stage instead of being a black box.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class Verdict:
    layer: str                     # identify | input_guard | expert_guard | ...
    decision: str                  # allow | block | park | refuse | flag | info
    detail: str = ""
    score: float | None = None
    pack: str = ""
    profile: str = ""
    phone_hash: str = ""
    extra: dict[str, Any] = field(default_factory=dict)
    at: float = field(default_factory=time.time)
    seq: int = 0                   # monotonic id, set by the Broadcaster on publish

    def sse(self) -> str:
        return f"data: {json.dumps(asdict(self))}\n\n"


class Broadcaster:
    """One queue per connected admin panel. Slow readers lose old events rather
    than holding up the pipeline — a dropped verdict line is better than a
    stalled answer in front of a room."""

    def __init__(self, maxsize: int = 256) -> None:
        self._subscribers: set[asyncio.Queue[Verdict]] = set()
        self._maxsize = maxsize
        self._recent: list[Verdict] = []
        self._seq = 0

    @property
    def seq(self) -> int:
        """The next sequence number. Snapshot it before a request, then harvest
        every verdict whose seq is >= that snapshot — robust to the ring buffer
        trimming, unlike an absolute index into `recent`."""
        return self._seq

    def subscribe(self) -> asyncio.Queue[Verdict]:
        q: asyncio.Queue[Verdict] = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[Verdict]) -> None:
        self._subscribers.discard(q)

    def publish(self, v: Verdict) -> None:
        v.seq = self._seq
        self._seq += 1
        self._recent.append(v)
        del self._recent[:-200]
        for q in list(self._subscribers):
            try:
                q.put_nowait(v)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(v)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    @property
    def recent(self) -> list[Verdict]:
        return list(self._recent)

    def clear(self) -> None:
        self._recent.clear()


bus = Broadcaster()
