"""Practices, as a registry rather than free text on each person.

A practice was a string typed onto a learner, so the same métier could be
spelled three ways, nothing could offer a list to pick from, and renaming one
meant editing everybody in it. The BU now owns its practices.

Archived rather than deleted, like a BU: a practice that closed still owns last
year's training hours.

Revision ID: 0046_practices
Revises: 0045_session_guests
"""

import sqlalchemy as sa
from alembic import op

revision = "0046_practices"
down_revision = "0045_session_guests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "bu_id",
            sa.Integer(),
            sa.ForeignKey("business_units.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("bu_id", "name", name="uq_practice_name"),
    )
    op.create_index("ix_practices_bu_id", "practices", ["bu_id"])


def downgrade() -> None:
    op.drop_index("ix_practices_bu_id", table_name="practices")
    op.drop_table("practices")
