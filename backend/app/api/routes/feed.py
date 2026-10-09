"""The "For You" feed — everything relevant to one learner in one call:
weekly goal progress, pending invites, personal recommendations, upcoming
sessions, pathway progress, and what the team has been up to.
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import (
    CertificationSuggestion,
    Certification,
    Comment,
    Course,
    CourseLessonCompletion,
    EarnedCertificate,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    FormationSession,
    Learner,
    Pathway,
    PathwayEnrollment,
    StepCompletion,
)
from app.api.routes.pathways import _pathway_out
from app.schemas.formation import iter_lessons

router = APIRouter(prefix="/feed", tags=["feed"])

COURSE_LESSON_MIN = 6
LAB_STEP_MIN = 5


class GoalRequest(BaseModel):
    learner_id: int
    minutes: int  # 0 clears the goal


@router.post("/goal")
def set_goal(payload: GoalRequest, db: Session = Depends(get_db)):
    learner = db.get(Learner, payload.learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")
    learner.weekly_goal_min = max(0, min(payload.minutes, 24 * 60))
    db.commit()
    return {"weekly_goal_min": learner.weekly_goal_min}


def _week_minutes(db: Session, learner_id: int) -> int:
    """Estimated learning minutes since Monday (same estimates as HR analytics)."""
    today = dt.datetime.now(dt.timezone.utc)
    monday = (today - dt.timedelta(days=today.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    minutes = LAB_STEP_MIN * (
        db.query(StepCompletion)
        .filter(StepCompletion.learner_id == learner_id, StepCompletion.created_at >= monday)
        .count()
    )
    minutes += COURSE_LESSON_MIN * (
        db.query(CourseLessonCompletion)
        .filter(
            CourseLessonCompletion.learner_id == learner_id,
            CourseLessonCompletion.created_at >= monday,
        )
        .count()
    )
    rows = (
        db.query(FormationLessonCompletion)
        .filter(
            FormationLessonCompletion.learner_id == learner_id,
            FormationLessonCompletion.created_at >= monday,
        )
        .all()
    )
    if rows:
        durations: dict[int, dict[str, int]] = {}
        for f in db.query(Formation).filter(Formation.id.in_({r.formation_id for r in rows})):
            durations[f.id] = {l["id"]: l.get("duration_min", 5) for l in iter_lessons(f.curriculum)}
        for r in rows:
            minutes += durations.get(r.formation_id, {}).get(r.lesson_id, 5)
    return minutes


@router.get("/me")
def my_feed(learner_id: int, db: Session = Depends(get_db)):
    me = db.get(Learner, learner_id)
    if not me:
        raise HTTPException(status_code=404, detail="Learner not found")
    now = dt.datetime.now(dt.timezone.utc)

    # pending invitations / assignments
    pending = []
    for enr, f in (
        db.query(FormationEnrollment, Formation)
        .join(Formation, FormationEnrollment.formation_id == Formation.id)
        .filter(FormationEnrollment.learner_id == me.id, FormationEnrollment.status == "invited")
    ):
        pending.append({
            "formation_id": f.id, "title": f.title, "emoji": f.emoji,
            "invited_by": enr.invited_by, "link": f"/formations/{f.id}",
        })

    # personal certification recommendations
    recommendations = [
        {"certification": c.name, "note": s.note, "by": s.suggested_by_name, "link": "/certifications"}
        for s, c in (
            db.query(CertificationSuggestion, Certification)
            .join(Certification, CertificationSuggestion.certification_id == Certification.id)
            .filter(CertificationSuggestion.target_id == me.id)
        )
    ]

    # upcoming sessions (next 7 days) for formations I'm part of
    my_fids = [
        e.formation_id
        for e in db.query(FormationEnrollment).filter(
            FormationEnrollment.learner_id == me.id,
            FormationEnrollment.status.in_(("active", "completed", "invited")),
        )
    ]
    upcoming = []
    if my_fids:
        for s, f in (
            db.query(FormationSession, Formation)
            .join(Formation, FormationSession.formation_id == Formation.id)
            .filter(
                FormationSession.formation_id.in_(my_fids),
                FormationSession.starts_at >= now,
                FormationSession.starts_at <= now + dt.timedelta(days=7),
            )
            .order_by(FormationSession.starts_at)
        ):
            upcoming.append({
                "title": s.title, "formation": f.title, "emoji": f.emoji,
                "starts_at": s.starts_at, "location": s.location, "link": "/schedule",
            })

    # my pathways
    pathways = [
        _pathway_out(db, p, me.id)
        for p, _ in (
            db.query(Pathway, PathwayEnrollment)
            .join(PathwayEnrollment, PathwayEnrollment.pathway_id == Pathway.id)
            .filter(PathwayEnrollment.learner_id == me.id)
        )
    ]

    # team activity: certificates + comments from teammates (last 8)
    activity = []
    if me.team_id:
        mates = {
            l.id: l for l in db.query(Learner).filter(
                Learner.team_id == me.team_id, Learner.id != me.id
            )
        }
        if mates:
            for e in (
                db.query(EarnedCertificate)
                .filter(EarnedCertificate.learner_id.in_(mates))
                .order_by(EarnedCertificate.id.desc())
                .limit(4)
            ):
                who = mates[e.learner_id]
                activity.append({
                    "kind": "cert",
                    "text": f"{who.name or who.handle} earned {e.title}",
                    "at": e.created_at, "link": "/certifications",
                })
            for c in (
                db.query(Comment)
                .filter(Comment.learner_id.in_(mates))
                .order_by(Comment.id.desc())
                .limit(4)
            ):
                who = mates[c.learner_id]
                link = f"/formations/{c.entity_id}" if c.entity_type == "formation" else f"/courses/{c.entity_id}"
                activity.append({
                    "kind": "comment",
                    "text": f"{who.name or who.handle}: “{c.body[:80]}”",
                    "at": c.created_at, "link": link,
                })
            activity.sort(key=lambda a: a["at"], reverse=True)
            activity = activity[:6]

    return {
        "goal": {"weekly_goal_min": me.weekly_goal_min, "done_min": _week_minutes(db, me.id)},
        "pending": pending,
        "recommendations": recommendations,
        "upcoming": upcoming,
        "pathways": pathways,
        "team_activity": activity,
    }
