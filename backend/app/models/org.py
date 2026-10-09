"""The organisation itself, as data L&D can edit.

Until now a BU was a string typed onto each person. That is enough to group a
report by and nothing else: you cannot create a unit before it has staff, cannot
rename one without editing everybody in it, cannot record who runs it, and a
typo silently invents a new BU that then shows up in the org chart as real.

So the units get a table. `Learner.bu` stays a string — every report, export and
perimeter already reads it, and rewriting all of that to carry an id would be a
large change for no gain — but it is now expected to match a row here, and a
rename updates both sides in one transaction.

`parent_id` is present and unused today. The client's chart is two levels
(partner-level units, practices inside them) and practices are modelled as
teams; when a third level appears, it lands here rather than in a migration
written under time pressure.
"""

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BusinessUnit(Base):
    """A partner-level unit: AI & Data, Digital Forge, HR & Culture…"""

    __tablename__ = "business_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # The name people see, and the value stored on every learner in the unit.
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    # Short form for exports and charts, where the full name will not fit.
    code: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="")

    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_units.id", ondelete="SET NULL"), nullable=True
    )
    # Display order on the org chart. The client's chart has a deliberate
    # left-to-right order that alphabetical sorting destroys.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Archived rather than deleted: a closed BU still owns last year's training
    # hours, and deleting it would silently drop them out of every historical
    # report. Archived units are hidden from pickers, not from history.
    archived: Mapped[bool] = mapped_column(nullable=False, default=False)


class Practice(Base):
    """A métier inside a business unit: "CYBERSECURITY" under DOT.

    Until now a practice was free text on each learner, so the same team could
    be spelled three ways and nothing could offer a list to pick from. A
    registry makes the taxonomy real: the BU owns its practices, filters can be
    populated from them, and renaming one moves its people with it.

    Archived rather than deleted, for the same reason a BU is: a practice that
    closed still owns last year's training hours.
    """

    __tablename__ = "practices"
    __table_args__ = (UniqueConstraint("bu_id", "name", name="uq_practice_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bu_id: Mapped[int] = mapped_column(
        ForeignKey("business_units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Stored on every learner in it, so it is the join key as well as the label.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    archived: Mapped[bool] = mapped_column(nullable=False, default=False)
