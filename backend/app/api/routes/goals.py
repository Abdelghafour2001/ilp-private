"""Learning goals: what somebody is working towards, and how far along they are.

Progress is never typed in. A goal names skills and the levels it wants; how
close somebody is comes from the same `skill_state` the gap analysis already
uses, so the goal and the development plan can never disagree about where a
person stands.

The recommendation attached to each goal is deliberately thin — the content
already tagged against the skills that are short. Suggesting work for a gap
nobody has is how a learning platform starts recommending noise.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.notifier import notify
from app.core.rbac import oversight_scope
from app.core.skills import skill_state
from app.db.session import get_db
from app.models import Course, Formation, LearningGoal, Learner, Skill, SkillLink, content_status

router = APIRouter(prefix="/goals", tags=["skills"])

STATUSES = ("active", "achieved", "dropped")


class TargetIn(BaseModel):
    skill_id: int
    target: int


class GoalIn(BaseModel):
    learner_id: int          # whose goal it is
    title: str
    why: str = ""
    targets: list[TargetIn] = []
    due_date: dt.date | None = None
    author_id: int | None = None  # who is writing it, when not the owner


def _recommend(db: Session, skill_ids: list[int], limit: int = 4) -> list[dict]:
    """Published content tagged against the skills this goal is short on."""
    if not skill_ids:
        return []
    links = (
        db.query(SkillLink)
        .filter(SkillLink.skill_id.in_(skill_ids))
        .limit(60)
        .all()
    )
    out: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for link in links:
        key = (link.entity_type, link.entity_id)
        if key in seen:
            continue
        seen.add(key)
        if link.entity_type == "course":
            row = db.get(Course, link.entity_id)
            if row and row.status in content_status.VISIBLE:
                out.append({"kind": "course", "id": row.id, "title": row.title,
                            "link": f"/courses/{row.id}"})
        elif link.entity_type == "formation":
            row = db.get(Formation, link.entity_id)
            if row and row.status == content_status.PUBLISHED:
                out.append({"kind": "formation", "id": row.id, "title": row.title,
                            "link": f"/formations/{row.id}"})
        if len(out) >= limit:
            break
    return out


def _shape(db: Session, goal: LearningGoal, state: dict, catalog: dict) -> dict:
    """One goal, measured against where the person actually is."""
    targets, short = [], []
    reached = 0
    for entry in goal.targets or []:
        skill_id = int(entry.get("skill_id", 0))
        want = int(entry.get("target", 0))
        current = int((state.get(skill_id) or {}).get("level") or 0)
        done = current >= want
        reached += int(done)
        if not done:
            short.append(skill_id)
        targets.append({
            "skill_id": skill_id,
            "name": catalog[skill_id].name if skill_id in catalog else f"#{skill_id}",
            "current": current,
            "target": want,
            "gap": max(0, want - current),
            "reached": done,
        })

    total = len(targets)
    today = dt.date.today()
    return {
        "id": goal.id,
        "learner_id": goal.learner_id,
        "title": goal.title,
        "why": goal.why,
        "due_date": goal.due_date.isoformat() if goal.due_date else None,
        "overdue": bool(goal.due_date and goal.status == "active" and goal.due_date < today),
        "status": goal.status,
        "created_by": goal.created_by,
        "targets": targets,
        "reached": reached,
        "total": total,
        "percent": round(100 * reached / total) if total else 0,
        # The whole point of the loop: goal → gap → what to do about it.
        "recommended": _recommend(db, short),
    }


def _load(db: Session, learner: Learner) -> tuple[dict, dict]:
    return skill_state(db, learner), {s.id: s for s in db.query(Skill).all()}


@router.get("")
def list_goals(
    learner_id: int,
    viewer_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Somebody's goals. Their own always; anyone else's within your perimeter."""
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    if viewer_id and viewer_id != learner_id:
        viewer = db.get(Learner, viewer_id)
        if not oversight_scope(db, viewer, x_admin_token).allows(learner_id):
            raise HTTPException(
                status_code=403,
                detail="Only this person, their manager, HR or an admin can read these.",
            )

    state, catalog = _load(db, learner)
    goals = (
        db.query(LearningGoal)
        .filter(LearningGoal.learner_id == learner_id)
        .order_by(LearningGoal.status, LearningGoal.due_date.is_(None), LearningGoal.due_date)
        .all()
    )
    shaped = [_shape(db, g, state, catalog) for g in goals]
    return {
        "goals": shaped,
        "totals": {
            "active": sum(1 for g in shaped if g["status"] == "active"),
            "achieved": sum(1 for g in shaped if g["status"] == "achieved"),
            "overdue": sum(1 for g in shaped if g["overdue"]),
        },
    }


@router.post("", status_code=201)
def create_goal(
    payload: GoalIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Set a goal — your own, or one proposed to somebody you oversee."""
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    author = db.get(Learner, payload.author_id) if payload.author_id else None
    proposed = author is not None and author.id != learner.id
    if proposed and not oversight_scope(db, author, x_admin_token).allows(learner.id):
        raise HTTPException(
            status_code=403,
            detail="Only this person's manager, HR or an admin can set a goal for them.",
        )

    goal = LearningGoal(
        learner_id=learner.id,
        title=payload.title.strip()[:200],
        why=payload.why.strip(),
        targets=[t.model_dump() for t in payload.targets],
        due_date=payload.due_date,
        created_by=(author.name or author.handle) if proposed else "",
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)

    if proposed:
        notify(
            db,
            [learner.id],
            kind="goal",
            title=f"🎯 {goal.title}",
            body=(author.name or author.handle),
            link="/profile",
        )

    state, catalog = _load(db, learner)
    return _shape(db, goal, state, catalog)


class StatusIn(BaseModel):
    status: str
    learner_id: int


@router.post("/{goal_id}/status")
def set_status(
    goal_id: int,
    payload: StatusIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Mark a goal achieved or dropped. Only the person whose goal it is."""
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")
    goal = db.get(LearningGoal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if goal.learner_id != payload.learner_id:
        raise HTTPException(status_code=403, detail="This is not your goal.")
    goal.status = payload.status
    db.commit()
    learner = db.get(Learner, goal.learner_id)
    state, catalog = _load(db, learner)
    return _shape(db, goal, state, catalog)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, learner_id: int, db: Session = Depends(get_db)):
    goal = db.get(LearningGoal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if goal.learner_id != learner_id:
        raise HTTPException(status_code=403, detail="This is not your goal.")
    db.delete(goal)
    db.commit()
