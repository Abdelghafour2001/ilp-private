"""Every attempt at a graded exercise, not only the ones that worked.

A completion row is written when a trainee passes. That answers "did they get
there" and nothing else: a person who passed first time and a person who passed
on their sixth try are the same row. So "how many failed attempts" — the
question L&D asks when it wants to know whether a training is too hard or
somebody is stuck — could not be answered at all.

This records the attempt itself. It is append-only: attempts are evidence, and
editing evidence to make a report look better is the failure mode worth
designing against.
"""

import datetime as dt

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AssessmentAttempt(Base):
    __tablename__ = "assessment_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # What was attempted. `formation` and `lab` are the two graded surfaces.
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    lesson_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="challenge")

    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Out of 100. Null where the grader returns a verdict rather than a mark.
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    pass_mark: Mapped[float | None] = mapped_column(Float, nullable=True)
    attempted_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: dt.datetime.now(dt.timezone.utc)
    )
