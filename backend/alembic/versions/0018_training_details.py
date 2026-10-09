"""fiche formation: prerequisites + format (F-01)

Revision ID: 0018_training_details
Revises: 0017_onboarding
Create Date: 2026-07-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018_training_details"
down_revision: Union[str, None] = "0017_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "formations",
        sa.Column("prerequisites", sa.String(1000), nullable=False, server_default=""),
    )
    # in_person | virtual | hybrid | elearning — self-paced content is the default
    op.add_column(
        "formations",
        sa.Column("format", sa.String(20), nullable=False, server_default="elearning"),
    )


def downgrade() -> None:
    op.drop_column("formations", "format")
    op.drop_column("formations", "prerequisites")
