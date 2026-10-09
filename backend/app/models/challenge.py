from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Challenge(Base):
    """An open-innovation challenge: a brief the team rallies around, with
    submissions and upvoting to surface the best ideas."""

    __tablename__ = "challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    brief_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    theme: Mapped[str] = mapped_column(String(80), nullable=False, default="General")
    prize: Mapped[str | None] = mapped_column(String(255), nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")  # open | closed
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    author: Mapped[str] = mapped_column(String(80), nullable=False, default="anonymous")
    learner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )


class ChallengeSubmission(Base):
    """An idea/solution submitted to a challenge."""

    __tablename__ = "challenge_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    challenge_id: Mapped[int] = mapped_column(
        ForeignKey("challenges.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    body_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    link: Mapped[str | None] = mapped_column(String, nullable=True)

    author: Mapped[str] = mapped_column(String(80), nullable=False, default="anonymous")
    learner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )


class ChallengeVote(Base):
    """One upvote per learner per submission (idempotent)."""

    __tablename__ = "challenge_votes"
    __table_args__ = (UniqueConstraint("learner_id", "submission_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("challenge_submissions.id", ondelete="CASCADE"), nullable=False
    )
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
