"""Step 1. Hash the phone number, load the session, check the token budget.

The number is never stored in the clear: everything downstream, including the
audit table, works on the hash.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from ..config import settings
from ..db import redis
from ..events import Verdict, bus
from ..packs.loader import registry


@dataclass
class Identity:
    phone_hash: str
    tokens_used_today: int
    budget: int
    messages_this_hour: int
    message_cap: int

    @property
    def over_budget(self) -> bool:
        return self.tokens_used_today >= self.budget or self.messages_this_hour >= self.message_cap


def hash_phone(phone: str) -> str:
    digest = hashlib.sha256((settings.phone_salt + phone.strip()).encode()).hexdigest()
    return digest[:16]


async def identify(phone: str) -> Identity:
    phone_hash = hash_phone(phone)
    budgets = registry.active.section("budgets")
    budget = int(budgets.get("tokens_per_phone_per_day", 20000))
    cap = int(budgets.get("messages_per_phone_per_hour", 30))

    r = redis()
    tokens = int(await r.get(f"tokens:{phone_hash}") or 0)
    messages = int(await r.get(f"messages:{phone_hash}") or 0)

    ident = Identity(
        phone_hash=phone_hash,
        tokens_used_today=tokens,
        budget=budget,
        messages_this_hour=messages,
        message_cap=cap,
    )

    bus.publish(Verdict(
        layer="identify",
        decision="allow",
        detail=f"session {phone_hash}",
        pack=registry.active_name,
        profile=settings.profile,
        phone_hash=phone_hash,
        extra={"tokens_used": tokens, "budget": budget,
               "messages": messages, "message_cap": cap},
    ))
    return ident


async def count_message(phone_hash: str) -> None:
    r = redis()
    key = f"messages:{phone_hash}"
    await r.incr(key)
    await r.expire(key, 3600)


async def count_tokens(phone_hash: str, tokens: int) -> int:
    r = redis()
    key = f"tokens:{phone_hash}"
    total = int(await r.incrby(key, max(tokens, 0)))
    await r.expire(key, 86400)
    return total


async def reset_budgets() -> None:
    r = redis()
    async for key in r.scan_iter("tokens:*"):
        await r.delete(key)
    async for key in r.scan_iter("messages:*"):
        await r.delete(key)
