"""Steps 3 and 7 (L2). Shieldstral asks the pack's questions about the input and
then about the draft reply.

The score is the probability the model puts on "yes" versus "no" for each
question, read from the token log probabilities that vLLM returns. That is why
Shieldstral stays on vLLM rather than moving to Ollama: not every model there
returns log probabilities.

SHIELDSTRAL_MODE=cached replays scores for the scripted prompts, so a scene still
works when the GPU machine is unreachable. Cached scores are labelled as cached
in the admin panel — never pass a replay off as a live judgement.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from ..events import Verdict, bus
from ..packs.loader import registry

log = logging.getLogger(__name__)

CACHE_PATH = Path(__file__).with_name("shieldstral_cache.json")

PROMPT = """You are a security reviewer. Answer the question about the text with a single word, yes or no.

Text:
\"\"\"{text}\"\"\"

Question: {question}
Answer (yes or no):"""


@dataclass
class QuestionScore:
    id: str
    question: str
    score: float
    threshold: float
    cached: bool = False

    @property
    def tripped(self) -> bool:
        return self.score >= self.threshold


@dataclass
class ExpertOutcome:
    blocked: bool
    scores: list[QuestionScore] = field(default_factory=list)
    unavailable: bool = False

    @property
    def worst(self) -> QuestionScore | None:
        return max(self.scores, key=lambda s: s.score) if self.scores else None


def _cache() -> dict[str, float]:
    try:
        return json.loads(CACHE_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _cache_key(text: str, question_id: str) -> str:
    return hashlib.sha256(f"{question_id}|{text.strip().lower()}".encode()).hexdigest()[:20]


async def _score_live(client: httpx.AsyncClient, text: str, question: str) -> float:
    """Ask once, with max_tokens=1, and read the yes/no probabilities from the
    returned log probabilities."""
    resp = await client.post(
        "/v1/completions",
        json={
            "model": "shieldstral",
            "prompt": PROMPT.format(text=text, question=question),
            "max_tokens": 1,
            "temperature": 0.0,
            "logprobs": 10,
        },
    )
    resp.raise_for_status()
    choice = (resp.json().get("choices") or [{}])[0]
    top = ((choice.get("logprobs") or {}).get("top_logprobs") or [{}])[0] or {}

    yes = no = 0.0
    for token, logprob in top.items():
        head = token.strip().lower()[:1]
        if head == "y":
            yes += math.exp(float(logprob))
        elif head == "n":
            no += math.exp(float(logprob))
    total = yes + no
    if total <= 0:
        # The model answered with neither. Treat it as unknown, not as safe.
        return 0.5
    return yes / total


async def run(text: str, which: str, phone_hash: str) -> ExpertOutcome:
    """which is 'input_questions' or 'output_questions'."""
    layer = "expert_guard_in" if which == "input_questions" else "expert_guard_out"
    if not registry.on("expert_guard"):
        bus.publish(Verdict(layer=layer, decision="info", detail="switch off",
                            pack=registry.active_name, profile=settings.profile,
                            phone_hash=phone_hash))
        return ExpertOutcome(blocked=False)

    questions = registry.active.section("expert_guard").get(which, []) or []
    if not questions:
        return ExpertOutcome(blocked=False)

    scores: list[QuestionScore] = []
    cached = _cache()
    client: httpx.AsyncClient | None = None
    unavailable = False

    if settings.shieldstral_mode == "live" and settings.shieldstral_url:
        headers = {}
        if settings.shieldstral_api_key:
            headers["Authorization"] = f"Bearer {settings.shieldstral_api_key}"
        client = httpx.AsyncClient(base_url=settings.shieldstral_url.rstrip("/"),
                                   headers=headers, timeout=30.0)

    try:
        for q in questions:
            qid = str(q.get("id"))
            question = str(q.get("question", ""))
            threshold = float(q.get("threshold", 0.5))
            score: float | None = None
            is_cached = False

            if client is not None:
                try:
                    score = await _score_live(client, text, question)
                except Exception as exc:                        # noqa: BLE001
                    log.warning("Shieldstral live call failed (%s); falling back to cache", exc)
                    unavailable = True

            if score is None:
                score = cached.get(_cache_key(text, qid))
                is_cached = score is not None
                if score is None:
                    continue    # nothing live, nothing cached: no claim either way

            scores.append(QuestionScore(id=qid, question=question, score=float(score),
                                        threshold=threshold, cached=is_cached))
    finally:
        if client is not None:
            await client.aclose()

    tripped = [s for s in scores if s.tripped]
    worst = max(scores, key=lambda s: s.score) if scores else None

    bus.publish(Verdict(
        layer=layer,
        decision="block" if tripped else "allow",
        detail=(f"{worst.id} {worst.score:.2f} (threshold {worst.threshold:.2f})"
                f"{' [cached]' if worst and worst.cached else ''}" if worst else "no scores"),
        score=worst.score if worst else None,
        pack=registry.active_name, profile=settings.profile, phone_hash=phone_hash,
        extra={"scores": [
            {"id": s.id, "score": round(s.score, 3), "threshold": s.threshold,
             "tripped": s.tripped, "cached": s.cached} for s in scores],
            "mode": settings.shieldstral_mode,
            "unavailable": unavailable},
    ))
    return ExpertOutcome(blocked=bool(tripped), scores=scores, unavailable=unavailable)
