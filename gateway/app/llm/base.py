"""The shape every chat provider implements, so swapping Mistral for a local
Ollama model touches one setting and nothing else in the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ChatResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)
    # Populated only by providers that run an inline guardrail (Mistral API).
    guardrail: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class ChatProvider(Protocol):
    name: str

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        *,
        guardrail: bool = False,
    ) -> ChatResult: ...

    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def aclose(self) -> None: ...
