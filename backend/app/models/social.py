from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Comment(Base):
    """A comment on a piece of content (course or training)."""

    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # course | formation
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(String(1000), nullable=False)



class Engagement(Base):
    """A like or a share on content — one row per learner/entity/kind, so
    counts and HR activity KPIs fall out of simple aggregations."""

    __tablename__ = "engagements"
    __table_args__ = (
        UniqueConstraint("learner_id", "entity_type", "entity_id", "kind", name="uq_engagement"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # like | share


class Review(Base):
    """A learner's star rating (1-5) on a training/course — one row per
    learner/entity, so the average and feedback rate fall out of simple
    aggregations. Unlike Engagement, a review can be updated in place
    (re-rating changes the existing row instead of adding a new one)."""

    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("learner_id", "entity_type", "entity_id", name="uq_review"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    stars: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5

class ContentEditor(Base):
    """Who touched a course/training: the owner comes from the content itself;
    every saved edit upserts an editor row — HR sees owners AND contributors."""

    __tablename__ = "content_editors"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "learner_id", name="uq_content_editor"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    edits: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
