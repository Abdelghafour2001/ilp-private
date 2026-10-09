"""Add optional validity date to earned certificates (F-05).

Revision ID: 0021_earned_certif_expires_on
Revises: 0020_heal_learner_org_profile
Create Date: 2026-08-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_earned_certif_expires_on"
down_revision: Union[str, None] = "0020_heal_learner_org_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("earned_certificates", sa.Column("expires_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("earned_certificates", "expires_on")
