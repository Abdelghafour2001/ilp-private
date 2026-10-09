"""Something handed to a named person, with a deadline and a reason.

Trainings already had this through `FormationEnrollment` — invited, active,
completed — but courses had nothing between "published" and "somebody happened
to open it". So a mandatory course could be declared mandatory and never given
to anyone, and nobody could answer "who still has to do it".

The assignment is deliberately separate from progress. Progress is
`CourseLessonCompletion`, which exists whether or not anyone asked for the
work; this row records that somebody *was* asked, by whom, and by when. Losing
that distinction is how a compliance report ends up counting volunteers.

It started as courses only, hence the table name. It now covers trainings and
pathways too, because "who still has to do this" is the same question whatever
kind of thing it is, and answering it three different ways is how the three
answers stop agreeing. Assigning to a team fans out to one row per member: a
team changes, and an obligation somebody was given should not vanish with it.
"""

import datetime as dt

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CourseAssignment(Base):
    __tablename__ = "course_assignments"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "learner_id", name="uq_assignment_target"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # "course" | "formation" | "pathway".
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False, default="course")
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    # Mandatory assignments are the ones a compliance report is about; an
    # optional one is a recommendation and is counted separately.
    mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    due_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    assigned_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    note: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    # The day the last reminder went out. Enforced here rather than trusting
    # the scheduler: beat restarts, retries and manual runs must not produce
    # three messages in an afternoon.
    last_reminded_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # --- accepted as done, by a human ------------------------------------
    # Some obligations are met outside anything the platform can see: a course
    # taken on Coursera outside the organisation's programmes never reaches the
    # enterprise report, whatever account it was taken on. Without this the row
    # stays red for ever, the person is reminded daily, and HR counts somebody
    # as non-compliant while their certificate sits two screens away.
    #
    # Nothing closes itself. L&D looks at the evidence and decides, and the
    # decision is recorded with the name attached — a compliance figure that
    # rests on a judgement must say whose judgement it was.
    accepted_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    accepted_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    accepted_note: Mapped[str] = mapped_column(String(400), nullable=False, default="")

    # Set when the assignment came from a team rather than a name, so the
    # tracking view can say "assigned with the team" instead of losing why.
    via_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )
