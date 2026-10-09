import datetime as dt
import logging
import urllib.parse

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import User, verify_bearer
from app.core import passwords, session_tokens
from app.core.config import settings
from app.core.rbac import is_people_admin, is_platform_admin
from app.db.session import get_db
from app.core import identity
from app.core.identity import resolve_learner
from app.models import Learner

router = APIRouter(prefix="/auth", tags=["auth"])

log = logging.getLogger(__name__)

# A wrong password should cost the attacker time, not the account its owner.
# Five tries, then a five-minute wait that resets on the next success.
MAX_FAILURES = 5
LOCKOUT = dt.timedelta(minutes=5)


@router.get("/config")
def auth_config():
    """Public — tells the frontend which ways in this deployment offers."""
    return {
        # The product name, so one image can carry any client's branding.
        "app_name": settings.app_name,
        "enabled": settings.auth_enabled,
        "client_id": settings.azure_client_id,
        "tenant_id": settings.azure_tenant_id,
        "authority": (
            f"https://login.microsoftonline.com/{settings.azure_tenant_id}"
            if settings.auth_enabled
            else ""
        ),
        # Email + password, for people who have no Entra account: externals,
        # and anyone on a deployment where SSO is not wired up yet.
        "password_login": settings.password_login_enabled,
        # True when the server itself runs the Entra code flow, so the page
        # sends the browser to /api/auth/sso/azure instead of loading MSAL.
        "sso_redirect": settings.sso_redirect_enabled,
        # True only when neither way in is configured — a local demo, where the
        # handle box is the sign-in. Stated rather than inferred, because the
        # frontend showing that box on a deployed instance would be a hole.
        "handle_login": not settings.auth_enabled and not settings.password_login_enabled,
    }


# --------------------------------------------------------------------------- #
# Entra single sign-on, run by the server (see app.core.oidc)                 #
# --------------------------------------------------------------------------- #


@router.get("/sso/azure")
def sso_start(next: str = "/"):
    """Send the browser to Microsoft to sign in."""
    from fastapi.responses import RedirectResponse

    from app.core import oidc

    return RedirectResponse(oidc.authorize_url(next), status_code=302)


@router.get("/sso/azure/callback")
def sso_callback(
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
    db: Session = Depends(get_db),
):
    """Where Microsoft comes back. Ends with the browser inside the app.

    The session token travels in the URL *fragment*: a fragment is never sent to
    a server, never written to an access log and never handed to a referrer, and
    the page strips it from the address bar as soon as it has read it. A query
    parameter would end up in the proxy logs of everything between here and the
    browser.
    """
    from fastapi.responses import RedirectResponse

    from app.core import oidc

    origin = settings.frontend_origin.rstrip("/")
    if error:
        # Consent not granted, or the account cannot use this app: the login
        # page says so rather than looping the person back to a blank form.
        log.warning("sso refused: %s (%s)", error, error_description)
        reason = urllib.parse.quote(error_description or error)
        return RedirectResponse(f"{origin}/login?sso_error={reason}", status_code=302)
    if not (code and state):
        raise HTTPException(status_code=400, detail="Missing code or state.")

    identity, next_path = oidc.exchange(code, state)
    learner = _learner_for_sso(db, identity)
    token = session_tokens.issue(learner.id, learner.password_set_at)
    fragment = urllib.parse.urlencode({"sso_token": token, "learner_id": learner.id})
    # Always back to /login, carrying where they were going: that page is the one
    # that knows how to finish a sign-in, and a fragment left on a dashboard
    # would simply sit in the address bar doing nothing.
    where = urllib.parse.urlencode({"next": next_path})
    return RedirectResponse(f"{origin}/login?{where}#{fragment}", status_code=302)


def _learner_for_sso(db: Session, identity: dict) -> Learner:
    """The account behind an Entra identity, created on first sign-in.

    Auto-provisioning is right for an internal platform: everybody in the tenant
    works here, and the alternative is L&D inviting 300 people who already have
    accounts in Entra. The role is the ordinary one unless the address is in
    ADMIN_EMAILS — which is exactly what that setting has always meant, and now
    finally does something on a deployment with no Azure app roles.
    """
    email = identity["email"]
    learner = db.query(Learner).filter(Learner.email.ilike(email)).first()
    if not learner:
        learner = Learner(
            handle=identity.unique_handle(db, email.split("@")[0]),
            name=identity["name"],
            email=email,
            role="admin" if email in settings.admin_emails_list else "user",
        )
        db.add(learner)
        db.commit()
        log.info("sso: created %s (%s) as %s", learner.handle, email, learner.role)
        return learner
    # An existing account named in ADMIN_EMAILS is promoted; nobody is ever
    # demoted here, because roles are L&D's to manage and a token should not
    # quietly undo them.
    if email in settings.admin_emails_list and learner.role != "admin":
        learner.role = "admin"
        db.commit()
    return learner


# --------------------------------------------------------------------------- #
# email + password                                                            #
# --------------------------------------------------------------------------- #


class LoginIn(BaseModel):
    email: str
    password: str


def _locked_for(learner: Learner) -> int:
    """Seconds still to wait, 0 when the account is not locked."""
    if not learner.locked_until:
        return 0
    left = (learner.locked_until - dt.datetime.now(dt.timezone.utc)).total_seconds()
    return max(0, int(left))


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    """Sign in with a work email and a password.

    One answer for "no such account" and "wrong password": telling them apart
    turns the login form into a directory of who works here.
    """
    if not settings.password_login_enabled:
        raise HTTPException(status_code=400, detail="Password sign-in is off on this server.")

    email = payload.email.strip().lower()
    learner = db.query(Learner).filter(Learner.email.ilike(email)).first()
    if learner:
        wait = _locked_for(learner)
        if wait:
            raise HTTPException(
                status_code=429,
                detail=f"Too many attempts. Try again in {wait // 60 + 1} minute(s).",
            )

    if not learner or not learner.password_hash or not passwords.verify_password(
        payload.password, learner.password_hash
    ):
        if learner:
            learner.failed_logins = (learner.failed_logins or 0) + 1
            if learner.failed_logins >= MAX_FAILURES:
                learner.locked_until = dt.datetime.now(dt.timezone.utc) + LOCKOUT
                learner.failed_logins = 0
            db.commit()
        raise HTTPException(status_code=401, detail="Wrong email or password.")

    learner.failed_logins = 0
    learner.locked_until = None
    db.commit()

    return {
        "token": session_tokens.issue(learner.id, learner.password_set_at),
        "learner_id": learner.id,
        "handle": learner.handle,
        "name": learner.name,
        "email": learner.email,
        "role": learner.role,
        "onboarded": learner.onboarded,
        # The app blocks on this: a one-time password gets you as far as the
        # screen that replaces it, and no further.
        "must_change_password": learner.must_change_password,
    }


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str
    learner_id: int | None = None


@router.post("/password")
def change_password(payload: ChangePasswordIn, db: Session = Depends(get_db)):
    """Change your own password. Requires the current one, even for an admin."""
    learner = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not learner:
        raise HTTPException(status_code=401, detail="Sign in first.")
    if not learner.password_hash or not passwords.verify_password(
        payload.current_password, learner.password_hash
    ):
        raise HTTPException(status_code=401, detail="Current password is wrong.")
    problem = passwords.complaint(payload.new_password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    learner.password_hash = passwords.hash_password(payload.new_password)
    # Every session issued before this moment stops working — which is what
    # changing a password after a scare has to mean.
    learner.password_set_at = dt.datetime.now(dt.timezone.utc)
    # They have now chosen it themselves, which is the whole point of the flag.
    learner.must_change_password = False
    learner.failed_logins = 0
    learner.locked_until = None
    db.commit()
    return {"token": session_tokens.issue(learner.id, learner.password_set_at)}


class SetPasswordIn(BaseModel):
    email: str
    new_password: str
    learner_id: int | None = None


@router.post("/password/set")
def set_password(
    payload: SetPasswordIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Give somebody a password, or replace the one they forgot.

    L&D and admins only — the two roles that already open accounts. There is no
    self-service reset link yet: that needs a mailed one-time token, and an
    unmailed one would be a password reset anybody could trigger.
    """
    actor = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not (is_people_admin(actor, x_admin_token) or is_platform_admin(actor, x_admin_token)):
        raise HTTPException(status_code=403, detail="Only L&D or an admin can set a password.")
    problem = passwords.complaint(payload.new_password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    target = db.query(Learner).filter(Learner.email.ilike(payload.email.strip())).first()
    if not target:
        raise HTTPException(status_code=404, detail=f"Nobody here with the address {payload.email}.")

    target.password_hash = passwords.hash_password(payload.new_password)
    target.password_set_at = dt.datetime.now(dt.timezone.utc)
    # Somebody else chose this one, so it is a one-time key: the account is
    # unusable until its owner replaces it. Unless the person setting it *is*
    # the owner — an admin fixing their own password has already chosen it.
    target.must_change_password = target is not actor
    target.failed_logins = 0
    target.locked_until = None
    db.commit()
    return {
        "handle": target.handle,
        "email": target.email,
        "password_set": True,
        "must_change_password": target.must_change_password,
    }


@router.get("/me")
def me(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    # Two kinds of bearer arrive here: an Entra token, which Entra signed and we
    # verify against its keys, and one of our own session tokens, issued by the
    # password door and by the server-side SSO flow. "Who am I" has the same
    # answer either way, and only recognising the first made the second door
    # unable to ask.
    token = (authorization or "").removeprefix("Bearer ").strip()
    session_learner = identity.learner_id_for_session(token) if token else None
    if session_learner:
        learner = db.get(Learner, session_learner)
    else:
        user: User = verify_bearer(authorization)
        learner = resolve_learner(db, user)

    return {
        "authenticated": True,
        "learner_id": learner.id,
        "handle": learner.handle,
        "email": learner.email,
        "name": learner.name,
        "is_admin": learner.role == "admin",
        "role": learner.role,
        "xp": learner.xp,
        "onboarded": learner.onboarded,
        # Asked again on every reload, so closing the tab is not a way past the
        # screen that replaces a one-time password.
        "must_change_password": learner.must_change_password,
    }
