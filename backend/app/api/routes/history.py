"""One person's learning history, from every source at once.

A learner's record is currently scattered: trainings live in enrolments,
courses in lesson completions, labs in step completions, Coursera in external
enrolments, and anything declared by hand in learning records. Each screen
shows its own slice, so nobody — including the learner — can answer "what have
I actually done, and what is still open".

This is read-only and always about one person. It returns items in one shape
so the page can sort and filter the whole history together, rather than five
lists that cannot be compared.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import (
    Course,
    CourseAssignment,
    CourseLessonCompletion,
    EarnedCertificate,
    ExternalEnrollment,
    Formation,
    FormationEnrollment,
    FormationLessonCompletion,
    Learner,
    LearningRecord,
    StepCompletion,
)
from app.core import external_progress
from app.schemas.course import lesson_ids as course_lesson_ids
from app.schemas.formation import lesson_ids as formation_lesson_ids

router = APIRouter(prefix="/history", tags=["learners"])


def _status(done: int, total: int) -> str:
    if total and done >= total:
        return "completed"
    return "in_progress" if done else "not_started"


def _item(**fields) -> dict:
    """Every source fills the same shape, so the page can sort across them."""
    base = {
        "kind": "", "id": 0, "title": "", "status": "not_started", "percent": 0,
        "started_on": None, "completed_on": None, "hours": 0.0, "grade": None,
        "certificate": False, "mandatory": False, "due_date": None, "link": None,
        # Who asked for it, when somebody did. Blank for anything self-started.
        "assigned_by": "",
        "source": "aida", "detail": "",
        # For a catalogue entry done on a provider: whether the provider knows
        # this person at all, and where to go and sign up. 0% means two very
        # different things, and only one of them is the learner's to fix.
        "provider_enrolled": None,
        "provider_url": "",
    }
    base.update(fields)
    return base


@router.get("")
def history(learner_id: int, db: Session = Depends(get_db)):
    """Everything this learner has done or been asked to do."""
    learner = db.get(Learner, learner_id)
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    items: list[dict] = []

    # What somebody was *asked* to do, whatever kind it is. A training can be
    # mandatory because the catalogue says so, or because L&D handed it to this
    # person with a deadline — and only the second one can be late. Reading
    # just the catalogue flag meant an assigned training appeared here with no
    # deadline at all, so nothing on this page ever looked due.
    assigned = {
        (a.entity_type, a.entity_id): a
        for a in db.query(CourseAssignment).filter_by(learner_id=learner.id).all()
    }

    def obligation(kind: str, entity_id: int, fallback_mandatory: bool) -> dict:
        row = assigned.get((kind, entity_id))
        return {
            "mandatory": bool(row.mandatory) if row else fallback_mandatory,
            "due_date": row.due_date.isoformat() if row and row.due_date else None,
            "assigned_by": row.assigned_by if row else "",
        }

    # --- trainings ----------------------------------------------------------
    done_by_formation: dict[int, int] = {}
    for row in db.query(FormationLessonCompletion).filter_by(learner_id=learner.id):
        done_by_formation[row.formation_id] = done_by_formation.get(row.formation_id, 0) + 1

    for enrollment, formation in (
        db.query(FormationEnrollment, Formation)
        .join(Formation, Formation.id == FormationEnrollment.formation_id)
        .filter(FormationEnrollment.learner_id == learner.id)
        .all()
    ):
        total = len(formation_lesson_ids(formation.curriculum))
        # Lessons the trainee did on the provider count here as well, or a
        # training built around a Coursera course reads as untouched.
        on_provider = len(
            external_progress.done_lesson_ids(db, formation.curriculum, learner.id)
        )
        done = (
            total
            if enrollment.status == "completed"
            else min(total, done_by_formation.get(formation.id, 0) + on_provider)
        )
        items.append(_item(
            kind="training", id=formation.id, title=formation.title,
            status="completed" if enrollment.status == "completed" else _status(done, total),
            percent=round(100 * done / total) if total else 0,
            **obligation("formation", formation.id, bool(formation.mandatory)),
            link=f"/formations/{formation.id}",
            detail=enrollment.invited_by and f"invited by {enrollment.invited_by}" or "",
            started_on=enrollment.created_at.date().isoformat() if enrollment.created_at else None,
        ))

    # --- courses ------------------------------------------------------------
    done_by_course: dict[int, int] = {}
    for row in db.query(CourseLessonCompletion).filter_by(learner_id=learner.id):
        done_by_course[row.course_id] = done_by_course.get(row.course_id, 0) + 1

    assignments = {
        a.entity_id: a
        for a in db.query(CourseAssignment)
        .filter_by(learner_id=learner.id, entity_type="course")
        .all()
    }
    # Catalogue courses that are really provider courses, so the enrolment rows
    # below do not list the same course a second time with a different status.
    shown_externally: set[int] = set()
    shown_slugs: set[str] = set()
    # A course counts as history if they touched it or somebody assigned it.
    for course_id in set(done_by_course) | set(assignments):
        course = db.get(Course, course_id)
        if not course:
            continue
        total = len(course_lesson_ids(course.curriculum))
        done = done_by_course.get(course_id, 0)
        assignment = assignments.get(course_id)
        percent = round(100 * done / total) if total else 0
        status = _status(done, total)
        if course.external_url:
            # The work happens on the provider, so the provider's figure is the
            # progress — the same one the compliance board reads. Counting the
            # catalogue entry's (zero) lessons showed somebody half way through
            # an assigned course that their own page called "not started",
            # while L&D's board said 18%.
            provider_percent, completed = external_progress.state(db, course, learner.id)
            percent = 100 if completed else provider_percent
            status = "completed" if completed else _status(percent, 100)
            enrolled = external_progress.is_enrolled(db, course, learner.id)
            shown_externally.add(course.id)
            shown_slugs.add(external_progress.slug_from_url(course.external_url))
        items.append(_item(
            kind="course", id=course.id, title=course.title,
            status=status, percent=percent,
            provider_enrolled=enrolled if course.external_url else None,
            provider_url=course.external_url if course.external_url else "",
            mandatory=bool(assignment.mandatory if assignment else course.mandatory),
            due_date=assignment.due_date.isoformat() if assignment and assignment.due_date else None,
            link=f"/courses/{course.id}",
            detail=f"assigned by {assignment.assigned_by}" if assignment else "",
        ))

    # --- labs ---------------------------------------------------------------
    steps_by_lab: dict[str, list[StepCompletion]] = {}
    for row in db.query(StepCompletion).filter_by(learner_id=learner.id):
        steps_by_lab.setdefault(row.lab_id, []).append(row)
    for lab_id, rows in steps_by_lab.items():
        last = max((r.created_at for r in rows if r.created_at), default=None)
        items.append(_item(
            kind="lab", id=0, title=lab_id, status="in_progress",
            percent=0, link=f"/labs/{lab_id}",
            detail=f"{len(rows)} steps passed",
            completed_on=last.date().isoformat() if last else None,
        ))

    # --- Coursera -----------------------------------------------------------
    for row in db.query(ExternalEnrollment).filter_by(learner_id=learner.id).all():
        if row.course_id in shown_externally or (row.course_slug and row.course_slug in shown_slugs):
            # Already on the page as the assigned catalogue course, carrying the
            # deadline and who assigned it. Two rows for one course is how a
            # learner concludes the tracking is wrong.
            continue
        items.append(_item(
            kind="external", id=row.id, title=row.course_title or row.course_slug,
            status="completed" if row.completed else _status(row.progress_pct or 0, 100),
            percent=100 if row.completed else (row.progress_pct or 0),
            hours=round(row.hours or 0.0, 1),
            grade=round(100 * row.grade) if row.grade is not None else None,
            certificate=bool(row.certificate_url),
            started_on=row.enrolled_at.date().isoformat() if row.enrolled_at else None,
            completed_on=row.completed_at.date().isoformat() if row.completed_at else None,
            link=row.certificate_url or None,
            source=row.provider, detail=row.program_name or "",
        ))

    # --- declared learning --------------------------------------------------
    for record in db.query(LearningRecord).filter_by(learner_id=learner.id).all():
        items.append(_item(
            kind="declared", id=record.id, title=record.title, status="completed",
            percent=100, hours=round((record.minutes or 0) / 60, 1),
            completed_on=record.completed_on.isoformat() if record.completed_on else None,
            source="self", detail=record.provider or record.kind or "",
        ))

    certificates = [
        {
            "id": c.id, "title": c.title, "issuer": c.issuer,
            "obtained_on": c.obtained_on.isoformat() if c.obtained_on else None,
            "expires_on": c.expires_on.isoformat() if c.expires_on else None,
            "credential_url": c.credential_url,
        }
        for c in db.query(EarnedCertificate).filter_by(learner_id=learner.id).all()
    ]

    # Most recent first, and anything undated last rather than pretending it is old.
    items.sort(key=lambda i: (i["completed_on"] or i["started_on"] or "", i["title"]), reverse=True)

    today = dt.date.today().isoformat()
    return {
        "learner": {"id": learner.id, "handle": learner.handle, "name": learner.name, "xp": learner.xp},
        "totals": {
            "items": len(items),
            "completed": sum(1 for i in items if i["status"] == "completed"),
            "in_progress": sum(1 for i in items if i["status"] == "in_progress"),
            "not_started": sum(1 for i in items if i["status"] == "not_started"),
            "hours": round(sum(i["hours"] for i in items), 1),
            "certificates": len(certificates),
            "mandatory_open": sum(
                1 for i in items if i["mandatory"] and i["status"] != "completed"
            ),
            "overdue": sum(
                1 for i in items
                if i["due_date"] and i["status"] != "completed" and i["due_date"] < today
            ),
        },
        "items": items,
        "certificates": certificates,
    }
