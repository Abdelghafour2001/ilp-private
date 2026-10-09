"""lab_records: app-managed labs

Revision ID: 0003_lab_records
Revises: 0002_labs
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_lab_records"
down_revision: Union[str, None] = "0002_labs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lab_records",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("definition", postgresql.JSONB, nullable=False),
        sa.Column("published", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("lab_records")
