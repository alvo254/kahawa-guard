"""The gateway. The only thing in the cluster allowed to talk to the model, the
tools and the database — which is why every guard layer lives in here.

Request path, in order, each step behind a switch in the admin panel:

  1 identify      hash the phone number, load the session, check the budget
  2 input_guard   Mistral inline guardrails on the request          (L1)
  3 expert_guard  Shieldstral questions about the input             (L2)
  4 retrieve      pgvector search, with provenance
  5 model         chat call with tool schemas from pinned servers
  6 tool_gate     allow, cap, park or refuse each tool call         (L4)
  7 expert_guard  Shieldstral questions about the draft reply       (L2)
  8 registry      plain-code dealer, product and dose checks        (L3)
  9 audit         every verdict written to Postgres
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import db
from .config import settings
from .events import Verdict, bus
from .llm import provider
from .mcp.client import manager
from .packs.loader import SWITCHES, registry
from .pipeline import audit, expert_guard, identify, input_guard, model, registry as reg_check
from .pipeline import retrieve as retrieval
from .pipeline import tool_gate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("gateway")

REFUSAL = {
    "input_guard": "I cannot help with that request.",
    "expert_guard_in": "I cannot help with that request.",
    "budget": "You have reached today's limit for this service. Please try again tomorrow, "
              "or visit the cooperative office.",
    "model_unavailable": "I can't reach the assistant model right now. Please try again in "
                          "a moment.",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.startup()
    registry.load()
    try:
        await manager.refresh()
    except Exception as exc:                                # noqa: BLE001
        log.warning("initial MCP refresh failed: %s", exc)
    log.info("gateway up: profile=%s pack=%s provider=%s",
             settings.profile, registry.active_name, settings.llm_provider)
    yield
    await provider().aclose()
    await db.shutdown()


app = FastAPI(title="Kahawa Guard gateway", version="0.1.0", lifespan=lifespan)


# --- admin auth ------------------------------------------------------------

async def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Open in the naked profile, token-gated in the hardened one. The open
    version is not an oversight; it is the thing the demo shows being closed."""
    if not settings.admin_token_required:
        return
    if not settings.admin_token or x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="admin token required")


# --- models ----------------------------------------------------------------

class ChatRequest(BaseModel):
    phone: str = Field(..., examples=["+254700000002"])
    message: str
    grower_code: str | None = None


class ChatResponse(BaseModel):
    reply: str
    verdicts: list[dict[str, Any]]
    pending: list[dict[str, Any]] = []
    blocked_by: str | None = None


class LayersRequest(BaseModel):
    layers: dict[str, bool]


class PackRequest(BaseModel):
    pack: str


class ConfirmRequest(BaseModel):
    action_id: str
    member_pin: str | None = None
    officer_token: str | None = None


# --- the pipeline ----------------------------------------------------------

@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    collected: list[Verdict] = []
    mark = len(bus.recent)

    def harvest() -> list[dict[str, Any]]:
        new = bus.recent[mark:]
        collected.extend(v for v in new if v not in collected)
        return [audit.as_dict(v) for v in new]

    # 1 identify
    ident = await identify.identify(req.phone)
    await identify.count_message(ident.phone_hash)

    if registry.on("budgets") and ident.over_budget:
        bus.publish(Verdict(layer="budget", decision="refuse",
                            detail=f"{ident.tokens_used_today}/{ident.budget} tokens today",
                            pack=registry.active_name, profile=settings.profile,
                            phone_hash=ident.phone_hash))
        verdicts = harvest()
        await audit.record_all(collected)
        return ChatResponse(reply=REFUSAL["budget"], verdicts=verdicts, blocked_by="budget")

    # 2 input guard (L1)
    l1 = await input_guard.check_input(req.message, ident.phone_hash)
    if l1.blocked:
        verdicts = harvest()
        await audit.record_all(collected)
        return ChatResponse(reply=REFUSAL["input_guard"], verdicts=verdicts,
                            blocked_by="input_guard")

    # 3 expert guard on the input (L2)
    l2_in = await expert_guard.run(req.message, "input_questions", ident.phone_hash)
    if l2_in.blocked:
        verdicts = harvest()
        await audit.record_all(collected)
        return ChatResponse(reply=REFUSAL["expert_guard_in"], verdicts=verdicts,
                            blocked_by="expert_guard_in")

    # 4 retrieve, with provenance
    retrieved = await retrieval.retrieve(req.message, ident.phone_hash)

    # Re-check the pins before offering any tool to the model. This is where a
    # rug pull is caught: the server answered honestly last time.
    try:
        await manager.refresh()
    except Exception as exc:                                # noqa: BLE001
        log.warning("MCP refresh failed: %s", exc)

    # 5 model call, through 8 (registry retry also calls the model) — one
    # catch here for an unreachable provider, rather than three.
    try:
        result = await model.answer(req.message, retrieved, ident.phone_hash)

        # 6 tool gate (L4)
        decisions: list[tool_gate.ToolDecision] = []
        if result.tool_calls:
            decisions = await tool_gate.run_calls(result.tool_calls, ident.phone_hash)
            tool_messages: list[dict[str, Any]] = []
            for d in decisions:
                if d.decision == "allow" and d.result is not None:
                    payload = d.result.get("content", json.dumps(d.result))
                elif d.decision == "park":
                    payload = (f"NOT EXECUTED. This action is parked and needs "
                               f"{', '.join(d.requires)} before it can run. Tell the member "
                               f"how to confirm it; do not claim it is done.")
                else:
                    payload = f"NOT EXECUTED. {d.reason}"
                tool_messages.append({"role": "system",
                                      "content": f"Result of {d.call.name}: {payload}"})
            # Second pass so the reply reflects what actually happened, not what
            # the model hoped would happen.
            result = await model.answer(req.message, retrieved, ident.phone_hash,
                                        extra_messages=tool_messages, with_tools=False)

        reply = result.text or ""

        # 7 expert guard on the draft reply (L2)
        l2_out = await expert_guard.run(reply, "output_questions", ident.phone_hash)

        # 8 registry check (L3): one constrained retry, then the safe template
        checked = await reg_check.check_reply(reply, ident.phone_hash)
        if not checked.ok:
            retry = await model.retry_constrained(req.message, retrieved,
                                                  checked.problems, ident.phone_hash)
            reply = retry.text or ""
            second = await reg_check.check_reply(reply, ident.phone_hash)
            if not second.ok:
                reply = checked.safe_template or REFUSAL["input_guard"]
                bus.publish(Verdict(layer="registry", decision="refuse",
                                    detail="retry failed too; sent the safe template",
                                    pack=registry.active_name, profile=settings.profile,
                                    phone_hash=ident.phone_hash))
        elif l2_out.blocked:
            reply = checked.safe_template or REFUSAL["input_guard"]
    except model.ModelUnavailable:
        verdicts = harvest()
        await audit.record_all(collected)
        return ChatResponse(reply=REFUSAL["model_unavailable"], verdicts=verdicts,
                            blocked_by="model_unavailable")

    # Budget accounting
    used = int((result.usage or {}).get("total_tokens", 0) or 0)
    if used:
        await identify.count_tokens(ident.phone_hash, used)

    # 9 audit
    verdicts = harvest()
    await audit.record_all(collected)

    parked = [
        {"action_id": d.action_id, "tool": d.call.name, "requires": d.requires,
         "args": d.call.arguments}
        for d in decisions if d.decision == "park"
    ]
    blocked = "expert_guard_out" if l2_out.blocked else (None if checked.ok else "registry")
    return ChatResponse(reply=reply, verdicts=verdicts, pending=parked, blocked_by=blocked)


# --- verdict stream --------------------------------------------------------

@app.get("/api/events")
async def events():
    """Server-sent events for the admin panel."""
    async def stream():
        q = bus.subscribe()
        try:
            for v in bus.recent[-20:]:
                yield v.sse()
            while True:
                try:
                    v = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield v.sse()
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# --- uploads ---------------------------------------------------------------

def _extract_text(filename: str, raw: bytes) -> str:
    if filename.lower().endswith(".pdf"):
        try:
            import io

            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw))
            return "\n".join((page.extract_text() or "") for page in reader.pages)
        except Exception as exc:                            # noqa: BLE001
            log.warning("PDF text extraction failed for %s: %s", filename, exc)
            return ""
    return raw.decode("utf-8", errors="replace")


def _chunk(text: str, size: int = 700) -> list[str]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        if len(buf) + len(p) + 2 > size and buf:
            chunks.append(buf)
            buf = p
        else:
            buf = f"{buf}\n\n{p}" if buf else p
    if buf:
        chunks.append(buf)
    return chunks or [text[:size]]


@app.post("/api/upload")
async def upload(
    role: str = Form(...),
    title: str = Form(""),
    trust: str = Form(""),
    file: UploadFile | None = File(default=None),
    text: str = Form(""),
):
    """Upload a document as a given role. Used for the fake circular in Scene 2.

    The trust level is derived from the pack's provenance config, not from the
    uploader's claim about themselves: a dealer saying "this is a board circular"
    does not make it one.
    """
    raw = await file.read() if file is not None else text.encode()
    if not raw:
        raise HTTPException(status_code=400, detail="nothing to upload")

    name = (file.filename if file is not None else title) or "untitled"
    body = _extract_text(name, raw) if file is not None else text
    if not body.strip():
        raise HTTPException(status_code=400, detail="no text could be extracted")

    prov = registry.active.section("provenance")
    trusted_roles = set(prov.get("trusted_roles", []))
    resolved_trust = trust or ("trusted" if role in trusted_roles else "untrusted")

    sha = hashlib.sha256(raw).hexdigest()
    doc_id = await db.add_document(title or name, role, resolved_trust, sha)

    pieces = _chunk(body)
    vectors = await provider().embed(pieces)
    for piece, vector in zip(pieces, vectors, strict=False):
        await db.add_chunk(doc_id, piece, vector)

    bus.publish(Verdict(layer="upload", decision="info",
                        detail=f"{title or name} stored as {role}/{resolved_trust}, "
                               f"{len(pieces)} chunk(s)",
                        pack=registry.active_name, profile=settings.profile,
                        extra={"document_id": doc_id, "sha256": sha}))
    return {"document_id": doc_id, "title": title or name, "role": role,
            "trust": resolved_trust, "chunks": len(pieces), "sha256": sha}


# --- parked actions --------------------------------------------------------

@app.get("/api/pending")
async def pending():
    return {"pending": await db.pending_actions()}


@app.post("/api/confirm")
async def confirm(req: ConfirmRequest):
    """Member PIN or officer approval for a parked action.

    The PIN check here is a demo stand-in (any 4 digits). What matters on stage is
    that two different parties have to act before money moves, not the strength of
    this particular check.
    """
    is_member = bool(req.member_pin and req.member_pin.isdigit() and len(req.member_pin) == 4)
    is_officer = bool(req.officer_token)

    row = await db.confirm_action(req.action_id, member=is_member, officer=is_officer)
    if row is None:
        raise HTTPException(status_code=404, detail="no such parked action, or it expired")

    tool = str(row["tool"])
    rule = registry.active.tool_rule(tool)
    needed = set(rule.get("require", []))
    have = set()
    if row["member_confirmed"]:
        have |= {"member_pin", "guardian_pin"}
    if row["officer_approved"]:
        have.add("officer_approval")

    if not needed - have:
        args = row["args"] if isinstance(row["args"], dict) else json.loads(row["args"])
        result = await tool_gate.release(req.action_id, tool, args)
        await db.drop_action(req.action_id)
        return {"status": "released", "tool": tool, "result": result}

    bus.publish(Verdict(layer="tool_gate", decision="park",
                        detail=f"{tool} still needs {', '.join(sorted(needed - have))}",
                        pack=registry.active_name, profile=settings.profile,
                        phone_hash=str(row.get("phone_hash") or "")))
    return {"status": "waiting", "tool": tool,
            "still_needed": sorted(needed - have)}


# --- admin -----------------------------------------------------------------

@app.get("/api/admin/state")
async def admin_state():
    return {
        "profile": settings.profile,
        "pack": registry.active_name,
        "packs": sorted(registry.packs),
        "switches": registry.switches,
        "provider": settings.llm_provider,
        "shieldstral_mode": settings.shieldstral_mode,
        "embed_dim": settings.embed_dim,
        "admin_token_required": settings.admin_token_required,
        "servers": [
            {"name": s.name, "url": s.url, "tools": [t["name"] for t in s.tools],
             "pinned_ok": s.pinned_ok, "expected_pin": s.expected_pin,
             "actual_pin": s.actual_pin, "error": s.error}
            for s in manager.servers.values()
        ],
    }


@app.post("/api/admin/layers")
async def admin_layers(req: LayersRequest, _: None = Depends(require_admin)):
    unknown = sorted(set(req.layers) - set(SWITCHES))
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown layers: {unknown}")
    switches = registry.set_switches(req.layers)
    bus.publish(Verdict(layer="admin", decision="info",
                        detail="layers " + ", ".join(f"{k}={'on' if v else 'off'}"
                                                     for k, v in req.layers.items()),
                        pack=registry.active_name, profile=settings.profile))
    return {"switches": switches}


@app.post("/api/admin/pack")
async def admin_pack(req: PackRequest, _: None = Depends(require_admin)):
    try:
        pack = registry.set_active(req.pack)
    except KeyError:
        raise HTTPException(status_code=404,
                            detail=f"no such pack; have {sorted(registry.packs)}") from None
    await manager.refresh()
    bus.publish(Verdict(layer="admin", decision="info", detail=f"pack switched to {pack.name}",
                        pack=pack.name, profile=settings.profile))
    return {"pack": pack.name, "label": pack.data.get("label", "")}


@app.post("/api/admin/reset")
async def admin_reset(_: None = Depends(require_admin)):
    """Reset session state for a scene: budgets, parked actions, verdict feed."""
    await identify.reset_budgets()
    await db.execute("DELETE FROM pending_actions")
    bus.clear()
    bus.publish(Verdict(layer="admin", decision="info", detail="session state reset",
                        pack=registry.active_name, profile=settings.profile))
    return {"status": "reset"}


@app.post("/api/admin/mcp-refresh")
async def admin_mcp_refresh(_: None = Depends(require_admin)):
    states = await manager.refresh()
    return {"servers": {name: {"pinned_ok": s.pinned_ok, "actual_pin": s.actual_pin,
                               "tools": [t["name"] for t in s.tools], "error": s.error}
                        for name, s in states.items()}}


@app.get("/api/audit")
async def audit_tail(limit: int = 100):
    return {"events": await db.audit_tail(limit)}


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "profile": settings.profile, "pack": registry.active_name}
