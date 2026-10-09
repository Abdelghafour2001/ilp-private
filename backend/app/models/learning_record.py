import datetime as dt

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# What someone can log. Deliberately broad: most real learning is not a course.
RECORD_KINDS = (
    "article",
    "book",
    "video",
    "podcast",
    "course",
    "conference",
    "mentoring",
    "on_the_job",
    "other",
)


class LearningRecord(Base):
    """Something a person learned, logged by them.

    The platform can only see what happens inside it — plus, now, Coursera.
    Everything else (an article, a book, a conference talk, an afternoon paired
    with a colleague) is invisible, and for most people that is where most of
    the learning actually happens. This is the escape hatch.

    `minutes` is self-declared. That is weaker evidence than a session register
    and stronger than nothing, so HR reporting keeps it in its own bucket
    rather than blending it silently into measured time.
    """

    __tablename__ = "learning_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="article")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    provider: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    completed_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)

    # The provider's own course slug, when this declaration is about a course
    # the provider knows. It is what makes a declared completion countable:
    # the specialization logic matches member courses by slug, so "I finished
    # Git and GitHub on my own account" can complete a programme the
    # enterprise feed only sees 9 of 10 of. Blank for a book or a conference.
    external_slug: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # A manager or Skill Lead can vouch for a record. Unverified records still
    # count — requiring approval would kill the habit — but HR can filter.
    #
    # Three states, not two: "pending" is nobody has looked, "declined" is
    # somebody looked and said no. Collapsing those loses the reason, and the
    # requester can't tell "not yet" from "no".
    review_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )  # pending | verified | declined
    review_note: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verified_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    verified_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class LearningRecordSkill(Base):
    """Which skills a logged record claims to develop.

    Separate from `SkillLink`, which says "this catalog content teaches X".
    A personal record is a claim about one person's learning, not about the
    catalog, and conflating the two would pollute content recommendations.
    """

    __tablename__ = "learning_record_skills"
    __table_args__ = (
        UniqueConstraint("record_id", "skill_id", name="uq_learning_record_skill"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(
        ForeignKey("learning_records.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
