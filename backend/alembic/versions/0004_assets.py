"""assets: shared AI/data work

Revision ID: 0004_assets
Revises: 0003_lab_records
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_assets"
down_revision: Union[str, None] = "0003_lab_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False, server_default="idea"),
        sa.Column("summary", sa.String(500), nullable=False, server_default=""),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column("code", sa.Text, nullable=True),
        sa.Column("link", sa.String, nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("author", sa.String(80), nullable=False, server_default="anonymous"),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("assets")
