"""assets.status / reviewed_by / review_note — manager approval workflow

Revision ID: 0022_asset_review
Revises:    0021_earned_certif_expires_on
Create Date: 2026-08-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_asset_review"
down_revision: Union[str, None] = "0021_earned_certif_expires_on"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column("status", sa.String(20), nullable=False, server_default="approved"),
    )
    # Existing assets are grandfathered as approved (default above); only
    # NEW assets created from now on start pending review.
    op.alter_column("assets", "status", server_default="pending")

    op.add_column("assets", sa.Column("reviewed_by", sa.String(80), nullable=True))
    op.add_column("assets", sa.Column("review_note", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("assets", "review_note")
    op.drop_column("assets", "reviewed_by")
    op.drop_column("assets", "status")