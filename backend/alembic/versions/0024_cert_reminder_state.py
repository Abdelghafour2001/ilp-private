"""earned_certificates.last_reminder_days — anti-doublon des rappels (M-02)

Stores the last expiry threshold (60 / 30 / 7) already announced for a
certificate, so the daily task announces each step exactly once instead of
re-notifying on every run.

Revision ID: 0024_cert_reminder_state
Revises: 0023_pathway_mandatory
Create Date: 2026-08-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_cert_reminder_state"
down_revision: Union[str, None] = "0023_pathway_mandatory"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "earned_certificates",
        sa.Column("last_reminder_days", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("earned_certificates", "last_reminder_days")
