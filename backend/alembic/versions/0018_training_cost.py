"""training cost — integer MAD on formations and courses

Revision ID: 0018_training_cost
Revises: 0018_training_details
Create Date: 2026-07-20
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018_training_cost"
down_revision: Union[str, None] = "0018_training_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "formations",
        sa.Column("cost", sa.Integer, nullable=False, server_default="0"),
    )
    op.add_column(
        "courses",
        sa.Column("cost", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("courses", "cost")
    op.drop_column("formations", "cost")
