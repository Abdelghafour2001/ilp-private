"""Give the two new tables the timestamps every model inherits.

`Base` declares `created_at` and `updated_at` on every table, so a hand-written
CREATE TABLE that omits them produces a mapper the database cannot satisfy —
the first query fails with `column approval_steps.created_at does not exist`.
Caught immediately on the first seed run rather than in front of anyone.

Revision ID: 0030_timestamps
Revises:    0029_bu_head
Create Date: 2026-09-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0030_timestamps"
down_revision: Union[str, None] = "0029_bu_head"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("approval_steps", "bu_head_assignments")


def upgrade() -> None:
    for table in TABLES:
        for column in ("created_at", "updated_at"):
            op.add_column(
                table,
                sa.Column(
                    column,
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                ),
            )


def downgrade() -> None:
    for table in TABLES:
        for column in ("created_at", "updated_at"):
            op.drop_column(table, column)
