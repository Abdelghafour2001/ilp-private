"""What the first-connection wizard offers a newcomer.

The role focuses and weekly goals used to be a Python dict in the onboarding
route. That made the first thing every employee ever sees on the platform the
one thing L&D could not change without a developer and a deploy — and it is
exactly the part they want to tune, because the right list of "what describes
you best" depends on who is being onboarded that quarter.

Labels are stored per-language rather than through the UI dictionary: these are
content, written by L&D in their own words, not interface chrome. A missing
translation falls back to the other language rather than showing a blank.
"""

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OnboardingRole(Base):
    """One "what describes you best?" choice in step 1."""

    __tablename__ = "onboarding_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable across renames: `completeOnboarding` stores it, and analytics
    # group on it, so editing a label must not orphan past answers.
    key: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    label_fr: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    label_en: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Retired rather than deleted: past learners still carry the key.
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class OnboardingRoleSkill(Base):
    """A skill preselected in step 2 when the newcomer picks that role."""

    __tablename__ = "onboarding_role_skills"
    __table_args__ = (
        UniqueConstraint("role_id", "skill_id", name="uq_onboarding_role_skill"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(
        ForeignKey("onboarding_roles.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )


class OnboardingGoal(Base):
    """One weekly-time option in step 3."""

    __tablename__ = "onboarding_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    minutes: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    label_fr: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    label_en: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
