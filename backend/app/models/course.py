import datetime as dt

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models import content_status


class Course(Base):
    """A structured, multi-lesson course (Udemy/LinkedIn-style).

    The curriculum (sections → lessons) is stored as JSONB so authors can mix
    lesson types — articles, videos, embedded interactive labs, and quizzes —
    without a rigid relational schema. Anyone can publish one.
    """

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="beginner")
    emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="📚")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Compliance: this programme is expected of the people it is assigned to,
    # and the catalogue says so on the card rather than only inside the page.
    # Kept separate from a pathway's `mandatory`: a training can be required on
    # its own without belonging to any pathway, and an optional pathway can
    # still contain a required step.
    mandatory: Mapped[bool] = mapped_column(nullable=False, default=False)
    # When true, 100% is only reached once the learner has left feedback. The
    # feedback becomes a real step in the progress bar rather than a nag: a
    # completion figure that ignores whether anyone reviewed the training is
    # exactly how a catalogue keeps a programme nobody rates.
    require_feedback: Mapped[bool] = mapped_column(nullable=False, default=False)


    # {"sections": [{"title": ..., "lessons": [{id,title,type,...}]}]}
    curriculum: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Card artwork. Blank = derive one from the course's own video content
    # (see app.core.covers); if nothing can be derived the UI falls back to a
    # provider-branded placeholder rather than a stock image.
    cover_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")

      # External catalog entries : a link instead of content.
    external_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    provider: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Provider-published course length in hours (e.g. Coursera's "workload").
    # 0 = unknown; used to value external learning in the HR KPIs.
    external_hours: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Subject, as the provider classifies it ("data-science" / "machine-learning").
    # Filtering a 800-entry catalogue needs a taxonomy, and inventing one from
    # titles would be a guess where the provider already publishes the answer.
    domain: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    subdomain: Mapped[str] = mapped_column(String(80), nullable=False, default="")

    author: Mapped[str] = mapped_column(String(80), nullable=False, default="anonymous")
    learner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    # A course starts as a draft and reaches the catalogue only once a curator
    # approves it. It used to be a boolean defaulting to True, which meant any
    # signed-in learner published straight into the catalogue.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=content_status.DRAFT)
    reviewed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CourseLessonCompletion(Base):
    """Tracks which lessons a learner has finished, for progress + resume."""

    __tablename__ = "course_lesson_completions"
    __table_args__ = (UniqueConstraint("learner_id", "course_id", "lesson_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    lesson_id: Mapped[str] = mapped_column(String(64), nullable=False)
