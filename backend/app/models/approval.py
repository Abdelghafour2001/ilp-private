import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# A decision, once made, is kept. "Declined" with a reason is information the
# next request needs — deleting it would hide the fact that someone already
# asked and was told no, and why.
DECISIONS = ("pending", "approved", "declined")


class HrBuAssignment(Base):
    """Which BUs an HRBP is responsible for.

    Before this, an HRBP's perimeter was inferred from their own `bu` field,
    which meant one BU each and — worse — that an HRBP whose profile had no BU
    silently saw the entire organisation. An explicit assignment lets one HRBP
    cover several BUs and makes "no assignment" mean *nothing*, not everything.
    """

    __tablename__ = "hr_bu_assignments"
    __table_args__ = (UniqueConstraint("hr_id", "bu", name="uq_hr_bu"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hr_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bu: Mapped[str] = mapped_column(String(80), nullable=False)
    # Who set this up — an HR lead or an admin.
    assigned_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class BuHeadAssignment(Base):
    """Which BUs somebody heads.

    A BU head sits above the team managers: Mostapha heads AI & Data, which
    holds both the Data Practice and the AI Factory, each with its own manager.
    Modelled as an assignment table rather than a column on the BU (there is no
    BU table — a BU is a string on a person) and rather than a field on the
    person (one head can cover several BUs, and a BU can change hands without
    touching anyone's profile).
    """

    __tablename__ = "bu_head_assignments"
    __table_args__ = (UniqueConstraint("head_id", "bu", name="uq_bu_head"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    head_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bu: Mapped[str] = mapped_column(String(80), nullable=False)
    assigned_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class ApprovalStep(Base):
    """One stage in a request's approval chain.

    A training request no longer ends with the manager. It goes to the N+1
    first, then to the head of the requester's BU — the person who actually owns
    the budget line. Modelling the chain as rows rather than as two more columns
    on the request means a third stage is configuration, not a migration, and it
    keeps every decision (who, when, why) attached to the stage that was decided
    rather than flattened onto the request.

    Steps are created together when the request is raised, so the requester can
    see the whole path in front of their ask, not just the next hop.
    """

    __tablename__ = "approval_steps"
    __table_args__ = (
        UniqueConstraint("request_id", "position", name="uq_step_position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("training_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 1 = N+1 manager, 2 = BU head. Lower positions decide first.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Which role this stage belongs to: "manager" or "bu_head".
    stage: Mapped[str] = mapped_column(String(20), nullable=False, default="manager")

    # Resolved when the request is raised. NULL means nobody holds that job
    # right now — the stage is then reported as unassigned rather than silently
    # skipped, because a step nobody can take is a blocked request, not an
    # approved one.
    approver_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True, index=True
    )
    approver_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    note: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    decided_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class TrainingRequest(Base):
    """A collaborator asking to take a training or course.

    This is the approval the CR's "workflow d'approbation par le manager" is
    really about: someone wants a place on a paid or external programme and
    their manager decides. Keeping it as its own record — rather than just
    enrolling them — is what gives both sides something to track: the requester
    sees where their ask stands, the manager sees a queue and a history.
    """

    __tablename__ = "training_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # What they want. Exactly one of these is set.
    formation_id: Mapped[int | None] = mapped_column(
        ForeignKey("formations.id", ondelete="CASCADE"), nullable=True
    )
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=True
    )
    # Denormalised so a request stays readable after the content is deleted.
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Cost at the time of asking — a later price change shouldn't rewrite history.
    cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    decided_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    decided_by_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Required when declining: "no" without a reason is not a decision the
    # requester can act on.
    decision_note: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    decided_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Ordered chain, deleted with the request.
    steps: Mapped[list["ApprovalStep"]] = relationship(
        "ApprovalStep",
        cascade="all, delete-orphan",
        order_by="ApprovalStep.position",
        lazy="selectin",
    )
