"""The signed-in person's own account: who they are, and the little they may change.

Deliberately narrow. Everything on the org axes — BU, practice, matricule, job
level, job title, role — is HR's to set, not the account holder's; letting
someone edit their own BU would quietly move them between HR perimeters. What
is left is what a person legitimately owns: their display name, their language,
and their weekly goal.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.identity import forget_token_cache
from app.db.session import get_db
from app.models import Learner, Team

router = APIRouter(prefix="/account", tags=["account"])

ROLE_LABELS = {
    "user": "Collaborateur",
    "trainer": "Formateur",
    "manager": "Manager",
    "bu_head": "Responsable de BU",
    "hr": "HRBP",
    "hr_lead": "Responsable Compétences RH",
    "admin": "Administrateur",
}


class AccountOut(BaseModel):
    id: int
    handle: str
    name: str
    email: str
    role: str
    role_label: str
    # Org placement — read-only here, shown so people can check it is right
    # and tell HR when it is not.
    bu: str
    practice: str
    team: str
    title: str
    job_level: str
    location: str
    matricule: str
    locale: str
    weekly_goal_min: int
    onboarded: bool
    xp: int
    # How this person proves who they are.
    sign_in: str  # "azure" | "password" | "handle"
    sso_available: bool
    sso_linked: bool
    password_managed_by: str


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    locale: str | None = Field(default=None, pattern="^(fr|en)$")
    weekly_goal_min: int | None = Field(default=None, ge=0, le=10_000)


def _current(db: Session, learner_id: int | None) -> Learner:
    """The caller. `learner_id` is trustworthy: IdentityMiddleware overwrote it
    with whatever the bearer token proved before this route was reached."""
    learner = db.get(Learner, learner_id) if learner_id else None
    if not learner:
        raise HTTPException(status_code=401, detail="Sign in to see your account.")
    return learner


def _serialize(db: Session, learner: Learner) -> AccountOut:
    team = db.get(Team, learner.team_id) if learner.team_id else None
    linked = bool(learner.azure_oid)
    return AccountOut(
        id=learner.id,
        handle=learner.handle,
        name=learner.name or "",
        email=learner.email or "",
        role=learner.role,
        role_label=ROLE_LABELS.get(learner.role, learner.role),
        bu=learner.bu,
        practice=learner.practice,
        team=team.name if team else "",
        title=learner.title,
        job_level=learner.job_level,
        location=learner.location,
        matricule=learner.matricule,
        locale=learner.locale,
        weekly_goal_min=learner.weekly_goal_min,
        onboarded=learner.onboarded,
        xp=learner.xp,
        # Three ways in now, and the page was telling a password user that
        # "demo sign-in has no password" while showing them a change-password
        # form. Entra wins when the account is linked, because that is the
        # credential it will actually be asked for.
        sign_in="azure" if linked else ("password" if learner.password_hash else "handle"),
        sso_available=settings.auth_enabled,
        sso_linked=linked,
        password_managed_by=(
            "microsoft" if linked else ("upskill" if learner.password_hash else "none")
        ),
    )


@router.get("", response_model=AccountOut)
def my_account(learner_id: int | None = None, db: Session = Depends(get_db)):
    return _serialize(db, _current(db, learner_id))


@router.patch("", response_model=AccountOut)
def update_my_account(
    payload: AccountPatch,
    learner_id: int | None = None,
    db: Session = Depends(get_db),
):
    learner = _current(db, learner_id)
    if payload.name is not None:
        learner.name = payload.name.strip()
    if payload.locale is not None:
        learner.locale = payload.locale
    if payload.weekly_goal_min is not None:
        learner.weekly_goal_min = payload.weekly_goal_min
    db.commit()
    db.refresh(learner)
    forget_token_cache()
    return _serialize(db, learner)


@router.get("/session")
def session_info(
    learner_id: int | None = None,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """What the server actually believes about this request.

    Useful on the settings page and when debugging SSO: it reports whether a
    bearer token was accepted, so "am I really signed in?" has an answer that
    does not depend on what the browser thinks.
    """
    from app.auth.azure import optional_user

    user = optional_user(authorization)
    learner = db.get(Learner, learner_id) if learner_id else None
    return {
        "sso_configured": settings.auth_enabled,
        "tenant_id": settings.azure_tenant_id,
        "token_present": bool(authorization),
        "token_valid": user is not None,
        "token_email": user.email if user else "",
        "token_is_admin": user.is_admin if user else False,
        "identity_enforced": settings.auth_enabled,
        "learner_id": learner.id if learner else None,
        "handle": learner.handle if learner else "",
    }
