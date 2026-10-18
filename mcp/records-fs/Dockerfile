# Scene 3c fixture. Vulnerable by design: see server.py's module docstring.
# The container still confines what it CAN reach to /srv/records as a non-root
# user — that is layer 1 of the three layers underneath the server's own
# (broken) access control. Tetragon is layer 2; Cilium egress is layer 3.
#
# Two escape fixtures are pre-staged here rather than created live on stage:
#   - /srv/records-evil/      a sibling directory whose name merely STARTS WITH
#                              the allowed prefix as a string (CVE-2025-53110 shape)
#   - /srv/records/backdoor-link.txt
#                              a symlink inside the allowed directory pointing
#                              to the file above (CVE-2025-53109 shape)
# Both contain only invented, obviously-fake content.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

# mcp 2.x renamed FastMCP to MCPServer and changed other APIs — pin below v2
# to keep running the v1-style code this server is written against.
RUN pip install --no-cache-dir "mcp>=1.2,<2"

COPY server.py ./

RUN useradd -u 10004 -m records \
 && mkdir -p /srv/records /srv/records-evil \
 && printf 'KG-0001: invented demo record, nothing sensitive here.\n' \
      > /srv/records/member-KG-0001.txt \
 && printf 'FAKE DEMO SECRET — not a real credential. If you can read this via\nread_record, the server'"'"'s own path check has been fooled.\n' \
      > /srv/records-evil/secret.txt \
 && ln -s /srv/records-evil/secret.txt /srv/records/backdoor-link.txt \
 && chown -R records:records /srv/records /srv/records-evil

USER 10004
ENV ALLOWED_DIR=/srv/records

# No CMD that starts the server: Scene 3c pipes JSON-RPC into a fresh process
# over `kubectl exec -i`, matching a stdio MCP server's real invocation pattern.
