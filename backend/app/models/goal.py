"""A learning goal somebody owns: what they are working towards, and by when.

Skills already carried a target — the level a role profile expects — and the
gap endpoint already compared that to where somebody is. What was missing is
the thing a person actually commits to: a named outcome with a date on it.

That distinction matters. A role profile is the organisation's expectation and
changes when the role does; a goal is the person's, survives a role change, and
is the thing a development conversation is actually about. Progress is computed
from the skills it names rather than typed in, so a goal cannot quietly drift
away from the evidence underneath it.
"""

import datetime as dt

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LearningGoal(Base):
    __tablename__ = "learning_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    why: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # [{"skill_id": 3, "target": 4}] — the levels this goal is asking for.
    targets: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    due_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # active | achieved | dropped. A dropped goal is kept: what somebody chose
    # not to pursue is part of the record, and deleting it loses the why.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # Set when a manager or L&D proposed it rather than the person themselves.
    created_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
