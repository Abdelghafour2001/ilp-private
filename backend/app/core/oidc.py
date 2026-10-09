"""Entra sign-in handled by the server: the OpenID Connect code flow.

The platform already accepts Entra identities, but only through MSAL running in
the page: the browser does the dance and sends the id token as a bearer. That
works, and it costs a *single-page application* redirect URI on the app
registration, a published client id, and a frontend that has to ship and
initialise MSAL.

This is the other way round, and the same one the ATS uses: the browser is sent
to Microsoft, Microsoft sends it back to `/api/auth/sso/azure/callback` with a
code, and the server — a confidential client, holding the secret — exchanges
that code and issues one of our own session tokens. What it buys:

* one app registration of the ordinary *Web* kind, no SPA redirect URI;
* nothing about the tenant published to the browser, and no MSAL in the bundle;
* the same session token as password sign-in, so everything downstream — the
  bell, the identity middleware, the admin guard — is already wired for it.

Both flows can be on at once. `sso_redirect_enabled` says whether this one is
available, and the login page prefers it when it is.

The two things that make a code flow safe, and are therefore not optional here:

* **state**, signed by us and short-lived, so a callback we did not start is
  refused and `next` cannot be turned into an open redirect;
* **nonce**, carried in the state and checked against the id token, so a token
  obtained elsewhere cannot be replayed into our callback.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import secrets
import urllib.error
import urllib.parse
import urllib.request

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient

from app.core import session_tokens
from app.core.config import settings

log = logging.getLogger(__name__)

STATE_LIFETIME = dt.timedelta(minutes=10)
TIMEOUT = 20
# openid/profile/email is all we need: who they are. Mail and calendar are the
# app-only Graph registration's business, not this one's.
SCOPE = "openid profile email"


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=(
            "Server-side SSO is not configured: AZURE_TENANT_ID, AZURE_CLIENT_ID, "
            "AZURE_CLIENT_SECRET and CREDENTIALS_ENCRYPTION_KEY are all required."
        ),
    )


def redirect_uri() -> str:
    """Where Microsoft sends the browser back.

    Built from `FRONTEND_ORIGIN` because the API is served under it — the same
    host proxies `/api`. This exact string has to be registered on the app
    registration as a *Web* redirect URI, or Entra answers AADSTS50011.
    """
    return f"{settings.frontend_origin.rstrip('/')}/api/auth/sso/azure/callback"


def _safe_next(next_path: str | None) -> str:
    """A path inside the app, never somebody else's site.

    An unchecked `next` is an open redirect, and one on a sign-in route is the
    useful kind for whoever is phishing.
    """
    value = (next_path or "/").strip()
    if not value.startswith("/") or value.startswith("//"):
        return "/"
    return value


def authorize_url(next_path: str | None) -> str:
    """Where to send the browser to sign in."""
    if not settings.sso_redirect_enabled:
        raise _unavailable()
    nonce = secrets.token_urlsafe(24)
    now = dt.datetime.now(dt.timezone.utc)
    state = jwt.encode(
        {
            "typ": "sso_state",
            "nonce": nonce,
            "next": _safe_next(next_path),
            "exp": int((now + STATE_LIFETIME).timestamp()),
        },
        session_tokens.secret(),
        algorithm="HS256",
    )
    params = {
        "client_id": settings.azure_client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri(),
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        # Always offer the account picker: shared machines are normal here, and
        # silently reusing whoever signed in last is how people end up looking
        # at a colleague's learning record.
        "prompt": "select_account",
    }
    return (
        f"https://login.microsoftonline.com/{settings.azure_tenant_id}"
        f"/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"
    )


def _read_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, session_tokens.secret(), algorithms=["HS256"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="This sign-in link has expired. Try again.") from exc
    if payload.get("typ") != "sso_state":
        raise HTTPException(status_code=400, detail="Invalid sign-in state.")
    return payload


def _id_token_claims(id_token: str, nonce: str) -> dict:
    """Verified claims of an Entra id token meant for this app."""
    keys = PyJWKClient(
        f"https://login.microsoftonline.com/{settings.azure_tenant_id}/discovery/v2.0/keys"
    )
    claims = jwt.decode(
        id_token,
        keys.get_signing_key_from_jwt(id_token).key,
        algorithms=["RS256"],
        audience=settings.azure_client_id,
        # Checked below against the tenant in the token: the issuer contains the
        # tenant id, which for a multi-tenant registration is not known upfront.
        options={"verify_iss": False},
    )
    tid = claims.get("tid", "")
    if claims.get("iss") != f"https://login.microsoftonline.com/{tid}/v2.0":
        raise HTTPException(status_code=401, detail="Invalid token issuer.")
    if "-" in settings.azure_tenant_id and tid != settings.azure_tenant_id:
        raise HTTPException(status_code=401, detail="Token from an unexpected tenant.")
    if claims.get("nonce") != nonce:
        raise HTTPException(status_code=401, detail="Sign-in nonce did not match.")
    return claims


def exchange(code: str, state: str) -> tuple[dict, str]:
    """Trade the code for an identity. Returns (claims, where to go next)."""
    if not settings.sso_redirect_enabled:
        raise _unavailable()
    payload = _read_state(state)
    body = urllib.parse.urlencode({
        "client_id": settings.azure_client_id,
        "client_secret": settings.azure_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri(),
        "scope": SCOPE,
    }).encode()
    request = urllib.request.Request(
        f"https://login.microsoftonline.com/{settings.azure_tenant_id}/oauth2/v2.0/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            token = json.load(response)
    except urllib.error.HTTPError as exc:
        # Entra's body names the cause (AADSTS…), and without it every failure
        # here reads as "invalid_grant" with no way to tell a stale code from a
        # mismatched redirect URI.
        detail = exc.read()[:400].decode(errors="replace")
        log.warning("sso token exchange failed: %s", detail)
        raise HTTPException(status_code=401, detail="Microsoft refused the sign-in.") from exc

    id_token = token.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Microsoft returned no identity token.")
    claims = _id_token_claims(id_token, payload["nonce"])
    email = (claims.get("preferred_username") or claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="This Microsoft account has no email address.")
    return (
        {
            "email": email,
            "name": claims.get("name") or email,
            "oid": claims.get("oid") or claims.get("sub", ""),
            "roles": [r.lower() for r in claims.get("roles", [])],
        },
        payload["next"],
    )
