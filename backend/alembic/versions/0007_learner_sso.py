"""learner SSO identity fields

Revision ID: 0007_learner_sso
Revises: 0006_challenges_sharing
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_learner_sso"
down_revision: Union[str, None] = "0006_challenges_sharing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("learners", sa.Column("azure_oid", sa.String(64), nullable=True))
    op.add_column("learners", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("learners", sa.Column("name", sa.String(255), nullable=True))
    op.add_column("learners", sa.Column("role", sa.String(20), nullable=False, server_default="user"))
    op.create_unique_constraint("uq_learner_azure_oid", "learners", ["azure_oid"])


def downgrade() -> None:
    op.drop_constraint("uq_learner_azure_oid", "learners", type_="unique")
    op.drop_column("learners", "role")
    op.drop_column("learners", "name")
    op.drop_column("learners", "email")
    op.drop_column("learners", "azure_oid")
