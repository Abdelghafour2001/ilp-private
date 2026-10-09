"""Progress on catalogue entries the learner does somewhere else.

A Coursera course can sit in our catalogue, in a pathway and inside a training,
but the work happens on Coursera. Until now nothing read back: an external step
was hard-coded as "not done", so a pathway built out of provider courses could
never be finished and a mandatory one could never be reported on.

The provider does tell us — `ExternalEnrollment` carries the progress and the
completion for every enrolment it syncs. This module is the one place that
joins a catalogue row to those rows, so the answer is the same whether it is
asked by a pathway step, a training lesson or a tracking table.

Matching, in order of how much we trust it:

1. `course_id` — the sync already resolved this row onto our catalogue.
2. the slug in `external_url` — how the catalogue and the report name the same
   course when the sync has not matched them yet.

Titles are deliberately not matched on: two Coursera courses differ by a
subtitle more often than not, and a false match credits somebody with a course
they never took.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models import Course, ExternalEnrollment


def slug_from_url(url: str) -> str:
    """The provider's own course slug, from a catalogue link."""
    match = re.search(r"/(?:learn|specializations|professional-certificates)/([^/?#]+)", url)
    return match.group(1) if match else ""


def _rows(db: Session, course: Course, learner_id: int) -> list[ExternalEnrollment]:
    """This learner's enrolments in this catalogue entry, however they match."""
    rows = (
        db.query(ExternalEnrollment)
        .filter(ExternalEnrollment.learner_id == learner_id)
        .filter(ExternalEnrollment.course_id == course.id)
        .all()
    )
    slug = slug_from_url(course.external_url)
    if not rows and slug:
        rows = (
            db.query(ExternalEnrollment)
            .filter(ExternalEnrollment.learner_id == learner_id)
            .filter(ExternalEnrollment.course_slug == slug)
            .all()
        )
    return rows


def is_enrolled(db: Session, course: Course, learner_id: int) -> bool:
    """Does the provider know this person is taking this course at all?

    The distinction 0% hides: "enrolled and has not opened it" and "never
    signed up" look identical as a number, and they need opposite things from
    the learner — one is a nudge, the other is a link to the provider. A board
    that cannot tell them apart chases the wrong people.
    """
    return bool(_rows(db, course, learner_id))


def state(db: Session, course: Course, learner_id: int) -> tuple[int, bool]:
    """How far this learner got on this course, as the provider reports it.

    Returns (percent, completed). (0, False) covers both "not enrolled" and
    "enrolled, never opened" — ask `is_enrolled` when the difference matters.
    """
    rows = _rows(db, course, learner_id)
    if not rows:
        return 0, False
    # Somebody can be enrolled twice in the same content; the better attempt is
    # the one that counts.
    return max(r.progress_pct or 0 for r in rows), any(r.completed for r in rows)


def done_lesson_ids(db: Session, curriculum: dict, learner_id: int) -> set[str]:
    """The external-course lessons of a curriculum this learner has finished.

    Returned as lesson ids so a caller can add them to the rows it already has
    and keep counting the way it always did.
    """
    ids: set[str] = set()
    for module in curriculum.get("modules", []):
        for lesson in module.get("lessons", []):
            if lesson.get("type") != "external_course" or not lesson.get("course_id"):
                continue
            course = db.get(Course, lesson["course_id"])
            if course and state(db, course, learner_id)[1]:
                ids.add(lesson["id"])
    return ids
