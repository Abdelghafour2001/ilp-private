"""Attach a Coursera account to an AIDA learner, and bring its history across.

The sync matches people by email. Most of the organisation exists on Coursera
long before it signs in here, so their rows sit with `learner_id` NULL and
their learning never reaches their profile, their XP or the HR board. Linking
is the one manual step that closes that gap, and it is worth doing properly:
the history already collected is backfilled rather than starting from zero.

XP is an *estimate*, and deliberately a conservative one — an hour on Coursera
is not the same evidence as a graded lab here. The formula is stated in the
result so nobody has to guess where a number came from, and the amount granted
is remembered so a second link replaces it instead of stacking another.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.core.external_learning import _record_certificate
from app.models import ExternalEnrollment, Learner

log = logging.getLogger(__name__)

# What an hour, a completion and a certificate are worth. An in-app lab step is
# 20 XP and a training lesson 10, so 10 XP an hour puts outside learning in the
# same range without pretending it carries the same proof.
XP_PER_HOUR = 10
XP_PER_COMPLETION = 40
XP_PER_CERTIFICATE = 25


def estimate_xp(rows: list[ExternalEnrollment]) -> tuple[int, dict]:
    """XP for this history, with the arithmetic that produced it."""
    hours = sum(r.hours or 0.0 for r in rows)
    completions = sum(1 for r in rows if r.completed)
    certificates = sum(1 for r in rows if r.certificate_url)
    total = (
        round(hours * XP_PER_HOUR)
        + completions * XP_PER_COMPLETION
        + certificates * XP_PER_CERTIFICATE
    )
    return total, {
        "hours": round(hours, 1),
        "completions": completions,
        "certificates": certificates,
        "formula": (
            f"{XP_PER_HOUR} XP/h + {XP_PER_COMPLETION} XP per completion "
            f"+ {XP_PER_CERTIFICATE} XP per certificate"
        ),
    }


def grant_coursera_xp(db: Session, learner: Learner) -> dict:
    """Recompute this learner's provider XP from the rows they own right now.

    Replaces its own previous contribution rather than stacking another, so the
    nightly sync can call it on every linked learner and XP tracks what the
    provider currently reports. Badges are re-evaluated for the same reason: a
    course finished last night should show up without anyone re-linking.
    """
    from app.labs.progress_service import sync_badges

    # The caller may have just assigned rows to this learner. Autoflush is off
    # on this session, so without a flush the query below would not see them
    # and every freshly linked account would score zero.
    db.flush()
    rows = (
        db.query(ExternalEnrollment)
        .filter(ExternalEnrollment.learner_id == learner.id)
        .all()
    )
    granted, breakdown = estimate_xp(rows)
    previous = learner.coursera_xp or 0
    learner.xp = max(0, (learner.xp or 0) - previous + granted)
    learner.coursera_xp = granted
    db.commit()
    new_badges = sync_badges(db, learner)
    return {"granted": granted, "previously_granted": previous, "total_now": learner.xp,
            "new_badges": new_badges, **breakdown}


def link_learner(db: Session, learner: Learner, coursera_email: str) -> dict:
    """Point a learner at their Coursera account and backfill what it holds.

    Idempotent: re-running adopts any new rows, re-counts the XP contribution
    and leaves everything else alone.
    """
    email = coursera_email.strip().lower()
    rows = (
        db.query(ExternalEnrollment)
        .filter(ExternalEnrollment.provider == "coursera")
        .filter(ExternalEnrollment.matched_email.ilike(email))
        .all()
    )
    if not rows:
        return {"linked": False, "reason": f"No Coursera activity for {email}."}

    learner.email = learner.email or coursera_email.strip()
    adopted = 0
    for row in rows:
        if row.learner_id != learner.id:
            row.learner_id = learner.id
            adopted += 1

    # Certificates the sync could not record while the rows were unattached.
    certificates = sum(1 for row in rows if _record_certificate(db, learner, row))

    # The provider knows where people sit; fill only what is blank here, never
    # overwrite something L&D set deliberately.
    profile = next((r for r in rows if r.business_unit or r.job_title), None)
    filled: list[str] = []
    if profile:
        for field, value in (
            ("name", profile.full_name),
            ("bu", profile.business_unit),
            ("title", profile.job_title),
            ("location", profile.location_city),
        ):
            if value and not getattr(learner, field, None):
                setattr(learner, field, value)
                filled.append(field)

    xp = grant_coursera_xp(db, learner)
    granted = xp["granted"]
    log.info("coursera link: %s <- %s (%d rows, %d XP)", learner.handle, email, len(rows), granted)
    return {
        "linked": True,
        "handle": learner.handle,
        "coursera_email": email,
        "enrollments": len(rows),
        "newly_attached": adopted,
        "certificates_recorded": certificates,
        "profile_fields_filled": filled,
        "xp": xp,
        "new_badges": xp["new_badges"],
    }
