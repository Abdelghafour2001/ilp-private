"""Who is calling — resolved from the Azure token, never from the caller's word.

Every route in this app takes a `learner_id` query parameter and trusts it.
That was fine while the platform was a demo: the worst case was reading someone
else's XP. It stopped being fine once governance could create accounts and grant
roles, and once HR analytics started carrying salaries-adjacent data —
`?learner_id=24` was all it took to read the whole organisation as the L&D lead.

The fix is deliberately *not* 85 changed signatures. A rule you have to remember
on every new endpoint is a rule that gets forgotten, and forgetting it is what
produced this. Instead `IdentityMiddleware` rewrites the query string before the
route ever sees it, so a caller's claimed identity is replaced by the one their
token proves. New endpoints inherit that for free.

The distinction that makes this safe: a `learner_id` in the QUERY STRING always
means "me, the caller", while a `{learner_id}` in the PATH means "the person
being acted on" (`PUT /learners/{id}/role`). The middleware only ever touches
the query string, so admin routes that target another account are untouched.
"""

from __future__ import annotations

import time
from urllib.parse import parse_qsl, urlencode

from sqlalchemy.orm import Session

from app.auth.azure import User
from app.db.session import SessionLocal
from app.models import Learner


def unique_handle(db: Session, base: str) -> str:
    base = (base or "user").split("@")[0][:38] or "user"
    handle = base
    i = 1
    while db.query(Learner).filter(Learner.handle.ilike(handle)).first():
        suffix = str(i)
        handle = base[: 40 - len(suffix)] + suffix
        i += 1
    return handle


def resolve_learner(db: Session, user: User) -> Learner:
    """The Learner behind a verified token, created on first sign-in.

    Auto-provisioning is safe here in a way it would not be elsewhere: the
    token is pinned to the configured tenant, so only people who already have a
    Managem account reach this, and they land as `user` — the role that can see
    nothing but their own learning. Elevation is a separate, deliberate act.
    """
    learner = db.query(Learner).filter(Learner.azure_oid == user.oid).first()
    if not learner and user.email:
        # Someone who started with a handle and later signed in through SSO:
        # match on email so their XP, role and team survive the transition
        # instead of spawning a second account.
        learner = db.query(Learner).filter(Learner.email.ilike(user.email)).first()

    if not learner:
        learner = Learner(
            handle=unique_handle(db, user.email or user.name or user.oid),
            azure_oid=user.oid,
            email=user.email,
            name=user.name,
            role="admin" if user.is_admin else "user",
        )
        db.add(learner)
    else:
        learner.azure_oid = user.oid
        learner.email = user.email or learner.email
        learner.name = user.name or learner.name
        # Azure may promote to admin; it must never demote a role granted
        # in-app (trainer / manager / bu_head / hr / hr_lead).
        if user.is_admin:
            learner.role = "admin"

    db.commit()
    db.refresh(learner)
    return learner


# --------------------------------------------------------------------------- #
# token -> learner id, cached                                                 #
# --------------------------------------------------------------------------- #
# Verifying a JWT and hitting the database on every single request would put a
# round trip in front of every page load. The token itself is already signed and
# time-limited, so caching the mapping for a minute changes nothing an attacker
# could use — the worst case is a role change taking up to a minute to land.
_CACHE: dict[str, tuple[int, float]] = {}
_TTL_SECONDS = 60.0
_MAX_ENTRIES = 512


def _cached(token: str) -> int | None:
    hit = _CACHE.get(token)
    if not hit:
        return None
    learner_id, expires_at = hit
    if expires_at < time.monotonic():
        _CACHE.pop(token, None)
        return None
    return learner_id


def _remember(token: str, learner_id: int) -> None:
    if len(_CACHE) >= _MAX_ENTRIES:
        # Cheap eviction — this is a cache, not a store.
        for stale in [k for k, (_, exp) in _CACHE.items() if exp < time.monotonic()][:64]:
            _CACHE.pop(stale, None)
        if len(_CACHE) >= _MAX_ENTRIES:
            _CACHE.clear()
    _CACHE[token] = (learner_id, time.monotonic() + _TTL_SECONDS)


def forget_token_cache() -> None:
    """Drop the cache — called after a role change so it takes effect at once."""
    _CACHE.clear()


def learner_id_for_session(token: str) -> int | None:
    """The learner behind a password session, or None if the token is not ours.

    `pwd_at` is checked against the account: a token issued before the password
    was last changed is refused, so changing a password really does end the
    sessions that existed before it.
    """
    from app.core import session_tokens

    claims = session_tokens.read(token)
    if not claims:
        return None
    with SessionLocal() as db:
        learner = db.get(Learner, int(claims.get("sub", 0) or 0))
        if not learner or not learner.password_hash:
            return None
        set_at = int(learner.password_set_at.timestamp()) if learner.password_set_at else 0
        if int(claims.get("pwd_at", 0)) != set_at:
            return None
        return learner.id


def learner_id_for_token(token: str, user: User) -> int:
    cached = _cached(token)
    if cached is not None:
        return cached
    with SessionLocal() as db:
        learner = resolve_learner(db, user)
        _remember(token, learner.id)
        return learner.id


# --------------------------------------------------------------------------- #
# query-string rewriting                                                      #
# --------------------------------------------------------------------------- #

def rewrite_learner_id(query_string: bytes, learner_id: int | None) -> bytes:
    """Force `learner_id` to the proven value, or drop it when unproven.

    `keep_blank_values` matters: `?learner_id=&x=1` must not silently lose `x`.
    """
    pairs = [(k, v) for k, v in parse_qsl(query_string.decode("latin-1"), keep_blank_values=True)
             if k != "learner_id"]
    if learner_id is not None:
        pairs.append(("learner_id", str(learner_id)))
    return urlencode(pairs).encode("latin-1")
