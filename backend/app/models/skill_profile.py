from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Where a rating came from. Ordered by how much weight it deserves — an exam
# result outranks a manager's judgement, which outranks a colleague's, which
# outranks your own opinion of yourself.
RATING_SOURCES = ("self", "peer", "manager", "assessment")
SOURCE_AUTHORITY = {"self": 0, "peer": 1, "manager": 2, "assessment": 3}


class SkillProfile(Base):
    """The skills a given role is expected to have, and at what level.

    Without a target, a skill matrix only says "Sara rated herself 3 at SQL",
    which is not actionable. With one it says "a Confirmé Data Analyst needs
    4, so there is a gap of 1" — which is a training plan.

    A profile can auto-apply to everyone matching a practice and/or job level,
    so the org axes you already collect do the work; an explicit assignment on
    the learner always wins over a match.
    """

    __tablename__ = "skill_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    # Optional matchers — blank means "don't filter on this axis".
    practice: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    job_level: Mapped[str] = mapped_column(String(80), nullable=False, default="")


class SkillProfileTarget(Base):
    """One expected level (1-5) for one skill inside a profile."""

    __tablename__ = "skill_profile_targets"
    __table_args__ = (
        UniqueConstraint("profile_id", "skill_id", name="uq_skill_profile_target"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("skill_profiles.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    target_level: Mapped[int] = mapped_column(Integer, nullable=False, default=3)


class SkillRating(Base):
    """One rating of one person's skill, from one source.

    `LearnerSkill.level` stays the learner's own self-rating so existing
    screens keep working; this table adds the corroborating opinions. Keeping
    every rating separately (rather than overwriting a single number) is the
    point: a level is only meaningful alongside who said so.
    """

    __tablename__ = "skill_ratings"
    __table_args__ = (
        # One rating per rater per skill per person. A rater re-rating updates
        # their own row instead of stacking duplicates. Assessments use a NULL
        # rater, so there is at most one assessment result per skill.
        UniqueConstraint(
            "learner_id", "skill_id", "source", "rater_id", name="uq_skill_rating"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Whose skill is being rated.
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 1-5
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="peer")
    # Who did the rating. NULL for an assessment (the system is the rater).
    rater_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    rater_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    note: Mapped[str] = mapped_column(String(400), nullable=False, default="")
