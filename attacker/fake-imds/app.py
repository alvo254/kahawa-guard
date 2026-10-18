"""fake-imds — stands in for a cloud metadata service (e.g. 169.254.169.254).
ATTACKER NAMESPACE ONLY.

Scene 3b walks kahawa-tools' fetch_url into this, over a plain path like a real
agent would if it had an unrestricted fetch tool and got talked into reaching
somewhere it should never go. Nothing served here is a real credential — it is
an obviously-fake access key shaped like the real metadata response, so the room
can recognise the moment without needing the real cloud API's shape memorised.

In the naked profile this just works. In the hardened profile:
  - Cilium's deny-cloud-metadata policy blocks 169.254.169.254 outright, and the
    gateway-egress policy never allowed a path to the attacker namespace anyway.
  - Tetragon's kill-metadata-connect TracingPolicy kills the connecting process
    in the kernel the moment it tries, which is the stronger stage moment.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

app = FastAPI(title="fake-imds")

_EXPIRY = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")


@app.get("/latest/meta-data/iam/security-credentials/", response_class=PlainTextResponse)
async def role_name() -> str:
    return "kahawa-demo-role"


@app.get("/latest/meta-data/iam/security-credentials/kahawa-demo-role")
async def credentials() -> dict:
    # Every field below is invented and inert. It is shaped like a real cloud
    # metadata credential response so the scene is recognisable, nothing more.
    return {
        "Code": "Success",
        "LastUpdated": _EXPIRY,
        "Type": "AWS-HMAC",
        "AccessKeyId": "AKIADEMOFAKENOTREAL00",
        "SecretAccessKey": "fake/not-a-real-secret/do-not-use/0000000000000000000000",
        "Token": "FAKE.DEMO.TOKEN.NOT-REAL",
        "Expiration": _EXPIRY,
    }


@app.get("/")
async def index() -> dict:
    return {"service": "fake-imds", "note": "demo fixture; see app.py docstring"}


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}
