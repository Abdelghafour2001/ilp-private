"""Store what Coursera's enrollment report actually reports.

The original columns were written against a guessed response shape. Coursera's
published API description turns out to carry more, and one field changes the
reporting story: `approxTotalCourseHrs` is documented as the hours a learner has
*spent* in a course, not the course's published length. Coursera hours can
therefore move from the estimated bucket to the measured one, which is the
difference between a Jour-Homme figure that survives an HR review and one that
does not — so `hours_measured` records which kind each row holds instead of
leaving callers to assume.

Existing rows were populated from published course length, so they backfill to
`hours_measured = false`; the next sync corrects the ones Coursera can measure.

Revision ID: 0028_coursera_fields
Revises:    0027_approvals
Create Date: 2026-09-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028_coursera_fields"
down_revision: Union[str, None] = "0027_approvals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "external_enrollments",
        sa.Column(
            "hours_measured", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "external_enrollments",
        sa.Column(
            "content_type", sa.String(40), nullable=False, server_default="Course"
        ),
    )
    op.add_column(
        "external_enrollments",
        sa.Column("program_name", sa.String(255), nullable=False, server_default=""),
    )
    op.add_column(
        "external_enrollments", sa.Column("grade", sa.Float(), nullable=True)
    )
    op.add_column(
        "external_enrollments",
        sa.Column(
            "certificate_url", sa.String(600), nullable=False, server_default=""
        ),
    )
    op.add_column(
        "external_enrollments",
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    for column in (
        "last_activity_at",
        "certificate_url",
        "grade",
        "program_name",
        "content_type",
        "hours_measured",
    ):
        op.drop_column("external_enrollments", column)
