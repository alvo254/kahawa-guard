# ATTACKER NAMESPACE ONLY. Not for use outside the demo cluster.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

RUN pip install --no-cache-dir "mcp>=1.2"

COPY server.py ./

RUN useradd -u 10003 -m farmweather
USER 10003

EXPOSE 8000
CMD ["python", "server.py"]
