import datetime as dt
import secrets

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def new_join_code() -> str:
    """Short, human-shareable code trainees can use to join a formation."""
    return secrets.token_urlsafe(6)


class Formation(Base):
    """An instructor-led training (a *formation*): theory + hands-on practice.

    The curriculum (modules → lessons) is JSONB so instructors can mix lesson
    types — articles, videos, quizzes, labs, and the interactive GenAI kinds
    (`prompt_playground`, `prompt_challenge`) — without schema churn. Trainees
    join by invitation, join code, or open enrollment.
    """

    __tablename__ = "formations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="beginner")
    emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="🎓")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    objectives: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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


    # Fiche formation: what to know before starting, and how it's delivered.
    prerequisites: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    format: Mapped[str] = mapped_column(String(20), nullable=False, default="elearning")
    # Declared length in hours. NULL means "use the computed one" (the sum of
    # lesson durations), which undersells anything taught mostly off-platform.
    duration_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    # HR reporting axis: built and run in-house, or bought from a provider.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="internal")  # internal | external
    provider: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # {"modules": [{"title": ..., "lessons": [{id,title,type,...}]}]}
    curriculum: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    trainer_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    trainer_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")  # draft | published | archived
    open_enrollment: Mapped[bool] = mapped_column(nullable=False, default=False)
    join_code: Mapped[str] = mapped_column(String(16), nullable=False, default=new_join_code)


class FormationEnrollment(Base):
    """A trainee's membership in a formation (invited → active → completed)."""

    __tablename__ = "formation_enrollments"
    __table_args__ = (UniqueConstraint("formation_id", "learner_id", name="uq_formation_learner"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    formation_id: Mapped[int] = mapped_column(
        ForeignKey("formations.id", ondelete="CASCADE"), nullable=False
    )
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="invited")  # invited | active | completed
    invited_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class FormationLessonCompletion(Base):
    """One trainee finishing one lesson. `data` keeps grading artifacts
    (challenge score, submitted prompt) so trainers can review real work."""

    __tablename__ = "formation_lesson_completions"
    __table_args__ = (
        UniqueConstraint("learner_id", "formation_id", "lesson_id", name="uq_formation_lesson"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    formation_id: Mapped[int] = mapped_column(
        ForeignKey("formations.id", ondelete="CASCADE"), nullable=False
    )
    lesson_id: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class FormationSession(Base):
    """A scheduled live event — kickoff, workshop, Q&A, exam, or a standalone
    open session on a theme.

    These power the "upcoming sessions" schedule so trainees (and Skill Leads)
    can see what's coming without opening every formation. `formation_id` is
    NULL for an open session that belongs to no particular formation."""

    __tablename__ = "formation_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    formation_id: Mapped[int | None] = mapped_column(
        ForeignKey("formations.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    location: Mapped[str] = mapped_column(String(255), nullable=False, default="")  # room or "Online"
    meeting_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    # --- open sessions with registration (sessions "for ALL") ---------------
    # Anyone may register, not just the parent formation's trainees.
    open_to_all: Mapped[bool] = mapped_column(nullable=False, default=False)
    # 0 = unlimited. Past capacity, registrations become "waitlisted".
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Registrations close at this instant (NULL = open until the session starts).
    registration_deadline: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Who runs THIS session — falls back to the formation's trainer when blank.
    trainer_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    trainer_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Free-text theme, so open sessions can be grouped/reported on.
    theme: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )


class SessionRegistration(Base):
    """One learner signing up for a session — and, afterwards, whether they
    actually showed up (the `présence` HR KPI).

    Capacity is enforced at registration time: the first `capacity` sign-ups
    are `registered`, the rest are `waitlisted` and promoted automatically when
    someone cancels."""

    __tablename__ = "session_registrations"
    __table_args__ = (
        UniqueConstraint("session_id", "learner_id", name="uq_session_registration"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("formation_sessions.id", ondelete="CASCADE"), nullable=False
    )
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="registered"
    )  # registered | waitlisted | cancelled
    # NULL until the trainer takes attendance — distinguishes "absent" from
    # "not marked yet", which matters for an honest attendance rate.
    attended: Mapped[bool | None] = mapped_column(nullable=True)
    marked_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
