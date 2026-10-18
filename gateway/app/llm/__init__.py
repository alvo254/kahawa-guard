"""Provider selection. One setting, LLM_PROVIDER, decides which client the whole
pipeline uses for chat and embeddings."""

from __future__ import annotations

from functools import lru_cache

from ..config import settings
from .base import ChatProvider, ChatResult, ToolCall  # noqa: F401  (re-exported)


@lru_cache
def provider() -> "ChatProvider":
    if settings.llm_provider == "ollama":
        from .ollama import OllamaProvider

        return OllamaProvider()
    from .mistral import MistralProvider

    return MistralProvider()
