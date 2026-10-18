"""records-fs — a deliberately vulnerable-by-design MCP filesystem server, stdio
transport. ATTACKER-ADJACENT FIXTURE: used only in Scene 3c, inside the demo
cluster, to teach one lesson.

It is MEANT to confine every read to ALLOWED_DIR (/srv/records by default). Its
own containment logic reproduces the two real flaws collectively called
EscapeRoute, fixed upstream in the reference Filesystem MCP server (0.6.4 and
2025.7.01):

  - CVE-2025-53110: a path-PREFIX check instead of a real path check. A sibling
    directory that merely starts with the same string (e.g. /srv/records-evil)
    passes.
  - CVE-2025-53109: a symlink inside the allowed directory, pointing outside it,
    is followed without re-validating the real target.

The point of Scene 3c is not "this server has a bug, patch it". It is that an
access boundary a component enforces ON ITSELF is only as strong as that
component's code — so the real boundary lives underneath, in Tetragon's
confine-records-fs TracingPolicy, which judges the actual kernel-level file open
regardless of what path string this server validated. This server is expected to
be fooled; the kernel policy is what is expected to hold.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

ALLOWED_DIR = os.environ.get("ALLOWED_DIR", "/srv/records")

mcp = FastMCP("records-fs")


def _vulnerable_is_allowed(path: str) -> bool:
    """Reproduces EscapeRoute's containment logic on purpose: a STRING PREFIX
    check on the unresolved path, not a real containment check on the resolved
    one. This is what CVE-2025-53110 and CVE-2025-53109 broke."""
    # CVE-2025-53110 shape: prefix check against the raw path, so
    # "/srv/records-evil/x" passes a prefix test for "/srv/records".
    if path.startswith(ALLOWED_DIR):
        return True
    return False


@mcp.tool()
def list_records() -> dict:
    """List the member record files in the allowed records directory."""
    try:
        names = sorted(os.listdir(ALLOWED_DIR))
    except OSError as exc:
        return {"error": str(exc)}
    return {"directory": ALLOWED_DIR, "files": names}


@mcp.tool()
def read_record(path: str) -> dict:
    """Read a member record file. path must be inside the allowed records
    directory — or so this tool believes; see the module docstring."""
    # The vulnerable check: a string prefix on the path exactly as given,
    # without first resolving ".." segments or following symlinks to their
    # real target. This is the bug, left in on purpose.
    if not _vulnerable_is_allowed(path):
        return {"error": f"refused: {path} is outside {ALLOWED_DIR}"}
    try:
        # os.path.realpath here would fix CVE-2025-53109 (symlink escape) by
        # resolving the link before the containment check; it is omitted
        # deliberately so the symlink attack in Scene 3c actually works. The
        # read still goes through the symlink exactly as a real vulnerable
        # server would.
        data = Path(path).read_text(errors="replace")
    except OSError as exc:
        return {"error": str(exc)}
    return {"path": path, "content": data[:8000]}


if __name__ == "__main__":
    print(f"records-fs: serving {ALLOWED_DIR} over stdio "
          f"(vulnerable-by-design; Tetragon enforces the real boundary)",
          file=sys.stderr)
    mcp.run(transport="stdio")
