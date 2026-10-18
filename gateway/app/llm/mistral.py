"""Mistral La Plateforme: chat with tool calling, embeddings, and the inline
guardrail.

The guardrail is declared on the request itself and only ever sees the input, so
L1 cannot catch anything in the reply — that is what the expert guard is for.
The field shape below is deliberately isolated in one place: confirm it against
the current Mistral docs before the session, because this is the part most likely
to have moved.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from ..config import settings
from .base import ChatResult, ToolCall

log = logging.getLogger(__name__)


class MistralProvider:
    name = "mistral"

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.mistral_base_url,
            headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
            timeout=httpx.Timeout(60.0, connect=10.0),
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
        payload: dict[str, Any] = {
            "model": settings.mistral_chat_model,
            "messages": messages,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if guardrail:
            # Shape only — confirm the current field name in the Mistral docs.
            payload["guardrails"] = [{"type": settings.guardrail_model}]

        resp = await self._client.post("/v1/chat/completions", json=payload)
        resp.raise_for_status()
        body = resp.json()
        choice = (body.get("choices") or [{}])[0]
        message = choice.get("message") or {}

        calls: list[ToolCall] = []
        for tc in message.get("tool_calls") or []:
            fn = tc.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {"_unparsed": fn.get("arguments")}
            calls.append(ToolCall(id=tc.get("id", ""), name=fn.get("name", ""), arguments=args))

        return ChatResult(
            text=message.get("content") or "",
            tool_calls=calls,
            usage=body.get("usage") or {},
            guardrail=body.get("guardrails") or choice.get("guardrails"),
            raw=body,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        resp = await self._client.post(
            "/v1/embeddings",
            json={"model": settings.mistral_embed_model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        return [row["embedding"] for row in data]

    async def moderate(self, text: str) -> dict[str, Any]:
        """Standalone moderation call, used when the inline guardrail is not
        available on an endpoint. Returns the raw category scores."""
        resp = await self._client.post(
            "/v1/moderations",
            json={"model": settings.guardrail_model, "input": [text]},
        )
        resp.raise_for_status()
        return resp.json()
