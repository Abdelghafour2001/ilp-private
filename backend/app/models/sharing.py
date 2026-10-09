from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SharingSession(Base):
    """An archived knowledge-sharing presentation: a write-up plus the slide
    deck and an optional recording, so the team can review it later."""

    __tablename__ = "sharing_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    abstract: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    body_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    presenter: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    session_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Uploaded slide deck (stored filename + the original name for download).
    file_name: Mapped[str | None] = mapped_column(String, nullable=True)
    file_original_name: Mapped[str | None] = mapped_column(String, nullable=True)
    recording_url: Mapped[str | None] = mapped_column(String, nullable=True)

    author: Mapped[str] = mapped_column(String(80), nullable=False, default="anonymous")
    learner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
