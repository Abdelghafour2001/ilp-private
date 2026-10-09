"""pathway_enrollments.mandatory — parcours obligatoire vs optionnel (F-09)

The flag lives on the *enrolment*, not the pathway: the same pathway can be
mandatory for one team and merely suggested to another.

Revision ID: 0023_pathway_mandatory
Revises: 0022_asset_review
Create Date: 2026-08-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_pathway_mandatory"
down_revision: Union[str, None] = "0022_asset_review"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing assignments stay optional — never invent obligations retroactively.
    op.add_column(
        "pathway_enrollments",
        sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("pathway_enrollments", "mandatory")
