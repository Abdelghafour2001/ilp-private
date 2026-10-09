import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Asset(Base):
    """A reusable piece of AI/data work shared by a team member — a notebook,
    code snippet, model/invention, dataset, or just an idea.

    The point is to "assetize" work so it's discoverable and reusable across the
    BU instead of living on one laptop. Submitted in-app (low friction); the
    author keeps a link to their learner identity.
    """

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # notebook | code | model | dataset | idea  (free-form; UI suggests a set)
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="idea")
    summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    body_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    code: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String, nullable=True)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    author: Mapped[str] = mapped_column(String(80), nullable=False, default="anonymous")
    learner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    # pending | approved | rejected — new assets start pending; migration
    # backfills existing rows to "approved" so the demo doesn't go empty.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reviewed_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
