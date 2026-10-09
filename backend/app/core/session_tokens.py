"""Sessions for people who sign in with an email and a password.

SSO users already carry a token Entra signed; these are the equivalent for
everybody else — a short-lived JWT this server signs itself, carrying nothing
but the learner id and an issue time.

Two properties make it safe to treat the same way as an Entra token:

* it is signed with a server-side secret the client never sees, so a caller
  cannot mint one;
* it carries `pwd_at`, the moment the account's password was last set. Changing
  a password therefore invalidates every session that existed before it, which
  is what "log everyone out" has to mean after a compromise.
"""

from __future__ import annotations

import datetime as dt
import hashlib

import jwt

from app.core.config import settings

ALGORITHM = "HS256"
ISSUER = "aida"
LIFETIME = dt.timedelta(hours=12)


def secret() -> str:
    """The signing key, derived rather than configured separately.

    A second secret to set is a second secret to forget, so this is derived
    from CREDENTIALS_ENCRYPTION_KEY — already required, already deployment
    scoped, and never shared with a client. Deriving rather than reusing it
    directly keeps a leaked session key from being the credential-store key.
    """
    base = settings.credentials_encryption_key
    return hashlib.sha256(f"aida-session::{base}".encode()).hexdigest()


def issue(learner_id: int, password_set_at: dt.datetime | None) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode(
        {
            "iss": ISSUER,
            "sub": str(learner_id),
            "iat": int(now.timestamp()),
            "exp": int((now + LIFETIME).timestamp()),
            "pwd_at": int(password_set_at.timestamp()) if password_set_at else 0,
        },
        secret(),
        algorithm=ALGORITHM,
    )


def read(token: str) -> dict | None:
    """The claims of a token this server signed, or None for anything else.

    Never raises: the caller hands it whatever arrived in the Authorization
    header, which on an SSO deployment is usually an Entra token meant for
    somebody else to verify.
    """
    try:
        return jwt.decode(token, secret(), algorithms=[ALGORITHM], issuer=ISSUER)
    except Exception:  # noqa: BLE001
        return None
