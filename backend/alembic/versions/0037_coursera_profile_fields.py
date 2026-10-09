"""Keep the HR fields Coursera already sends with every enrolment.

The enrolment report carries the learner's business unit, location, job title
and manager, plus the programme, partner and course type. We were storing six
of those fields and discarding the rest, so every Coursera KPI had to be sliced
by our own org chart — which is empty for anyone who has not signed in yet.
Storing them makes the provider's own data reportable on its own terms, and
gives the unmatched majority a business unit they would otherwise not have.

Revision ID: 0037_coursera_profile
Revises:    0036_formation_duration
Create Date: 2026-09-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0037_coursera_profile"
down_revision: Union[str, None] = "0036_formation_duration"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    ("full_name", sa.String(length=160)),
    ("partner_names", sa.String(length=255)),
    ("collection_name", sa.String(length=255)),
    ("contract_name", sa.String(length=255)),
    ("course_type", sa.String(length=60)),
    ("job_title", sa.String(length=160)),
    ("job_type", sa.String(length=60)),
    ("business_unit", sa.String(length=120)),
    ("business_unit_2", sa.String(length=120)),
    ("location_city", sa.String(length=120)),
    ("location_country", sa.String(length=120)),
    ("manager_name", sa.String(length=160)),
    ("manager_email", sa.String(length=255)),
]


def upgrade() -> None:
    for name, kind in COLUMNS:
        op.add_column(
            "external_enrollments",
            sa.Column(name, kind, nullable=False, server_default=""),
        )
    op.add_column(
        "external_enrollments",
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("external_enrollments", "enrolled_at")
    for name, _ in reversed(COLUMNS):
        op.drop_column("external_enrollments", name)
