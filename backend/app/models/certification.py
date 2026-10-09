import datetime as dt

from sqlalchemy import Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Certification(Base):
    """A catalog entry: an external certification worth pursuing (DP-900, dbt…).

    Curated by trainers/leads/managers/admins so teams share one list instead
    of everyone hunting alone."""

    __tablename__ = "certifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="beginner")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Some certifications are contractually required by a client — those get
    # priority in the HR renewal view, since letting one lapse is a compliance
    # problem, not just a missed learning opportunity.
    client_required: Mapped[bool] = mapped_column(nullable=False, default=False)
    client_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # How long the certification stays valid; used to pre-fill (and sanity-check)
    # the expiry date when someone shares a certificate they earned. 0 = no expiry.
    validity_months: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    added_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class CertificationSuggestion(Base):
    """A Skill Lead's or manager's nudge: 'this certification fits our team' —
    or, when `target_id` is set instead of `team_id`, a personal recommendation
    to one specific learner."""

    __tablename__ = "certification_suggestions"
    __table_args__ = (
        UniqueConstraint("certification_id", "team_id", name="uq_cert_suggestion_team"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    certification_id: Mapped[int] = mapped_column(
        ForeignKey("certifications.id", ondelete="CASCADE"), nullable=False
    )
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), nullable=True
    )
    target_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=True
    )
    suggested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    suggested_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    note: Mapped[str] = mapped_column(String(400), nullable=False, default="")


class EarnedCertificate(Base):
    """A learner sharing a certificate they obtained — the recognition wall.

    `certification_id` links to the catalog when it matches; free-text title
    covers certs from outside the catalog. Proof is an uploaded file and/or a
    credential URL."""

    __tablename__ = "earned_certificates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    certification_id: Mapped[int | None] = mapped_column(
        ForeignKey("certifications.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    issuer: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    obtained_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    expires_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    credential_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Last expiry threshold (60/30/7) already announced, so the daily reminder
    # task fires each step once instead of every run. None = never reminded.
    last_reminder_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
