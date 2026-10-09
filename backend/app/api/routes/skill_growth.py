"""Skill ratings, role profiles and the org heatmap.

Kept beside `skills.py` (same `/skills` prefix) because it is a distinct
concern: `skills.py` curates the catalog and tags content, this decides what
level someone is at and what level their role expects.

Three ideas:

* **Ratings have a source.** A self-rating is an opinion; a manager's is a
  judgement; an exam is evidence. Storing them separately, and reporting which
  one a level came from, is what makes the number worth anything.
* **Roles carry targets.** Without one, a matrix says "Sara rated herself 3 at
  SQL" — true and useless. With one it says she is one level short of what her
  role needs, which is a plan.
* **The heatmap answers "where are we thin?"** That is the question a skills
  framework exists for, and a per-programme hours report cannot answer it.
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.skills import (
    effective_level,
    ratings_for,
    resolve_profile,
    skill_state,
    targets_for,
)
from app.db.session import get_db
from app.models import (
    Learner,
    LearnerSkill,
    Skill,
    SkillProfile,
    SkillProfileTarget,
    SkillRating,
    Team,
)

router = APIRouter(prefix="/skills", tags=["skills"])

AXES = ("bu", "practice", "location", "job_level")


def _is_admin(learner: Learner | None, token: str | None) -> bool:
    if settings.admin_token and token == settings.admin_token:
        return True
    return learner is not None and learner.role in ("admin", "hr", "hr_lead")


def _can_curate(learner: Learner | None, token: str | None) -> bool:
    if _is_admin(learner, token):
        return True
    return learner is not None and learner.role in (
        "trainer", "manager", "bu_head",
    )


# --------------------------------------------------------------------------- #
# my skills: level, provenance, target, gap                                   #
# --------------------------------------------------------------------------- #


@router.get("/me/state")
def my_skill_state(learner_id: int, db: Session = Depends(get_db)):
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    profile = resolve_profile(db, learner)
    catalog = {s.id: s for s in db.query(Skill).all()}
    rows = [
        {"skill_id": sid, "name": catalog[sid].name, "category": catalog[sid].category, **data}
        for sid, data in skill_state(db, learner).items()
        if sid in catalog
    ]
    # Biggest shortfall first: that is the reading order for a development plan.
    rows.sort(key=lambda r: (-(r["gap"] or 0), r["name"]))
    return {
        "profile": (
            {"id": profile.id, "name": profile.name, "description": profile.description}
            if profile
            else None
        ),
        "skills": rows,
        "gaps": sum(1 for r in rows if (r["gap"] or 0) > 0),
    }


# --------------------------------------------------------------------------- #
# ratings from other people                                                   #
# --------------------------------------------------------------------------- #


class RateRequest(BaseModel):
    learner_id: int  # whose skill is being rated
    level: int = Field(ge=1, le=5)
    source: str = "peer"  # peer | manager | assessment
    note: str = ""
    rater_id: int | None = None  # who is rating; None only for an assessment


@router.get("/{skill_id}/ratings")
def skill_ratings(skill_id: int, learner_id: int, db: Session = Depends(get_db)):
    """Who rated this person on this skill, and what they said."""
    rows = (
        db.query(SkillRating)
        .filter_by(skill_id=skill_id, learner_id=learner_id)
        .order_by(SkillRating.id.desc())
        .all()
    )
    mine = db.query(LearnerSkill).filter_by(skill_id=skill_id, learner_id=learner_id).first()
    level, source = effective_level(ratings_for(db, [learner_id]).get((learner_id, skill_id), {}))
    return {
        "self": mine.level if mine else 0,
        "effective": {"level": level, "source": source},
        "ratings": [
            {
                "id": r.id,
                "level": r.level,
                "source": r.source,
                "rater_name": r.rater_name,
                "note": r.note,
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }


@router.post("/{skill_id}/rate")
def rate_skill(
    skill_id: int,
    payload: RateRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Record a peer, manager or assessment rating.

    Rating yourself through this endpoint is refused: the self-rating has its
    own home on LearnerSkill, and allowing it here would let someone raise
    their own effective level by posting it as a "peer".
    """
    if not db.get(Skill, skill_id):
        raise HTTPException(status_code=404, detail="Skill not found")
    subject = db.get(Learner, payload.learner_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Learner not found")
    if payload.source not in ("peer", "manager", "assessment"):
        raise HTTPException(status_code=400, detail="source must be peer, manager or assessment.")

    rater = db.get(Learner, payload.rater_id) if payload.rater_id else None

    if payload.source in ("peer", "manager"):
        if not rater:
            raise HTTPException(status_code=400, detail="rater_id is required.")
        if rater.id == subject.id:
            raise HTTPException(
                status_code=400, detail="Use the self-rating endpoint to rate your own skill."
            )
    if payload.source == "manager":
        team = db.get(Team, subject.team_id) if subject.team_id else None
        is_overseer = team is not None and rater.id in (team.manager_id, team.lead_id)
        if not (is_overseer or _is_admin(rater, x_admin_token)):
            raise HTTPException(
                status_code=403,
                detail="Only this person's manager, Skill Lead, HR or an admin can give a manager rating.",
            )
    if payload.source == "assessment" and not _is_admin(rater, x_admin_token):
        raise HTTPException(
            status_code=403, detail="Only HR or an admin can record an assessment result."
        )

    row = (
        db.query(SkillRating)
        .filter_by(
            learner_id=subject.id,
            skill_id=skill_id,
            source=payload.source,
            rater_id=rater.id if rater else None,
        )
        .first()
    )
    if not row:
        row = SkillRating(
            learner_id=subject.id,
            skill_id=skill_id,
            source=payload.source,
            rater_id=rater.id if rater else None,
        )
        db.add(row)
    row.level = payload.level
    row.note = payload.note.strip()[:400]
    row.rater_name = (rater.name or rater.handle) if rater else "assessment"
    db.commit()

    level, source = effective_level(ratings_for(db, [subject.id]).get((subject.id, skill_id), {}))
    return {"level": level, "source": source}


# --------------------------------------------------------------------------- #
# role profiles                                                               #
# --------------------------------------------------------------------------- #


class ProfileTargetIn(BaseModel):
    skill_id: int
    target_level: int = Field(ge=1, le=5)


class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = ""
    practice: str = ""
    job_level: str = ""
    targets: list[ProfileTargetIn] = []
    learner_id: int | None = None


@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    catalog = {s.id: s for s in db.query(Skill).all()}
    out = []
    for p in db.query(SkillProfile).order_by(SkillProfile.name):
        targets = db.query(SkillProfileTarget).filter_by(profile_id=p.id).all()
        out.append({
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "practice": p.practice,
            "job_level": p.job_level,
            "targets": [
                {
                    "skill_id": t.skill_id,
                    "name": catalog[t.skill_id].name,
                    "target_level": t.target_level,
                }
                for t in targets
                if t.skill_id in catalog
            ],
        })
    return out


@router.post("/profiles", status_code=201)
def upsert_profile(
    payload: ProfileIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Create or replace a role profile.

    Targets are replaced wholesale: a half-applied set would silently misreport
    gaps for everyone matching the role.
    """
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_curate(viewer, x_admin_token):
        raise HTTPException(
            status_code=403,
            detail="Only trainers, Skill Leads, managers, HR or admins can define role profiles.",
        )

    name = payload.name.strip()
    profile = db.query(SkillProfile).filter(SkillProfile.name == name).first()
    if not profile:
        profile = SkillProfile(name=name)
        db.add(profile)
    profile.description = payload.description.strip()
    profile.practice = payload.practice.strip()
    profile.job_level = payload.job_level.strip()
    db.flush()

    db.query(SkillProfileTarget).filter_by(profile_id=profile.id).delete()
    for t in payload.targets:
        if db.get(Skill, t.skill_id):
            db.add(
                SkillProfileTarget(
                    profile_id=profile.id, skill_id=t.skill_id, target_level=t.target_level
                )
            )
    db.commit()
    return {"id": profile.id, "name": profile.name}


# --------------------------------------------------------------------------- #
# org heatmap                                                                 #
# --------------------------------------------------------------------------- #


@router.get("/heatmap")
def heatmap(
    axis: str = "bu",
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Skill coverage across the organisation, grouped by an org axis.

    An HRBP sees only their own BU, matching how `/analytics/hr` is scoped —
    the same data deserves the same boundary whichever endpoint serves it.
    """
    if axis not in AXES:
        raise HTTPException(status_code=400, detail=f"axis must be one of: {', '.join(AXES)}")

    viewer = db.get(Learner, learner_id) if learner_id else None
    if not _is_admin(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only HR or admins can view the org heatmap.")

    from app.core.rbac import reporting_scope

    scope = reporting_scope(db, viewer, x_admin_token)
    people = db.query(Learner).all()
    scoped = not scope.org_wide
    if scoped:
        people = [p for p in people if scope.allows(p.id)]
    if not people:
        return {"axis": axis, "scope": "bu" if scoped else "org", "groups": [], "skills": []}

    buckets = ratings_for(db, [p.id for p in people])
    targets_by_learner = {p.id: targets_for(db, resolve_profile(db, p)) for p in people}
    catalog = {s.id: s for s in db.query(Skill).all()}

    groups: dict[str, list[Learner]] = defaultdict(list)
    for p in people:
        groups[getattr(p, axis) or "—"].append(p)

    # Only skills someone is rated on or expected to have. Listing the whole
    # catalog at zero would bury the signal in noise.
    relevant = {sid for (_, sid) in buckets} | {
        sid for t in targets_by_learner.values() for sid in t
    }
    relevant &= set(catalog)
    ordered = sorted(relevant, key=lambda i: (catalog[i].category, catalog[i].name))

    rows = []
    for group_name, members in sorted(groups.items()):
        cells = []
        for sid in ordered:
            levels, gaps, targeted = [], [], 0
            for m in members:
                level, _ = effective_level(buckets.get((m.id, sid), {}))
                if level:
                    levels.append(level)
                target = targets_by_learner[m.id].get(sid)
                if target is not None:
                    targeted += 1
                    gaps.append(max(0, target - level))
            cells.append({
                "skill_id": sid,
                "avg_level": round(sum(levels) / len(levels), 1) if levels else 0,
                "rated": len(levels),
                # Share of the group at level 3+ — "can do this unaided".
                "coverage": round(sum(1 for v in levels if v >= 3) / len(members) * 100, 1),
                "targeted": targeted,
                "avg_gap": round(sum(gaps) / len(gaps), 1) if gaps else 0,
                "people_short": sum(1 for g in gaps if g > 0),
            })
        rows.append({"group": group_name, "members": len(members), "cells": cells})

    return {
        "axis": axis,
        "scope": "bu" if scoped else "org",
        "skills": [
            {"id": sid, "name": catalog[sid].name, "category": catalog[sid].category}
            for sid in ordered
        ],
        "groups": rows,
    }
