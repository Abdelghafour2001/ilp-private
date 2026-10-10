import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core import manager_alerts
from app.core.config import settings
from app.core.covers import derive_cover
from app.core.tracking import track_editor
from app.api.routes.pathways import lock_reason
from app.core.email_template import Button, render_email
from app.core.i18n import tr
from app.core.mailer import send_email
from app.core.notifier import notify
from app.core.rbac import can_curate, is_platform_admin
from app.db.session import get_db
from app.models import Course, CourseAssignment, CourseLessonCompletion, Learner, PathwayStep
from app.models import content_status
from app.schemas.course import (
    CourseCreate,
    CourseOut,
    CourseSummary,
    lesson_ids,
    normalize_curriculum,
)

router = APIRouter(prefix="/courses", tags=["courses"])


def _summary(course: Course) -> CourseSummary:
    """Course summary with its cover resolved (explicit, derived, or blank)."""
    out = CourseSummary.model_validate(course, from_attributes=True)
    out.cover_url = derive_cover(
        cover_url=course.cover_url,
        external_url=course.external_url,
        curriculum=course.curriculum,
    )
    return out


@router.get("", response_model=list[CourseSummary])
def list_courses(
    q: str | None = None,
    mine: int | None = None,
    domain: str | None = None,
    provider: str | None = None,
    level: str | None = None,
    pathway: int | None = None,
    db: Session = Depends(get_db),
):
    """The catalogue: approved courses only.

    `mine` adds that learner's own drafts and anything they have submitted, so
    an author can find their work without it being on the catalogue yet. The
    rest narrow it — at 800+ entries the catalogue is only usable filtered.
    """
    visible = Course.status.in_(content_status.VISIBLE)
    if mine:
        visible = or_(visible, Course.learner_id == mine)
    query = db.query(Course).filter(visible)
    if domain:
        query = query.filter(Course.domain == domain)
    if provider:
        query = query.filter(Course.provider == provider)
    if level:
        query = query.filter(Course.level == level)
    if pathway:
        # The courses a curated journey is actually made of.
        ids = [
            row[0]
            for row in db.query(PathwayStep.entity_id)
            .filter(PathwayStep.pathway_id == pathway, PathwayStep.entity_type == "course")
            .all()
        ]
        query = query.filter(Course.id.in_(ids or [0]))
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Course.title.ilike(like), Course.summary.ilike(like)))
    return [_summary(c) for c in query.order_by(Course.id.desc()).all()]


@router.post("", response_model=CourseOut, status_code=201)
def create_course(payload: CourseCreate, db: Session = Depends(get_db)):
    author = payload.author
    if payload.learner_id:
        learner = db.get(Learner, payload.learner_id)
        if learner and not author:
            author = learner.handle

    course = Course(
        title=payload.title.strip(),
        summary=payload.summary.strip(),
        level=payload.level,
        emoji=payload.emoji or "📚",
        tags=payload.tags,
        curriculum=normalize_curriculum(payload.curriculum),
        external_url=payload.external_url.strip(),
        provider=payload.provider.strip(),
        cover_url=payload.cover_url.strip(),
        author=(author or "anonymous").strip(),
        learner_id=payload.learner_id,
        # Never from the payload: a course reaches the catalogue through review,
        # not by asking to be published.
        status=content_status.DRAFT,
        cost=max(0, payload.cost),
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: int, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    out = CourseOut.model_validate(course, from_attributes=True)
    out.cover_url = derive_cover(
        cover_url=course.cover_url,
        external_url=course.external_url,
        curriculum=course.curriculum,
    )
    return out


@router.put("/{course_id}", response_model=CourseOut)
def update_course(
    course_id: int,
    payload: CourseCreate,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not _can_edit(course, learner_id, x_admin_token, db):
        raise HTTPException(status_code=403, detail="Only the author or an admin can edit this.")

    course.title = payload.title.strip()
    course.summary = payload.summary.strip()
    course.level = payload.level
    course.emoji = payload.emoji or "📚"
    course.tags = payload.tags
    course.curriculum = normalize_curriculum(payload.curriculum)
    course.external_url = payload.external_url.strip()
    course.provider = payload.provider.strip()
    course.cover_url = payload.cover_url.strip()
    course.cost = max(0, payload.cost)
    # An approval has to mean the text on display. Editing published material
    # returns it to review, exactly as a reviewed asset does.
    if course.status == content_status.PUBLISHED and not can_curate(
        db.get(Learner, learner_id) if learner_id else None, x_admin_token
    ):
        course.status = content_status.PENDING
        course.reviewed_by = course.review_note = course.reviewed_at = None
    track_editor(db, "course", course.id, db.get(Learner, learner_id) if learner_id else None)
    db.commit()
    db.refresh(course)
    return course


@router.post("/{course_id}/submit")
def submit_for_review(
    course_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Hand a draft to the curators.

    A curator submitting their own course skips the queue: asking a trainer to
    wait for another trainer to approve the same material adds a step without
    adding a judgement.
    """
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not _can_edit(course, learner_id, x_admin_token, db):
        raise HTTPException(status_code=403, detail="Only the author or an admin can submit this.")
    if course.status not in (content_status.DRAFT, content_status.ARCHIVED):
        raise HTTPException(status_code=409, detail=f"Course is already {course.status}.")

    author = db.get(Learner, learner_id) if learner_id else None
    if can_curate(author, x_admin_token):
        course.status = content_status.PUBLISHED
        course.reviewed_by = (author.name or author.handle) if author else "admin"
        # Aware, like every other timestamp here: the approvals queue sorts
        # these against `created_at` and a naive one cannot be compared to it.
        course.reviewed_at = dt.datetime.now(dt.timezone.utc)
    else:
        course.status = content_status.PENDING
        curators = (
            db.query(Learner)
            .filter(Learner.role.in_(("trainer", "manager", "bu_head", "hr", "hr_lead", "admin")))
            .all()
        )
        notify(
            db,
            [c.id for c in curators],
            kind="approval",
            title=f"À relire — {course.title}",
            body=(author.name or author.handle) if author else course.author,
            link="/approvals",
        )
    db.commit()
    return {"status": course.status}


@router.delete("/{course_id}", status_code=204)
def delete_course(
    course_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not _can_edit(course, learner_id, x_admin_token, db):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this.")
    db.delete(course)
    db.commit()


@router.post("/{course_id}/lessons/{lesson_id}/complete")
def complete_lesson(
    course_id: int, lesson_id: str, learner_id: int, db: Session = Depends(get_db)
):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if lesson_id not in lesson_ids(course.curriculum):
        raise HTTPException(status_code=404, detail="Lesson not found")

    # A milestone in one of the learner's pathways can hold this course back.
    reason = lock_reason(db, learner_id, "course", course_id)
    if reason:
        raise HTTPException(status_code=423, detail=reason)

    exists = (
        db.query(CourseLessonCompletion)
        .filter_by(learner_id=learner_id, course_id=course_id, lesson_id=lesson_id)
        .first()
    )
    if not exists:
        db.add(
            CourseLessonCompletion(
                learner_id=learner_id, course_id=course_id, lesson_id=lesson_id
            )
        )
        db.flush()
        # This lesson was the last one: the manager hears about it once, at
        # the moment it happens. Re-opening a finished lesson changes nothing.
        total = set(lesson_ids(course.curriculum))
        done = {
            c.lesson_id
            for c in db.query(CourseLessonCompletion).filter_by(
                learner_id=learner_id, course_id=course_id
            )
        }
        learner = db.get(Learner, learner_id)
        if learner and total and total.issubset(done):
            manager_alerts.tell_manager(
                db, learner, kind="team_completion", key="team.done.course", title=course.title,
            )
        db.commit()
    return progress(course_id, learner_id, db)


@router.get("/{course_id}/progress")
def progress(course_id: int, learner_id: int, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    total = len(lesson_ids(course.curriculum))
    done = [
        c.lesson_id
        for c in db.query(CourseLessonCompletion).filter_by(
            learner_id=learner_id, course_id=course_id
        )
    ]
    return {
        "total": total,
        "completed": done,
        "percent": round(100 * len(done) / total) if total else 0,
    }


def _can_edit(course: Course, learner_id: int | None, token: str | None,
              db: Session | None = None) -> bool:
    """The author, or a platform admin by any of the ways in.

    This used to recognise an admin only by the server's admin token, so an
    administrator signed in normally — with SSO or a password — could not touch
    anybody else's course. The role is what makes somebody an admin; the token
    is one way of proving it, not the definition.
    """
    if settings.admin_token and token == settings.admin_token:
        return True
    if course.learner_id is not None and course.learner_id == learner_id:
        return True
    if db is not None and learner_id:
        return is_platform_admin(db.get(Learner, learner_id))
    return False


# --------------------------------------------------------------------------- #
# Assignment and tracking                                                     #
# --------------------------------------------------------------------------- #
# Publishing a course makes it available; assigning it makes it somebody's.
# Only the second one can be followed up, which is what a mandatory programme
# needs — "assigned to 40 people, 12 finished, 6 overdue" rather than "40 people
# could have taken it".


class AssignIn(BaseModel):
    """People are named by handle or email, as they are on an invitation."""

    people: list[str] = []
    mandatory: bool = True
    due_date: dt.date | None = None
    note: str = ""
    learner_id: int | None = None


def _assigner(db: Session, learner_id: int | None, token: str | None) -> Learner | None:
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not can_curate(viewer, token):
        raise HTTPException(
            status_code=403,
            detail="Only a trainer, manager, BU head, HR or an admin can assign a course.",
        )
    return viewer


@router.post("/{course_id}/assign")
def assign_course(
    course_id: int,
    payload: AssignIn,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Give a course to named people, and tell them."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    viewer = _assigner(db, payload.learner_id, x_admin_token)
    assigner = (viewer.name or viewer.handle) if viewer else "L&D"

    assigned, skipped = [], []
    for raw in payload.people:
        needle = raw.strip()
        if not needle:
            continue
        learner = (
            db.query(Learner)
            .filter((Learner.handle.ilike(needle)) | (Learner.email.ilike(needle)))
            .first()
        )
        if not learner:
            skipped.append({"who": needle, "reason": "No learner with that handle or email."})
            continue
        existing = (
            db.query(CourseAssignment)
            .filter_by(entity_type="course", entity_id=course.id, learner_id=learner.id)
            .first()
        )
        if existing:
            # Re-assigning is how a deadline gets moved, so update rather than
            # refuse — but say so, instead of reporting a new assignment.
            existing.mandatory = payload.mandatory
            existing.due_date = payload.due_date
            existing.note = payload.note.strip()
            skipped.append({"who": learner.handle, "reason": "Already assigned — deadline updated."})
            continue

        db.add(CourseAssignment(
            entity_type="course",
            entity_id=course.id,
            learner_id=learner.id,
            mandatory=payload.mandatory,
            due_date=payload.due_date,
            assigned_by=assigner,
            note=payload.note.strip(),
        ))
        assigned.append(learner.handle)

        due = f" — à faire avant le {payload.due_date:%d/%m/%Y}" if payload.due_date else ""
        notify(
            db, [learner.id],
            kind="assignment",
            title=tr(learner, "assign.course.title", title=course.title),
            body=tr(
                learner,
                "assign.course.mandatory" if payload.mandatory else "assign.course.optional",
                who=assigner,
            ) + due,
            link=f"/courses/{course.id}",
        )
        if learner.email:
            link = f"{settings.frontend_origin}/courses/{course.id}"
            blocks: list = [
                ("p", tr(learner, "assign.greeting", who=learner.name or learner.handle)),
                ("p", tr(
                    learner,
                    "assign.course.body.mandatory" if payload.mandatory else "assign.course.body.optional",
                    who=assigner, title=course.title,
                )),
            ]
            if payload.due_date:
                blocks.append(("stats", [(tr(learner, "assign.due"), f"{payload.due_date:%d/%m/%Y}")]))
            if payload.note.strip():
                blocks.append(("note", payload.note.strip()))
            html, text = render_email(
                heading=course.title,
                preheader=tr(learner, "assign.course.title", title=course.title),
                blocks=blocks,
                button=Button(tr(learner, "assign.cta"), link),
                footer_note=tr(learner, "assign.footer", who=assigner),
            )
            send_email(learner.email, f"[UpSkill] {course.title}", html, text)

    db.commit()
    return {"assigned": assigned, "skipped": skipped}


@router.get("/{course_id}/tracking")
def course_tracking(
    course_id: int,
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Who was asked to do this course, and where each of them got to."""
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assigner(db, learner_id, x_admin_token)

    total_lessons = len(lesson_ids(course.curriculum))
    rows = (
        db.query(CourseAssignment, Learner)
        .join(Learner, Learner.id == CourseAssignment.learner_id)
        .filter(CourseAssignment.entity_type == "course", CourseAssignment.entity_id == course.id)
        .all()
    )
    done_by_learner: dict[int, int] = {}
    for completion in db.query(CourseLessonCompletion).filter_by(course_id=course.id):
        done_by_learner[completion.learner_id] = done_by_learner.get(completion.learner_id, 0) + 1

    today = dt.date.today()
    people = []
    for assignment, learner in rows:
        done = done_by_learner.get(learner.id, 0)
        percent = round(100 * done / total_lessons) if total_lessons else 0
        complete = total_lessons > 0 and done >= total_lessons
        people.append({
            "learner_id": learner.id,
            "handle": learner.handle,
            "name": learner.name or learner.handle,
            "email": learner.email,
            "bu": learner.bu,
            "mandatory": assignment.mandatory,
            "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
            "assigned_by": assignment.assigned_by,
            "assigned_on": assignment.created_at.date().isoformat() if assignment.created_at else None,
            "lessons_done": done,
            "lessons_total": total_lessons,
            "percent": percent,
            "status": "completed" if complete else ("in_progress" if done else "not_started"),
            # Overdue is about the deadline passing, not about being slow.
            "overdue": bool(
                assignment.due_date and not complete and assignment.due_date < today
            ),
        })
    people.sort(key=lambda p: (p["status"] != "not_started", -p["percent"], p["name"]))

    return {
        "course": {"id": course.id, "title": course.title, "mandatory": course.mandatory,
                   "lessons": total_lessons},
        "summary": {
            "assigned": len(people),
            "completed": sum(1 for p in people if p["status"] == "completed"),
            "in_progress": sum(1 for p in people if p["status"] == "in_progress"),
            "not_started": sum(1 for p in people if p["status"] == "not_started"),
            "overdue": sum(1 for p in people if p["overdue"]),
        },
        "people": people,
    }
