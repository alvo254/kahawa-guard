FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
# mcp 2.x renamed FastMCP to MCPServer and changed other APIs — pin below v2.
# The gateway's own MCP client code (app/mcp/client.py) imports lazily inside
# a function, and the one caller (manager.refresh() at startup) swallows
# failures into a logged warning rather than crashing — so a mismatched mcp
# version here would NOT show up as a crash-looping pod, just a silently
# non-functional tool layer. Keep this pin in lockstep with the one in
# mcp/*/Dockerfile.
RUN pip install --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.32" "httpx>=0.27" "pydantic>=2.9" \
      "pydantic-settings>=2.6" "psycopg[binary,pool]>=3.2" "redis>=5.2" \
      "pyyaml>=6.0" "mcp>=1.2,<2" "pypdf>=5.1" "python-multipart>=0.0.17"

COPY app ./app

# Runs as non-root in both profiles. The difference between naked and hardened is
# everything around the container, not this line.
RUN useradd -u 10001 -m kahawa
USER 10001

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
