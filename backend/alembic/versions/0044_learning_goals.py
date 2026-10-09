"""A goal somebody owns, with a date on it.

Role profiles already said what a role expects, and the gap endpoint already
measured the distance. Neither is a commitment: a profile changes when the role
does, and nobody agrees a deadline with a profile. This is the piece a
development conversation is actually about.

Revision ID: 0044_learning_goals
Revises: 0043_assignments_and_attempts
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0044_learning_goals"
down_revision = "0043_assignments_and_attempts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("why", sa.Text(), nullable=False, server_default=""),
        sa.Column("targets", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_learning_goals_learner_id", "learning_goals", ["learner_id"])


def downgrade() -> None:
    op.drop_index("ix_learning_goals_learner_id", table_name="learning_goals")
    op.drop_table("learning_goals")
