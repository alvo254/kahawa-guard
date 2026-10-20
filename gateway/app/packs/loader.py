"""Pack loading and the live guard switches.

Every pack in PACKS_DIR is loaded at startup and the active one is changed
through the admin API, not by editing the ConfigMap: a mounted ConfigMap update
can take a minute or more to reach a pod, which is far too slow on stage.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ..config import settings

log = logging.getLogger(__name__)

SWITCHES = ("input_guard", "expert_guard", "provenance", "registry", "tool_gate", "budgets")


@dataclass
class Pack:
    name: str
    data: dict[str, Any]
    prompt: str = ""

    def section(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default if default is not None else {})

    def tool_rule(self, tool: str) -> dict[str, Any]:
        policy = self.section("tools").get("policy", {})
        rule = policy.get(tool)
        if rule is None:
            return {"decision": self.section("tools").get("default", "refuse"),
                    "reason": f"{tool} is not in the {self.name} pack."}
        return rule

    @property
    def allowed_servers(self) -> list[str]:
        return list(self.section("tools").get("allowed_servers", []))

    @property
    def pins(self) -> dict[str, str]:
        return dict(self.section("pins") or {})


@dataclass
class Registry:
    packs: dict[str, Pack] = field(default_factory=dict)
    active_name: str = "coffee"
    # Guard switches, flipped live from the admin panel. Naked starts all off.
    switches: dict[str, bool] = field(default_factory=lambda: {s: False for s in SWITCHES})

    def load(self, directory: Path | None = None) -> None:
        directory = directory or settings.packs_dir
        if not directory.is_dir():
            log.warning("packs dir %s missing; running with an empty pack", directory)
            return
        for path in sorted(directory.glob("*.yaml")):
            try:
                data = yaml.safe_load(path.read_text()) or {}
            except yaml.YAMLError as exc:
                log.error("pack %s failed to parse: %s", path.name, exc)
                continue
            name = data.get("name") or path.stem
            prompt = ""
            prompt_file = data.get("prompt_file")
            # NAKED may run a plainer prompt: the one most teams ship, without
            # the rules that make the model refuse an injected instruction itself.
            if not settings.hardened and data.get("naked_prompt_file"):
                prompt_file = data["naked_prompt_file"]
            if prompt_file:
                candidate = directory / prompt_file
                if candidate.is_file():
                    prompt = candidate.read_text()
                else:
                    log.warning("pack %s names prompt_file %s, which is not mounted", name, prompt_file)
            self.packs[name] = Pack(name=name, data=data, prompt=prompt)
        if settings.pack in self.packs:
            self.active_name = settings.pack
        elif self.packs:
            self.active_name = next(iter(self.packs))
        self.switches.update(
            {k: v for k, v in settings.guard_switch_defaults.items() if k in SWITCHES}
        )
        log.info("loaded packs %s; active=%s switches=%s",
                 list(self.packs), self.active_name, self.switches)

    @property
    def active(self) -> Pack:
        return self.packs.get(self.active_name, Pack(name="empty", data={}))

    def set_active(self, name: str) -> Pack:
        if name not in self.packs:
            raise KeyError(name)
        self.active_name = name
        return self.active

    def set_switches(self, values: dict[str, bool]) -> dict[str, bool]:
        for key, value in values.items():
            if key in SWITCHES:
                self.switches[key] = bool(value)
        return dict(self.switches)

    def on(self, switch: str) -> bool:
        return bool(self.switches.get(switch, False))


registry = Registry()
