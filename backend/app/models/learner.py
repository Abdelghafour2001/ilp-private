import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Learner(Base):
    """A lightweight learner profile — handle-based identity, no password yet.

    The browser stores the learner id locally; XP and progress accrue here so
    the leaderboard works without full auth. Real auth can layer on later.
    """

    __tablename__ = "learners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    handle: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Of `xp`, how much came from linked Coursera activity. Stored so a
    # re-link replaces that contribution instead of stacking another one.
    coursera_xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Daily activity streaks (updated when a step is passed).
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_active_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # The day this person last received the team digest. Enforced here rather
    # than by trusting the scheduler: a manager must not get two in a morning
    # because beat restarted.
    manager_digest_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)

    # Populated when the learner signs in via Azure SSO (else handle-only).
    azure_oid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)

    # Email + password sign-in, for people with no Entra account. Null means
    # this account has no password and cannot sign in that way — which is the
    # right default: a password nobody set is a password nobody chose.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # When it was last set. Every session issued before this moment is void, so
    # changing a password really does sign the other devices out.
    password_set_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set by somebody else, so it has to be replaced before the account is any
    # use. L&D opens testers in bulk and hands the password over in a chat;
    # this is what stops that message being a working key for ever.
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # Consecutive failures, and the lockout they earned.
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")  # user | trainer | manager | bu_head | hr | hr_lead | admin

    # The team this learner belongs to (tracked by its Skill Lead).
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )

    # Personal weekly learning goal in minutes (0 = no goal set).
    weekly_goal_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # HR org axes — editable by HR/admin only (matricule hidden from regular users).
    bu: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    practice: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    location: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    matricule: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    job_level: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    # The job title as it appears on the org chart ("Data Practice Manager").
    # Distinct from `job_level`, which is the HR grade, and from `role`, which
    # is what the platform lets the person do — three different questions that
    # were all being answered by `job_level` before.
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # First-connection assessment completed? (new accounts start False)
    onboarded: Mapped[bool] = mapped_column(nullable=False, default=False)

    # Preferred UI language, and the language of the emails/notifications we
    # generate for this person. "fr" | "en".
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="fr")

    # Explicit skill profile ("Data Analyst — Confirmé"). NULL falls back to
    # matching on practice/job_level, so most people need no manual setup.
    skill_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("skill_profiles.id", ondelete="SET NULL"), nullable=True
    )

    completions: Mapped[list["StepCompletion"]] = relationship(  # noqa: F821
        back_populates="learner", cascade="all, delete-orphan"
    )
    achievements: Mapped[list["Achievement"]] = relationship(  # noqa: F821
        back_populates="learner", cascade="all, delete-orphan"
    )
