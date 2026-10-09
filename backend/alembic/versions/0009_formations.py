"""formations (instructor-led trainings) + enrollments + lesson completions

Revision ID: 0009_formations
Revises: 0008_gamification
Create Date: 2026-07-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_formations"
down_revision: Union[str, None] = "0008_gamification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "formations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.String(600), nullable=False, server_default=""),
        sa.Column("level", sa.String(20), nullable=False, server_default="beginner"),
        sa.Column("emoji", sa.String(8), nullable=False, server_default="🎓"),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("objectives", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("curriculum", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "trainer_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("trainer_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("open_enrollment", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("join_code", sa.String(16), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "formation_enrollments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "formation_id",
            sa.Integer,
            sa.ForeignKey("formations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="invited"),
        sa.Column("invited_by", sa.String(120), nullable=False, server_default=""),
        sa.UniqueConstraint("formation_id", "learner_id", name="uq_formation_learner"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "formation_lesson_completions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "formation_id",
            sa.Integer,
            sa.ForeignKey("formations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lesson_id", sa.String(64), nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.UniqueConstraint("learner_id", "formation_id", "lesson_id", name="uq_formation_lesson"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("formation_lesson_completions")
    op.drop_table("formation_enrollments")
    op.drop_table("formations")
