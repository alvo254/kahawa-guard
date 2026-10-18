"""A local Mistral model through Ollama's OpenAI-compatible endpoint.

Going local changes two things worth saying out loud in the room:

1. There is no inline guardrail. It is an API feature. The input check has to be
   pointed at Shieldstral too, so L1 and L2 both run on your own infrastructure.
   Going local means you own every guard.
2. Ollama's API has no authentication by default. Bind it to the kind network
   gateway address only (OLLAMA_HOST=172.18.0.1:11434), never 0.0.0.0, and let
   the Cilium rule in providers/ollama.yaml be the only path to it.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from ..config import settings
from .base import ChatResult, ToolCall

log = logging.getLogger(__name__)


class OllamaProvider:
    name = "ollama"

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.ollama_base_url.rstrip("/"),
            headers={"Authorization": "Bearer unused"},   # Ollama ignores the key
            timeout=httpx.Timeout(300.0, connect=10.0),   # a 24B model on a laptop is slow
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        *,
        guardrail: bool = False,
    ) -> ChatResult:
        if guardrail:
            log.debug("no inline guardrail on a local model; L1 runs on Shieldstral instead")
        payload: dict[str, Any] = {
            "model": settings.ollama_chat_model,
            "messages": messages,
        }
        if tools:
            payload["tools"] = tools

        resp = await self._client.post("/chat/completions", json=payload)
        resp.raise_for_status()
        body = resp.json()
        message = ((body.get("choices") or [{}])[0]).get("message") or {}

        calls: list[ToolCall] = []
        for tc in message.get("tool_calls") or []:
            fn = tc.get("function") or {}
            raw_args = fn.get("arguments")
            if isinstance(raw_args, dict):
                args = raw_args
            else:
                try:
                    args = json.loads(raw_args or "{}")
                except json.JSONDecodeError:
                    args = {"_unparsed": raw_args}
            calls.append(ToolCall(id=tc.get("id", ""), name=fn.get("name", ""), arguments=args))

        return ChatResult(
            text=message.get("content") or "",
            tool_calls=calls,
            usage=body.get("usage") or {},
            guardrail=None,
            raw=body,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        resp = await self._client.post(
            "/embeddings",
            json={"model": settings.ollama_embed_model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        return [row["embedding"] for row in data]
