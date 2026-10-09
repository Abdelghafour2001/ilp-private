"""labs: learners, completions, achievements

Revision ID: 0002_labs
Revises: 0001_initial
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_labs"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "learners",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("handle", sa.String(40), nullable=False, unique=True),
        sa.Column("xp", sa.Integer, nullable=False, server_default="0"),
        *_timestamps(),
    )

    op.create_table(
        "step_completions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lab_id", sa.String(100), nullable=False),
        sa.Column("step_id", sa.String(100), nullable=False),
        sa.Column("xp_awarded", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("learner_id", "lab_id", "step_id", name="uq_completion"),
        *_timestamps(),
    )

    op.create_table(
        "achievements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("badge_id", sa.String(50), nullable=False),
        sa.UniqueConstraint("learner_id", "badge_id", name="uq_achievement"),
        *_timestamps(),
    )


def downgrade() -> None:
    op.drop_table("achievements")
    op.drop_table("step_completions")
    op.drop_table("learners")
