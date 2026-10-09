from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExternalEnrollment(Base):
    """What one person did on an outside learning platform.

    Kept provider-agnostic (`provider` is "coursera" today, Udemy or LinkedIn
    Learning tomorrow) so a second integration is a new sync job rather than a
    new table.

    `hours` may be either measured or estimated, and `hours_measured` says
    which. Coursera's enrollment report carries `approxTotalCourseHrs` — hours
    the learner actually spent — so for Coursera this is real time on task, not
    a guess from published course length. That distinction is the difference
    between a Jour-Homme figure that survives an HR review and one that does
    not, so it is stored rather than inferred.
    """

    __tablename__ = "external_enrollments"
    __table_args__ = (
        UniqueConstraint(
            "provider", "external_id", name="uq_external_enrollment_provider_id"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="coursera")
    # The provider's own record id, so a re-sync updates instead of duplicating.
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)

    # NULL when the provider's account could not be matched to anyone here —
    # the row is still stored so the mismatch is visible and countable rather
    # than silently dropped.
    learner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=True
    )
    matched_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    course_slug: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    course_title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Local Course row, when this maps onto something in our own catalog.
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )

    progress_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed: Mapped[bool] = mapped_column(nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hours: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # True when `hours` is time the provider says the learner actually spent;
    # False when it is our estimate from published course length.
    hours_measured: Mapped[bool] = mapped_column(nullable=False, default=False)

    content_type: Mapped[str] = mapped_column(String(40), nullable=False, default="Course")
    program_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Average score across graded work, when the provider reports one.
    grade: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Coursera hands back a certificate URL on completion — that is the
    # "certifications" half of the CR arriving for free.
    certificate_url: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    last_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    enrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # The provider's own view of the learner and the content. For most people
    # this is the only org data we have: they exist on Coursera long before they
    # sign in here, so `learner_id` is NULL while `business_unit` is not.
    full_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    partner_names: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    collection_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    contract_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    course_type: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    job_title: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    job_type: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    business_unit: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    business_unit_2: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    location_city: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    location_country: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    manager_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    manager_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class ExternalSpecialization(Base):
    """A provider's multi-course programme, and which courses it is made of.

    Coursera's enterprise enrolment report only ever reports `contentType:
    Course` — a specialization or professional certificate someone finished is
    reported as its member courses and nothing else. So the organisation pays
    for "IBM Data Engineering", people earn it, and HR has no way to see it.

    The public catalogue does know the shape: `courses.v1?fields=s12nIds` says
    which programmes contain a given course, and `onDemandSpecializations.v1`
    lists a programme's members. This table is a cache of that — the catalogue
    half, with no learner in it. Who earned what is *derived* by comparing a
    person's completions against `course_slugs`, which means it can never go
    stale against the enrolment data and needs no second sync.

    The derived answer never over-reports: every member course has to be
    complete. It can under-report, because a course taken outside the
    enterprise licence is absent from the feed entirely, and a programme missing
    one member looks unfinished. That is a limit of the feed, not of the join,
    and the person card states the partial count rather than hiding it.
    """

    __tablename__ = "external_specializations"
    __table_args__ = (
        UniqueConstraint("provider", "slug", name="uq_external_specialization_slug"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="coursera")
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    partner_names: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # A professional certificate and a specialization live on different URL
    # paths, so the link has to be stored rather than built from the slug.
    url: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    logo_url: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    # The member courses, by provider slug — the same key the enrolment rows
    # carry, so completion is a set comparison and nothing has to be matched
    # on a title.
    course_slugs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
