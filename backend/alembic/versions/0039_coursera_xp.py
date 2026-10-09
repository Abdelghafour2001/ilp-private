"""Remember how much XP came from Coursera.

Granting XP for outside learning has to be repeatable: a second sync, or a
correction to the hours, must not stack another few hundred points on top.
Storing the amount this integration granted lets the next run replace it
instead of adding to it, and keeps the platform's own XP untouched.

Revision ID: 0039_coursera_xp
Revises:    0038_course_assignments
Create Date: 2026-09-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0039_coursera_xp"
down_revision: Union[str, None] = "0038_course_assignments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "learners",
        sa.Column("coursera_xp", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("learners", "coursera_xp")
