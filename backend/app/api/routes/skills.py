"""Skills framework — curated competencies linking content, people and gaps.

- catalog: curated by trainers/leads/managers/HR/admins
- links: content (training/course/certification) tagged with skills
- learner skills: follow + 0-5 self-rating
- ratings: corroborating opinions from peers, managers and assessments
- profiles: what level a role is expected to reach, so a gap is measurable
- gap matrix: per-team skill coverage for overseers and HR
- heatmap: org-wide skill coverage vs target, by BU or practice
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models import (
    Certification,
    Course,
    Formation,
    Learner,
    LearnerSkill,
    Skill,
    SkillLink,
    Team,
)

router = APIRouter(prefix="/skills", tags=["skills"])

ENTITY_MODELS = {"formation": Formation, "course": Course, "certification": Certification}


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


class SkillCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    category: str = "General"
    # hard = a craft; soft = a behaviour. Anything else is refused rather than
    # stored, or the two lists the catalogue is read as stop adding up.
    kind: str = "hard"
    description: str = ""
    learner_id: int | None = None


class LinkRequest(BaseModel):
    entity_type: str
    entity_id: int
    learner_id: int | None = None


class FollowRequest(BaseModel):
    learner_id: int
    level: int | None = None  # 0-5; None = just toggle following
    following: bool | None = None


def _entity_title(db: Session, etype: str, eid: int) -> tuple[str, str] | None:
    model = ENTITY_MODELS.get(etype)
    if not model:
        return None
    e = db.get(model, eid)
    if not e:
        return None
    if etype == "certification":
        return e.name, "🎖️"
    return e.title, e.emoji


@router.get("")
def list_skills(learner_id: int | None = None, db: Session = Depends(get_db)):
    skills = db.query(Skill).order_by(Skill.category, Skill.name).all()
    content_counts = dict(
        db.query(SkillLink.skill_id, func.count()).group_by(SkillLink.skill_id)
    )
    follower_counts = dict(
        db.query(LearnerSkill.skill_id, func.count())
        .filter(LearnerSkill.following.is_(True))
        .group_by(LearnerSkill.skill_id)
    )
    mine: dict[int, LearnerSkill] = {}
    if learner_id:
        mine = {
            ls.skill_id: ls
            for ls in db.query(LearnerSkill).filter_by(learner_id=learner_id)
        }
    return [
        {
            "id": s.id,
            "name": s.name,
            "category": s.category,
            "kind": s.kind,
            "description": s.description,
            "content_count": content_counts.get(s.id, 0),
            "followers": follower_counts.get(s.id, 0),
            "my_level": mine[s.id].level if s.id in mine else None,
            "following": mine[s.id].following if s.id in mine else False,
        }
        for s in skills
    ]


@router.get("/domains")
def domains(db: Session = Depends(get_db)):
    """The domains in use, grouped by kind, with how many skills each holds.

    Read from the rows rather than from the seeded taxonomy: L&D add domains in
    the app, and a picker that only offered the shipped list would quietly make
    theirs second-class.
    """
    rows = (
        db.query(Skill.kind, Skill.category, func.count(Skill.id))
        .group_by(Skill.kind, Skill.category)
        .order_by(Skill.kind, Skill.category)
        .all()
    )
    out: dict[str, list[dict]] = {"soft": [], "hard": []}
    for kind, category, count in rows:
        out.setdefault(kind, []).append({"name": category, "skills": count})
    return out


@router.post("", status_code=201)
def create_skill(
    payload: SkillCreate,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_curate(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only trainers, leads, managers, HR or admins can add skills.")
    name = payload.name.strip()
    if db.query(Skill).filter(Skill.name.ilike(name)).first():
        raise HTTPException(status_code=409, detail=f"Skill '{name}' already exists.")
    kind = payload.kind.strip().lower()
    if kind not in ("hard", "soft"):
        raise HTTPException(status_code=400, detail="kind must be 'hard' or 'soft'.")
    s = Skill(
        name=name,
        category=payload.category.strip() or "General",
        kind=kind,
        description=payload.description.strip(),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "name": s.name, "category": s.category, "kind": s.kind}


@router.get("/{skill_id}/content")
def skill_content(skill_id: int, db: Session = Depends(get_db)):
    """What to learn for this skill — the linked trainings/courses/certs."""
    if not db.get(Skill, skill_id):
        raise HTTPException(status_code=404, detail="Skill not found")
    out = []
    for link in db.query(SkillLink).filter_by(skill_id=skill_id):
        resolved = _entity_title(db, link.entity_type, link.entity_id)
        if resolved:
            title, emoji = resolved
            out.append({
                "entity_type": link.entity_type,
                "entity_id": link.entity_id,
                "title": title,
                "emoji": emoji,
            })
    return out


@router.post("/{skill_id}/link", status_code=201)
def link_content(
    skill_id: int,
    payload: LinkRequest,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    viewer = db.get(Learner, payload.learner_id) if payload.learner_id else None
    if not _can_curate(viewer, x_admin_token):
        raise HTTPException(status_code=403, detail="Only curators can link content to skills.")
    if not db.get(Skill, skill_id):
        raise HTTPException(status_code=404, detail="Skill not found")
    if not _entity_title(db, payload.entity_type, payload.entity_id):
        raise HTTPException(status_code=404, detail="Content not found")
    exists = db.query(SkillLink).filter_by(
        skill_id=skill_id, entity_type=payload.entity_type, entity_id=payload.entity_id
    ).first()
    if not exists:
        db.add(SkillLink(skill_id=skill_id, entity_type=payload.entity_type, entity_id=payload.entity_id))
        db.commit()
    return {"ok": True}


@router.post("/{skill_id}/follow")
def follow_or_rate(skill_id: int, payload: FollowRequest, db: Session = Depends(get_db)):
    """Follow/unfollow a skill and/or set my 0-5 self-rating."""
    if not db.get(Skill, skill_id):
        raise HTTPException(status_code=404, detail="Skill not found")
    if not db.get(Learner, payload.learner_id):
        raise HTTPException(status_code=404, detail="Learner not found")
    ls = db.query(LearnerSkill).filter_by(learner_id=payload.learner_id, skill_id=skill_id).first()
    if not ls:
        ls = LearnerSkill(learner_id=payload.learner_id, skill_id=skill_id)
        db.add(ls)
    if payload.level is not None:
        ls.level = max(0, min(5, payload.level))
        ls.following = True
    if payload.following is not None:
        ls.following = payload.following
    db.commit()
    return {"skill_id": skill_id, "level": ls.level, "following": ls.following}


@router.get("/gap")
def gap_matrix(
    team_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The team skill matrix: members × skills with self-ratings, coverage and
    average — visible to the team's lead/manager, HR and admins."""
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    viewer = db.get(Learner, learner_id) if learner_id else None
    is_overseer = viewer is not None and viewer.id in (team.lead_id, team.manager_id)
    if not (is_overseer or _is_admin(viewer, x_admin_token)):
        raise HTTPException(status_code=403, detail="Only the team's lead/manager, HR or an admin can view the skill matrix.")

    members = db.query(Learner).filter(Learner.team_id == team.id).order_by(Learner.handle).all()
    member_ids = [m.id for m in members]
    ratings: dict[int, dict[int, int]] = defaultdict(dict)  # skill -> learner -> level
    if member_ids:
        for ls in db.query(LearnerSkill).filter(LearnerSkill.learner_id.in_(member_ids)):
            ratings[ls.skill_id][ls.learner_id] = ls.level

    rows = []
    for s in db.query(Skill).order_by(Skill.category, Skill.name):
        r = ratings.get(s.id, {})
        if not r:
            continue  # only skills someone in the team follows/rated
        levels = {m.id: r.get(m.id) for m in members}
        rated = [v for v in levels.values() if v]
        rows.append({
            "skill_id": s.id,
            "name": s.name,
            "category": s.category,
            "kind": s.kind,
            "levels": levels,
            "avg": round(sum(rated) / len(rated), 1) if rated else 0,
            "covered": sum(1 for v in rated if v >= 3),
        })
    return {
        "team": {"id": team.id, "name": team.name},
        "members": [{"id": m.id, "handle": m.handle, "name": m.name} for m in members],
        "skills": rows,
    }
