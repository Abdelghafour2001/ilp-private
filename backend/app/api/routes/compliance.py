"""Who was asked to do the mandatory work, and where they got to.

Two sources, one question. A training tracks its people through
`FormationEnrollment`; a course through `CourseAssignment`. Neither on its own
answers "is the mandatory programme done", because a BU rarely has all of its
obligations in one format.

Only *assigned* people are counted. Someone who took a mandatory course nobody
gave them is a volunteer, and counting volunteers as compliance is how a report
comes out green while the obligation is unmet.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.rbac import can_read_reporting, oversight_scope
from app.db.session import get_db
from app.models import (
    Course,
    CourseAssignment,
    CourseLessonCompletion,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    Learner,
)
from app.core import external_progress
from app.schemas.course import lesson_ids as course_lesson_ids
from app.schemas.formation import lesson_ids as formation_lesson_ids

router = APIRouter(prefix="/compliance", tags=["analytics"])


def _viewer(db: Session, learner_id: int | None, token: str | None) -> Learner | None:
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not can_read_reporting(viewer, token):
        raise HTTPException(status_code=403, detail="HR, L&D or an admin only.")
    return viewer


def _person(learner: Learner, done: int, total: int, due: dt.date | None,
            assigned_by: str, today: dt.date) -> dict:
    complete = total > 0 and done >= total
    return {
        "learner_id": learner.id,
        "name": learner.name or learner.handle,
        "email": learner.email,
        "bu": learner.bu,
        "done": done,
        "total": total,
        "percent": round(100 * done / total) if total else 0,
        "status": "completed" if complete else ("in_progress" if done else "not_started"),
        "due_date": due.isoformat() if due else None,
        "overdue": bool(due and not complete and due < today),
        "assigned_by": assigned_by,
    }


@router.get("/mandatory")
def mandatory(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Every mandatory programme with an assignment, and its follow-up."""
    viewer = _viewer(db, learner_id, x_admin_token)
    scope = oversight_scope(db, viewer, x_admin_token)
    today = dt.date.today()

    programmes: list[dict] = []

    # --- courses ------------------------------------------------------------
    course_done: dict[tuple[int, int], int] = {}
    for row in db.query(CourseLessonCompletion):
        key = (row.course_id, row.learner_id)
        course_done[key] = course_done.get(key, 0) + 1

    for course in db.query(Course).all():
        rows = (
            db.query(CourseAssignment, Learner)
            .join(Learner, Learner.id == CourseAssignment.learner_id)
            .filter(CourseAssignment.entity_type == "course",
                CourseAssignment.entity_id == course.id,
                CourseAssignment.mandatory.is_(True),)
            .all()
        )
        rows = [(a, l) for a, l in rows if scope.allows(l.id)]
        if not rows:
            continue
        # An external course counts as one step, done or not: it has no
        # lessons here, so counting lessons put everybody at zero.
        external = bool(course.external_url)
        total = 1 if external else len(course_lesson_ids(course.curriculum))
        if external:
            course_done.update({
                (course.id, learner.id): int(external_progress.state(db, course, learner.id)[1])
                for _, learner in rows
            })
        programmes.append({
            "kind": "course",
            "id": course.id,
            "title": course.title,
            "people": [
                _person(learner, course_done.get((course.id, learner.id), 0), total,
                        assignment.due_date, assignment.assigned_by, today)
                for assignment, learner in rows
            ],
        })

    # --- trainings ----------------------------------------------------------
    formation_done: dict[tuple[int, int], int] = {}
    for row in db.query(FormationLessonCompletion):
        key = (row.formation_id, row.learner_id)
        formation_done[key] = formation_done.get(key, 0) + 1

    for formation in db.query(Formation).filter(Formation.mandatory.is_(True)).all():
        rows = (
            db.query(FormationEnrollment, Learner)
            .join(Learner, Learner.id == FormationEnrollment.learner_id)
            .filter(FormationEnrollment.formation_id == formation.id)
            .all()
        )
        rows = [(e, l) for e, l in rows if scope.allows(l.id)]
        if not rows:
            continue
        total = len(formation_lesson_ids(formation.curriculum))
        people = []
        for enrollment, learner in rows:
            done = formation_done.get((formation.id, learner.id), 0) + len(
                external_progress.done_lesson_ids(db, formation.curriculum, learner.id)
            )
            done = min(done, total)
            if enrollment.status == "completed":
                done = total
            people.append(_person(learner, done, total, None, enrollment.invited_by or "", today))
        programmes.append({
            "kind": "formation",
            "id": formation.id,
            "title": formation.title,
            "people": people,
        })

    for programme in programmes:
        people = programme["people"]
        programme["summary"] = {
            "assigned": len(people),
            "completed": sum(1 for p in people if p["status"] == "completed"),
            "in_progress": sum(1 for p in people if p["status"] == "in_progress"),
            "not_started": sum(1 for p in people if p["status"] == "not_started"),
            "overdue": sum(1 for p in people if p["overdue"]),
            "rate": round(100 * sum(1 for p in people if p["status"] == "completed") / len(people)),
        }
    programmes.sort(key=lambda p: (p["summary"]["rate"], -p["summary"]["assigned"]))

    everyone = [p for programme in programmes for p in programme["people"]]
    return {
        "scope": scope.label,
        "programmes": programmes,
        "totals": {
            "programmes": len(programmes),
            "assignments": len(everyone),
            "people": len({p["learner_id"] for p in everyone}),
            "completed": sum(1 for p in everyone if p["status"] == "completed"),
            "overdue": sum(1 for p in everyone if p["overdue"]),
            "rate": round(100 * sum(1 for p in everyone if p["status"] == "completed") / len(everyone))
            if everyone else 0,
        },
    }
