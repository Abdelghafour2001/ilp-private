"""A switched-off module answers like a module that was never built.

Hiding a navigation entry stops people stumbling into a feature; it does not
stop anyone reaching it. The URL is still there, the API still answers, and a
client who was told "the platform does not do challenges" can find the
challenge board by typing six characters. For a product sold module by module
that is not a cosmetic gap.

So the switchboard is enforced here, once, by URL prefix, rather than as a
dependency somebody has to remember on every new endpoint — the same reasoning
that put identity in middleware instead of in eighty-five signatures.

The answer is **404, not 403**: a module that is off does not exist for this
caller, and "forbidden" would confirm it exists and invite the next question.

Reads are cached for a few seconds. A feature flag changes a handful of times
a year and this runs on every request; a database round trip per call to ask a
question whose answer almost never changes is the kind of cost that only shows
up under load.
"""

from __future__ import annotations

import time

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.features import is_on
from app.db.session import SessionLocal
from app.models import Learner

# URL prefix -> the switch that governs it. Longest match wins, so a more
# specific path can be governed differently from its parent.
GUARDED: dict[str, str] = {
    "/api/labs": "labs",
    "/api/stacks": "stacks",
    "/api/challenges": "challenges",
    "/api/training-sessions": "sessions",
    "/api/assets": "assets",
    "/api/skills": "skills",
    "/api/skill-growth": "skills",
    "/api/leaderboard": "leaderboard",
    "/api/learners/leaderboard": "leaderboard",
    "/api/pathways": "pathways",
    "/api/certifications": "certifications",
    "/api/goals": "goals",
}

_CACHE: dict[tuple[str, int | None], tuple[bool, float]] = {}
_TTL_SECONDS = 15.0


def _feature_for(path: str) -> str | None:
    match = ""
    for prefix in GUARDED:
        if path.startswith(prefix) and len(prefix) > len(match):
            match = prefix
    return GUARDED.get(match)


def _allowed(key: str, learner_id: int | None) -> bool:
    hit = _CACHE.get((key, learner_id))
    if hit and hit[1] > time.monotonic():
        return hit[0]
    with SessionLocal() as db:
        learner = db.get(Learner, learner_id) if learner_id else None
        answer = is_on(db, key, learner)
    _CACHE[(key, learner_id)] = (answer, time.monotonic() + _TTL_SECONDS)
    return answer


def forget_feature_cache() -> None:
    """Called when a switch is flipped, so the change lands immediately."""
    _CACHE.clear()


class FeatureMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        key = _feature_for(scope.get("path", ""))
        if key is None:
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        # The admin token is the deployment operating on itself — a switch is a
        # product decision about users, not a lock on the operator.
        if headers.get("x-admin-token"):
            await self.app(scope, receive, send)
            return

        # IdentityMiddleware has already replaced any claimed learner_id with
        # the proven one, so this reads a value the caller cannot forge.
        learner_id: int | None = None
        for pair in scope.get("query_string", b"").decode("latin-1").split("&"):
            if pair.startswith("learner_id=") and pair[11:].isdigit():
                learner_id = int(pair[11:])

        if _allowed(key, learner_id):
            await self.app(scope, receive, send)
            return

        body = b'{"detail":"Not Found"}'
        await send({
            "type": "http.response.start",
            "status": 404,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("latin-1")),
            ],
        })
        await send({"type": "http.response.body", "body": body})
