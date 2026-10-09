"""A declared duration on the training sheet.

The sheet showed a duration computed from lesson lengths, which is right for an
e-learning module and wrong for a three-day classroom course with two slides in
the app. The trainer can now state the real length; the computed figure stays
as the fallback when they do not.

Revision ID: 0036_formation_duration
Revises:    0035_onboarding_config
Create Date: 2026-09-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0036_formation_duration"
down_revision: Union[str, None] = "0035_onboarding_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("formations", sa.Column("duration_hours", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("formations", "duration_hours")
