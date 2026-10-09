"""Business units as rows, and a job title on the learner.

A BU was a string typed onto each person. That supports grouping a report and
nothing else: you cannot create a unit before it has staff, cannot rename one
without editing everybody in it, cannot record who runs it, and a typo silently
invents a BU that then appears in the org chart as real.

`learners.bu` stays a string — every report, export and perimeter reads it, and
threading an id through all of that would be a large change for no gain — but it
is now expected to match a row in `business_units`, and a rename updates both in
one transaction. Existing distinct values are backfilled so nothing is orphaned.

`learners.title` is the job title on the org chart ("Data Practice Manager"),
which is a different question from `job_level` (the HR grade) and from `role`
(what the platform permits). All three were being carried by `job_level`.

Revision ID: 0033_org_registry
Revises:    0032_reporting
Create Date: 2026-09-08
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033_org_registry"
down_revision: Union[str, None] = "0032_reporting"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "business_units",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("code", sa.String(20), nullable=False, server_default=""),
        sa.Column("description", sa.String(400), nullable=False, server_default=""),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("business_units.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.add_column(
        "learners", sa.Column("title", sa.String(120), nullable=False, server_default="")
    )

    # Backfill from what people are already tagged with, in alphabetical order
    # so the chart has a stable starting sequence L&D can then re-order.
    op.execute(
        """
        INSERT INTO business_units (name, position)
        SELECT DISTINCT TRIM(bu), 0
        FROM learners
        WHERE bu IS NOT NULL AND TRIM(bu) <> ''
        ORDER BY TRIM(bu)
        """
    )
    op.execute(
        """
        UPDATE business_units b
        SET position = s.rn
        FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn FROM business_units) s
        WHERE b.id = s.id
        """
    )


def downgrade() -> None:
    op.drop_column("learners", "title")
    op.drop_table("business_units")
