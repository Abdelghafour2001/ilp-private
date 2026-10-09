"""external_enrollments + courses.external_hours

Records learning done on outside platforms (Coursera first) so external
programmes stop counting as zero hours in the HR KPIs.

Revision ID: 0025_external_learning
Revises:    0024_cover_locale
Create Date: 2026-09-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_external_learning"
down_revision: Union[str, None] = "0024_cover_locale"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Provider-published course length, in hours (Coursera's "workload").
    op.add_column(
        "courses",
        sa.Column("external_hours", sa.Float(), nullable=False, server_default="0"),
    )

    op.create_table(
        "external_enrollments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(40), nullable=False, server_default="coursera"),
        sa.Column("external_id", sa.String(255), nullable=False),
        # Nullable on purpose: an unmatched provider account is kept and
        # counted rather than dropped, so under-reporting stays visible.
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("matched_email", sa.String(255), nullable=False, server_default=""),
        sa.Column("course_slug", sa.String(255), nullable=False, server_default=""),
        sa.Column("course_title", sa.String(255), nullable=False, server_default=""),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("progress_pct", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hours", sa.Float(), nullable=False, server_default="0"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider", "external_id", name="uq_external_enrollment_provider_id"),
    )
    op.create_index(
        "ix_external_enrollments_learner", "external_enrollments", ["learner_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_external_enrollments_learner", table_name="external_enrollments")
    op.drop_table("external_enrollments")
    op.drop_column("courses", "external_hours")
