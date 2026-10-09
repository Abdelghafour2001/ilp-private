"""courses + lesson completions

Revision ID: 0005_courses
Revises: 0004_assets
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_courses"
down_revision: Union[str, None] = "0004_assets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.String(600), nullable=False, server_default=""),
        sa.Column("level", sa.String(20), nullable=False, server_default="beginner"),
        sa.Column("emoji", sa.String(8), nullable=False, server_default="📚"),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("curriculum", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("author", sa.String(80), nullable=False, server_default="anonymous"),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("published", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "course_lesson_completions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "course_id",
            sa.Integer,
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lesson_id", sa.String(64), nullable=False),
        sa.UniqueConstraint("learner_id", "course_id", "lesson_id", name="uq_course_lesson"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("course_lesson_completions")
    op.drop_table("courses")
