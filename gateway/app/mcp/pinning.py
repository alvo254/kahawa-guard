"""Hash of a server's tool list.

When the gateway connects to a server it hashes the tool names, descriptions and
schemas and compares that with the hash in the pack. A mismatch blocks the server
until someone reviews it, which is what catches a rug pull: a server that
answered honestly on the first connection and changed its tool description on
the second.

The canonical form is fixed here so that scripts/mcp-pin.sh produces exactly the
same hash from the MCP Inspector CLI:

    jq -Sc '[.result.tools[] | {name, description, inputSchema}] | sort_by(.name)'

`jq -S` sorts object keys recursively and `-c` prints compact, which is what
json.dumps(..., sort_keys=True, separators=(",", ":")) produces. Keep the two in
step: if you change one, change the other, then re-run `make mcp-pin`.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable


def canonical(tools: Iterable[Any]) -> str:
    projection = []
    for tool in tools:
        if isinstance(tool, dict):
            name = tool.get("name")
            description = tool.get("description")
            schema = tool.get("inputSchema")
        else:
            name = getattr(tool, "name", None)
            description = getattr(tool, "description", None)
            schema = getattr(tool, "inputSchema", None)
        projection.append({
            "name": name,
            "description": description,
            "inputSchema": schema,
        })
    projection.sort(key=lambda t: (t["name"] or ""))
    return json.dumps(projection, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def pin(tools: Iterable[Any]) -> str:
    return hashlib.sha256(canonical(tools).encode("utf-8")).hexdigest()


def verify(tools: Iterable[Any], expected: str) -> tuple[bool, str]:
    """Returns (ok, actual). An empty expected pin means "not pinned yet": it is
    reported as unpinned rather than quietly treated as a pass."""
    actual = pin(tools)
    if not expected:
        return False, actual
    return actual == expected, actual
