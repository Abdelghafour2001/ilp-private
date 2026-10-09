"""learner org profile — BU, practice, location, matricule, job level

Revision ID: 0019_learner_org_profile
Revises: 0018_training_cost
Create Date: 2026-07-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_learner_org_profile"
down_revision: Union[str, None] = "0018_training_cost"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ORG_FIELDS = ("bu", "practice", "location", "matricule", "job_level")


def upgrade() -> None:
    for col in ORG_FIELDS:
        op.add_column(
            "learners",
            sa.Column(col, sa.String(80), nullable=False, server_default=""),
        )


def downgrade() -> None:
    for col in reversed(ORG_FIELDS):
        op.drop_column("learners", col)
