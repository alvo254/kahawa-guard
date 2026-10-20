"""Settings from the environment and, in the hardened profile, from mounted files.

Naked puts secrets straight into the environment. Hardened mounts them as files
from Vault via External Secrets, so a process that reads the environment of
another process learns nothing.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _from_secrets_dir(name: str) -> str | None:
    """Read a secret from SECRETS_DIR/<name>, which is how the hardened profile
    delivers it. Returns None when there is no such file."""
    d = os.environ.get("SECRETS_DIR")
    if not d:
        return None
    p = Path(d) / name
    try:
        return p.read_text().strip() or None
    except OSError:
        return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    profile: str = "naked"
    pack: str = "coffee"
    packs_dir: Path = Path("/etc/kahawa/packs")

    # --- model provider ---
    llm_provider: str = "mistral"          # mistral | ollama
    mistral_api_key: str = ""
    mistral_chat_model: str = "ministral-8b-2512"
    mistral_embed_model: str = "mistral-embed"
    # Caps the reply; without it a small model can run long enough to hit the 60s timeout.
    mistral_max_tokens: int = 800
    mistral_base_url: str = "https://api.mistral.ai"
    guardrail_model: str = "moderation_llm_v2"          # inline guardrails key on chat
    moderation_model: str = "mistral-moderation-latest" # standalone /v1/moderations

    ollama_base_url: str = "http://172.18.0.1:11434/v1"
    ollama_chat_model: str = "mistral-small3.2"
    ollama_embed_model: str = "nomic-embed-text"

    # Must match the vector(n) column in the database.
    embed_dim: int = 1024

    # Tool rounds per message. Each round the model sees the results so far and
    # may call again; the last round offers no tools, so the reply is about what
    # actually happened. 1 means a single proposal, as before.
    max_tool_rounds: int = 3

    # --- expert guard ---
    shieldstral_url: str = ""
    shieldstral_api_key: str = ""
    shieldstral_mode: str = "cached"       # live | cached

    # --- data ---
    database_url: str = "postgresql://kahawa:kahawa@localhost:5432/kahawa"
    redis_url: str = "redis://localhost:6379/0"

    # --- mcp ---
    mcp_servers: str = "[]"                # JSON list of {name, url, pin}
    n8n_mcp_token: str = ""

    # --- admin ---
    admin_token: str = ""
    admin_token_required: bool = False
    guard_defaults: str = "{}"             # JSON object of switch -> bool

    phone_salt: str = Field(default="kahawa-demo-salt", description="Hashing salt for phone numbers")

    def model_post_init(self, _ctx) -> None:
        # Mounted files win over the environment: in the hardened profile the
        # environment is deliberately empty of secrets.
        for field, filename in (
            ("mistral_api_key", "MISTRAL_API_KEY"),
            ("shieldstral_api_key", "SHIELDSTRAL_API_KEY"),
            ("n8n_mcp_token", "N8N_MCP_TOKEN"),
            ("admin_token", "ADMIN_TOKEN"),
        ):
            value = _from_secrets_dir(filename)
            if value:
                object.__setattr__(self, field, value)

    # --- derived ---
    @property
    def servers(self) -> list[dict]:
        try:
            return json.loads(self.mcp_servers) or []
        except json.JSONDecodeError:
            return []

    @property
    def guard_switch_defaults(self) -> dict[str, bool]:
        try:
            raw = json.loads(self.guard_defaults) or {}
        except json.JSONDecodeError:
            return {}
        return {k: bool(v) for k, v in raw.items()}

    @property
    def hardened(self) -> bool:
        return self.profile == "hardened"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
