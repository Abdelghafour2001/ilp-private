import datetime as dt

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models import content_status


class Pathway(Base):
    """A curated, ordered journey mixing trainings, courses and certifications
    — e.g. "Data Analyst Onboarding". Assignable with a due date."""

    __tablename__ = "pathways"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="🧭")
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    created_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Same vocabulary as a course or a training. Pathways are curator-made, so
    # they need no review step — they default straight to published.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=content_status.PUBLISHED)
    # A mandatory pathway is expected of everyone it's assigned to (compliance,
    # onboarding); an optional one is offered. Steps carry their own flag too.
    mandatory: Mapped[bool] = mapped_column(nullable=False, default=False)

    # Given to every new recruit in scope on their first day, without anyone
    # having to remember. "Mandatory" says it must be finished; this says it
    # arrives on its own — a pathway can be either, both, or neither.
    auto_assign: Mapped[bool] = mapped_column(nullable=False, default=False)
    # Empty = everyone at the company. Otherwise the BU whose recruits get it,
    # so an AI & Data joiner lands with the company induction *and* their own
    # unit's path already waiting.
    audience_bu: Mapped[str] = mapped_column(String(80), nullable=False, default="")


class PathwayStep(Base):
    """One ordered step of a pathway, pointing at a piece of content.

    Two flags shape how the journey is walked:

    * `required` — a mandatory step (counts towards completion and blocks the
      steps gated behind it) versus an optional enrichment.
    * `milestone` — a checkpoint: nothing after it opens until every *required*
      step up to and including it is done. Without any milestone a pathway
      stays a free-order reading list, which is the pre-existing behaviour.
    """

    __tablename__ = "pathway_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pathway_id: Mapped[int] = mapped_column(
        ForeignKey("pathways.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # formation | course | certification
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    required: Mapped[bool] = mapped_column(nullable=False, default=True)
    milestone: Mapped[bool] = mapped_column(nullable=False, default=False)


class PathwayEnrollment(Base):
    """A learner walking (or assigned to) a pathway."""

    __tablename__ = "pathway_enrollments"
    __table_args__ = (UniqueConstraint("pathway_id", "learner_id", name="uq_pathway_learner"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pathway_id: Mapped[int] = mapped_column(
        ForeignKey("pathways.id", ondelete="CASCADE"), nullable=False
    )
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    assigned_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    due_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # Compliance vs suggestion. On the enrolment, not the Pathway: the same
    # pathway can be mandatory for one team and optional for another.
    mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
