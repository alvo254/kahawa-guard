FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

RUN pip install --no-cache-dir "mcp>=1.2" "psycopg[binary]>=3.2" "httpx>=0.27"

COPY server.py ./

RUN useradd -u 10002 -m tools
USER 10002

EXPOSE 8000
CMD ["python", "server.py"]
