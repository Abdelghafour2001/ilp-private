"""Azure Entra ID (Azure AD) token verification + role resolution.

The frontend (MSAL.js) signs the user in and sends their ID token as a bearer.
Here we validate the JWT against Entra's published signing keys, then derive the
user's identity and whether they're an admin (from the token's App Roles claim
or a configured admin-email allowlist).
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from app.core.config import settings


@dataclass
class User:
    oid: str
    email: str
    name: str
    roles: list[str]
    is_admin: bool


_jwk_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        url = f"https://login.microsoftonline.com/{settings.azure_tenant_id}/discovery/v2.0/keys"
        _jwk_client = PyJWKClient(url)
    return _jwk_client


def _claims_to_user(claims: dict) -> User:
    email = (claims.get("preferred_username") or claims.get("email") or "").lower()
    roles = [r.lower() for r in claims.get("roles", [])]
    is_admin = "admin" in roles or (email and email in settings.admin_emails_list)
    return User(
        oid=claims.get("oid") or claims.get("sub", ""),
        email=email,
        name=claims.get("name", email),
        roles=roles,
        is_admin=is_admin,
    )


def _verify(token: str) -> User:
    signing_key = _jwks().get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.azure_client_id,
        options={"verify_iss": False},  # issuer checked manually against tid below
    )
    tid = claims.get("tid", "")
    expected_iss = f"https://login.microsoftonline.com/{tid}/v2.0"
    if claims.get("iss") != expected_iss:
        raise HTTPException(status_code=401, detail="Invalid token issuer.")
    # If a specific tenant GUID is configured, the token must belong to it.
    if "-" in settings.azure_tenant_id and tid != settings.azure_tenant_id:
        raise HTTPException(status_code=401, detail="Token from an unexpected tenant.")
    return _claims_to_user(claims)


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def verify_bearer(authorization: str | None = Header(default=None)) -> User:
    """Strict dependency: requires a valid Azure bearer token (401 otherwise)."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=400, detail="SSO is not configured on the server.")
    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    try:
        return _verify(token)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc


def optional_user(authorization: str | None) -> User | None:
    """Lenient: returns a User if a valid token is present, else None (no raise)."""
    if not settings.auth_enabled:
        return None
    token = _bearer(authorization)
    if not token:
        return None
    try:
        return _verify(token)
    except Exception:  # noqa: BLE001
        return None
