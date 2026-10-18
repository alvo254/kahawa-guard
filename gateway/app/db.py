"""Postgres and Redis access. Raw SQL on purpose: the registry checks in this
file are the ones that must not depend on a model's judgement."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import redis.asyncio as aioredis
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import settings

_pool: AsyncConnectionPool | None = None
_redis: aioredis.Redis | None = None


async def startup() -> None:
    global _pool, _redis
    _pool = AsyncConnectionPool(settings.database_url, min_size=1, max_size=8, open=False)
    await _pool.open()
    _redis = aioredis.from_url(settings.redis_url, decode_responses=True)


async def shutdown() -> None:
    if _pool is not None:
        await _pool.close()
    if _redis is not None:
        await _redis.aclose()


def redis() -> aioredis.Redis:
    if _redis is None:
        raise RuntimeError("redis not initialised")
    return _redis


async def fetch(sql: str, *args: Any) -> list[dict]:
    if _pool is None:
        raise RuntimeError("database not initialised")
    async with _pool.connection() as conn:
        conn.row_factory = dict_row
        cur = await conn.execute(sql, args)
        return await cur.fetchall()


async def fetch_one(sql: str, *args: Any) -> dict | None:
    rows = await fetch(sql, *args)
    return rows[0] if rows else None


async def execute(sql: str, *args: Any) -> None:
    if _pool is None:
        raise RuntimeError("database not initialised")
    async with _pool.connection() as conn:
        await conn.execute(sql, args)


# --- registry lookups (L3). Plain code, no model. ---------------------------

async def dealer(licence_no: str) -> dict | None:
    return await fetch_one(
        "SELECT licence_no, name, status, valid_until FROM dealers WHERE licence_no = %s",
        licence_no,
    )


async def dealer_by_name(name: str) -> dict | None:
    return await fetch_one(
        "SELECT licence_no, name, status, valid_until FROM dealers "
        "WHERE lower(name) = lower(%s)",
        name,
    )


async def dealers_all() -> list[dict]:
    return await fetch("SELECT licence_no, name, status, valid_until FROM dealers ORDER BY name")


async def products_all() -> list[dict]:
    return await fetch(
        "SELECT name, registered, max_dose_ml_per_20l, notes FROM products ORDER BY name"
    )


async def member(grower_code: str) -> dict | None:
    return await fetch_one(
        "SELECT id, grower_code, phone_hash, coop_id, payout_account_ref "
        "FROM members WHERE grower_code = %s",
        grower_code,
    )


async def payment_status(grower_code: str) -> dict | None:
    return await fetch_one(
        "SELECT p.season, p.kilos, p.amount_kes, p.status, p.paid_at "
        "FROM payments p JOIN members m ON m.id = p.member_id "
        "WHERE m.grower_code = %s ORDER BY p.id DESC LIMIT 1",
        grower_code,
    )


# --- retrieval (pgvector, with provenance) ---------------------------------

async def search_chunks(embedding: list[float], limit: int = 6) -> list[dict]:
    """Nearest chunks, each carrying the source document's role and trust level.
    The trust column is the whole point: it decides whether the text is quoted as
    data or allowed anywhere near the instructions."""
    vec = "[" + ",".join(f"{x:.6f}" for x in embedding) + "]"
    return await fetch(
        "SELECT c.id, c.content, d.title, d.uploader_role, d.trust, "
        "       (c.embedding <=> %s::vector) AS distance "
        "FROM chunks c JOIN documents d ON d.id = c.document_id "
        "ORDER BY c.embedding <=> %s::vector LIMIT %s",
        vec, vec, limit,
    )


async def add_document(title: str, uploader_role: str, trust: str, sha256: str) -> int:
    row = await fetch_one(
        "INSERT INTO documents (title, uploader_role, trust, sha256) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        title, uploader_role, trust, sha256,
    )
    assert row is not None
    return int(row["id"])


async def add_chunk(document_id: int, content: str, embedding: list[float]) -> None:
    vec = "[" + ",".join(f"{x:.6f}" for x in embedding) + "]"
    await execute(
        "INSERT INTO chunks (document_id, content, embedding) VALUES (%s, %s, %s::vector)",
        document_id, content, vec,
    )


# --- plots (PostGIS) -------------------------------------------------------

async def check_plot(grower_code: str) -> dict:
    """Does this member's plot sit inside the 2020 forest fixture, or overlap
    another member's plot? Both are geometry questions, answered by the database,
    not by the model."""
    forest = await fetch(
        "SELECT ST_Area(ST_Intersection(p.geom, f.geom)::geography) AS overlap_m2 "
        "FROM plots p JOIN members m ON m.id = p.member_id, forest_2020 f "
        "WHERE m.grower_code = %s AND ST_Intersects(p.geom, f.geom)",
        grower_code,
    )
    dupes = await fetch(
        "SELECT m2.grower_code, ST_Area(ST_Intersection(p1.geom, p2.geom)::geography) AS overlap_m2 "
        "FROM plots p1 JOIN members m1 ON m1.id = p1.member_id "
        "JOIN plots p2 ON p2.id <> p1.id JOIN members m2 ON m2.id = p2.member_id "
        "WHERE m1.grower_code = %s AND ST_Intersects(p1.geom, p2.geom)",
        grower_code,
    )
    meta = await fetch_one(
        "SELECT p.gps_accuracy_m, p.mock_location FROM plots p "
        "JOIN members m ON m.id = p.member_id WHERE m.grower_code = %s LIMIT 1",
        grower_code,
    ) or {}
    return {
        "grower_code": grower_code,
        "forest_overlap_m2": round(sum(float(r["overlap_m2"] or 0) for r in forest), 1),
        "overlaps_members": [
            {"grower_code": r["grower_code"], "overlap_m2": round(float(r["overlap_m2"] or 0), 1)}
            for r in dupes
        ],
        "gps_accuracy_m": meta.get("gps_accuracy_m"),
        "mock_location": meta.get("mock_location"),
    }


# --- parked actions (L4) ---------------------------------------------------

async def park_action(tool: str, args: dict, phone_hash: str, expires_minutes: int) -> str:
    action_id = str(uuid.uuid4())
    expires = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    await execute(
        "INSERT INTO pending_actions (id, tool, args, phone_hash, expires_at) "
        "VALUES (%s, %s, %s, %s, %s)",
        action_id, tool, json.dumps(args), phone_hash, expires,
    )
    return action_id


async def pending_actions() -> list[dict]:
    return await fetch(
        "SELECT id::text, tool, args, phone_hash, member_confirmed, officer_approved, "
        "       created_at, expires_at "
        "FROM pending_actions WHERE expires_at > now() ORDER BY created_at DESC"
    )


async def confirm_action(action_id: str, *, member: bool = False, officer: bool = False) -> dict | None:
    sets = []
    if member:
        sets.append("member_confirmed = TRUE")
    if officer:
        sets.append("officer_approved = TRUE")
    if not sets:
        return None
    await execute(
        f"UPDATE pending_actions SET {', '.join(sets)} WHERE id = %s::uuid AND expires_at > now()",
        action_id,
    )
    return await fetch_one(
        "SELECT id::text, tool, args, phone_hash, member_confirmed, officer_approved "
        "FROM pending_actions WHERE id = %s::uuid",
        action_id,
    )


async def drop_action(action_id: str) -> None:
    await execute("DELETE FROM pending_actions WHERE id = %s::uuid", action_id)


# --- audit -----------------------------------------------------------------

async def audit(
    *, profile: str, pack: str, phone_hash: str, layer: str,
    decision: str, score: float | None, detail: dict,
) -> None:
    await execute(
        "INSERT INTO audit_events (profile, pack, phone_hash, layer, decision, score, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        profile, pack, phone_hash, layer, decision, score, json.dumps(detail),
    )


async def audit_tail(limit: int = 100) -> list[dict]:
    return await fetch(
        "SELECT at, profile, pack, phone_hash, layer, decision, score, detail "
        "FROM audit_events ORDER BY id DESC LIMIT %s",
        limit,
    )
