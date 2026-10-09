"""gamification: streak fields + completion timestamps

Revision ID: 0008_gamification
Revises: 0007_learner_sso
Create Date: 2026-06-25

Idempotent: only adds columns that are actually missing. This survives a DB whose
tables were (re)created from the current models via `create_all` before Alembic
ran — otherwise the plain ADD COLUMN collides with an already-present column.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_gamification"
down_revision: Union[str, None] = "0007_learner_sso"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(table)}


def _add_missing(table: str, column: sa.Column) -> None:
    if column.name not in _existing_columns(table):
        op.add_column(table, column)


def _drop_existing(table: str, name: str) -> None:
    if name in _existing_columns(table):
        op.drop_column(table, name)


def upgrade() -> None:
    _add_missing("learners", sa.Column("current_streak", sa.Integer(), nullable=False, server_default="0"))
    _add_missing("learners", sa.Column("longest_streak", sa.Integer(), nullable=False, server_default="0"))
    _add_missing("learners", sa.Column("last_active_on", sa.Date(), nullable=True))
    _add_missing(
        "step_completions",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    _drop_existing("step_completions", "created_at")
    _drop_existing("learners", "last_active_on")
    _drop_existing("learners", "longest_streak")
    _drop_existing("learners", "current_streak")
