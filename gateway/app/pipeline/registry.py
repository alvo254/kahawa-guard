"""Step 8 (L3). Plain code compares every dealer, product and dose in the reply
against the registers.

No model is involved in this decision. That is the point: a text generator cannot
be the thing that decides whether a licence is valid. On failure the pack asks
for one constrained retry, and if that still fails the gateway sends the safe
template instead.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from ..config import settings
from ..db import dealers_all, products_all
from ..events import Verdict, bus
from ..packs.loader import registry as packs

DOSE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:ml|mls|millilitres?)\b", re.IGNORECASE)


@dataclass
class RegistryOutcome:
    ok: bool
    problems: list[str] = field(default_factory=list)
    mentioned_dealers: list[str] = field(default_factory=list)
    mentioned_products: list[str] = field(default_factory=list)

    @property
    def safe_template(self) -> str:
        return str(packs.active.section("registry").get("safe_template", "")).strip()


async def check_reply(reply: str, phone_hash: str) -> RegistryOutcome:
    if not packs.on("registry"):
        bus.publish(Verdict(layer="registry", decision="info", detail="switch off",
                            pack=packs.active_name, profile=settings.profile,
                            phone_hash=phone_hash))
        return RegistryOutcome(ok=True)

    conf = packs.active.section("registry")
    problems: list[str] = []
    found_dealers: list[str] = []
    found_products: list[str] = []
    lowered = reply.lower()
    today = dt.date.today()

    # --- dealers mentioned by name or licence number ---
    if conf.get("dealers") or conf.get("facilities"):
        valid_status = {s.lower() for s in
                        (conf.get("dealers") or conf.get("facilities") or {}).get(
                            "valid_status", ["active"])}
        require_future = bool((conf.get("dealers") or conf.get("facilities") or {})
                              .get("require_future_valid_until", True))
        for row in await dealers_all():
            name = str(row["name"])
            licence = str(row["licence_no"])
            if name.lower() in lowered or licence.lower() in lowered:
                found_dealers.append(name)
                status = str(row["status"]).lower()
                if status not in valid_status:
                    problems.append(f"{name} ({licence}) is {status} on the register")
                elif require_future and row["valid_until"] and row["valid_until"] < today:
                    problems.append(f"{name} ({licence}) expired on {row['valid_until']}")

        # A trader named in the reply that is on no register at all is worse than
        # a suspended one: there is nothing to check it against.
        known = {str(r["name"]).lower() for r in await dealers_all()}
        for candidate in re.findall(r"\b([A-Z][A-Za-z&'.-]*(?:\s+[A-Z][A-Za-z&'.-]*){1,4})\b", reply):
            tail = candidate.lower()
            if any(word in tail for word in ("agrovet", "chemicals", "agro", "supplies",
                                             "inputs", "stockist", "store", "centre", "center")):
                if tail not in known:
                    problems.append(f"'{candidate}' appears nowhere on the dealer register")

    # --- products and doses ---
    if conf.get("products"):
        pconf = conf["products"]
        products = await products_all()
        for row in products:
            name = str(row["name"])
            if name.lower() in lowered:
                found_products.append(name)
                if pconf.get("require_registered", True) and not row["registered"]:
                    problems.append(f"{name} is not a registered product")
                if pconf.get("enforce_max_dose", True) and row["max_dose_ml_per_20l"]:
                    for match in DOSE_RE.finditer(reply):
                        dose = float(match.group(1))
                        if dose > float(row["max_dose_ml_per_20l"]):
                            problems.append(
                                f"{name}: {dose:g} ml exceeds the registered maximum of "
                                f"{float(row['max_dose_ml_per_20l']):g} ml per 20 l")
                            break

    ok = not problems
    bus.publish(Verdict(
        layer="registry",
        decision="allow" if ok else "block",
        detail="; ".join(problems) if problems else
               f"checked {len(found_dealers)} dealer(s), {len(found_products)} product(s)",
        pack=packs.active_name, profile=settings.profile, phone_hash=phone_hash,
        extra={"problems": problems, "dealers": found_dealers, "products": found_products},
    ))
    return RegistryOutcome(ok=ok, problems=problems,
                           mentioned_dealers=found_dealers, mentioned_products=found_products)
