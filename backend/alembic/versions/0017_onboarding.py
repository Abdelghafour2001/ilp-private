"""learners.onboarded — has the first-connection assessment been completed?

Revision ID: 0017_onboarding
Revises: 0016_skills_pathways
Create Date: 2026-07-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_onboarding"
down_revision: Union[str, None] = "0016_skills_pathways"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "learners",
        sa.Column("onboarded", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    # Existing learners are grandfathered (true above); only NEW learners get
    # the wizard — flip the default for rows created from now on.
    op.alter_column("learners", "onboarded", server_default=sa.false())


def downgrade() -> None:
    op.drop_column("learners", "onboarded")
