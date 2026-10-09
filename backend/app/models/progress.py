import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class StepCompletion(Base):
    """Records that a learner passed a specific lab step (idempotent per pair)."""

    __tablename__ = "step_completions"
    __table_args__ = (UniqueConstraint("learner_id", "lab_id", "step_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    lab_id: Mapped[str] = mapped_column(String(100), nullable=False)
    step_id: Mapped[str] = mapped_column(String(100), nullable=False)
    xp_awarded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    learner: Mapped["Learner"] = relationship(back_populates="completions")  # noqa: F821


class Achievement(Base):
    """A badge a learner has unlocked (idempotent per pair)."""

    __tablename__ = "achievements"
    __table_args__ = (UniqueConstraint("learner_id", "badge_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    badge_id: Mapped[str] = mapped_column(String(50), nullable=False)

    learner: Mapped["Learner"] = relationship(back_populates="achievements")  # noqa: F821
