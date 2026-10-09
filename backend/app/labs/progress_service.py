"""Awarding XP and badges, and computing learner stats.

Kept separate from the API routes so both the grade endpoint and the profile
endpoint can share it without circular imports.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core import specializations
from app.labs import badges as badge_rules
from app.labs import gamification
from app.labs import registry
from app.models import Achievement, ExternalEnrollment, Learner, StepCompletion


def _step_index(db: Session) -> dict[tuple[str, str], object]:
    idx = {}
    for lab in registry.all_labs(db):
        for step in lab.steps:
            idx[(lab.id, step.id)] = (lab, step)
    return idx


def learner_stats(db: Session, learner: Learner) -> dict:
    completions = (
        db.query(StepCompletion).filter(StepCompletion.learner_id == learner.id).all()
    )
    idx = _step_index(db)
    done = {(c.lab_id, c.step_id) for c in completions}

    challenges = sum(
        1 for key in done if (s := idx.get(key)) and s[1].type == "challenge"
    )
    sql_passed = sum(
        1 for key in done if (s := idx.get(key)) and s[1].grader.type == "sql_scalar"
    )
    code_passed = sum(
        1 for key in done if (s := idx.get(key)) and s[1].builder.mode == "code"
    )
    labs_touched = len({c.lab_id for c in completions})

    # A track is complete when every gradable step in all its labs is done.
    tracks_completed = set()
    by_track: dict[str, list] = {}
    for lab in registry.all_labs(db):
        by_track.setdefault(lab.track, []).append(lab)
    for track, labs in by_track.items():
        required = {
            (lab.id, s.id) for lab in labs for s in lab.steps if s.grader.type
        }
        if required and required <= done:
            tracks_completed.add(track)

    # Learning done on a provider counts too. Badges used to be reachable only
    # through labs, which told someone with 38 finished Coursera courses that
    # they had achieved nothing here.
    external = (
        db.query(ExternalEnrollment)
        .filter(ExternalEnrollment.learner_id == learner.id)
        .all()
    )
    external_done = [r for r in external if r.completed]

    return {
        "xp": learner.xp,
        "steps_passed": len(done),
        "challenges_passed": challenges,
        "sql_passed": sql_passed,
        "code_passed": code_passed,
        "labs_touched": labs_touched,
        "tracks_completed": tracks_completed,
        "current_streak": gamification.streak_is_live(learner),
        "longest_streak": learner.longest_streak or 0,
        "level": gamification.level_info(learner.xp)["level"],
        # --- provider learning -------------------------------------------
        "external_linked": bool(external),
        "external_completed": len(external_done),
        "external_certificates": sum(1 for r in external if r.certificate_url),
        "external_hours": round(sum(r.hours or 0.0 for r in external), 1),
        "external_partners": len({r.partner_names for r in external_done if r.partner_names}),
        # Derived from the courses above against the catalogue's membership
        # lists; see app.core.specializations.
        "external_specializations": specializations.earned_count(db, learner.id),
    }


def sync_badges(db: Session, learner: Learner) -> list[str]:
    """Award any newly-earned badges; return the ids of the new ones."""
    stats = learner_stats(db, learner)
    earned = set(badge_rules.evaluate(stats))
    existing = {
        a.badge_id
        for a in db.query(Achievement).filter(Achievement.learner_id == learner.id).all()
    }
    new = earned - existing
    for badge_id in new:
        db.add(Achievement(learner_id=learner.id, badge_id=badge_id))
    if new:
        db.commit()
    return sorted(new)


def record_pass(db: Session, learner: Learner, lab_id: str, step_id: str) -> dict:
    """Idempotently record a passed step, award its XP, and sync badges."""
    lab = registry.get_lab(db, lab_id)
    step = next((s for s in lab.steps if s.id == step_id), None) if lab else None
    if not step:
        return {"awarded_xp": 0, "new_badges": []}

    existing = (
        db.query(StepCompletion)
        .filter(
            StepCompletion.learner_id == learner.id,
            StepCompletion.lab_id == lab_id,
            StepCompletion.step_id == step_id,
        )
        .first()
    )
    awarded = 0
    if not existing:
        awarded = step.xp
        db.add(
            StepCompletion(
                learner_id=learner.id, lab_id=lab_id, step_id=step_id, xp_awarded=awarded
            )
        )
        learner.xp += awarded
        gamification.touch_streak(learner)
        db.commit()
        db.refresh(learner)

    new_badges = sync_badges(db, learner)
    return {"awarded_xp": awarded, "new_badges": new_badges}
