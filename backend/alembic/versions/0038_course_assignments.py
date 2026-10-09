"""Courses can be assigned to a person, not just published.

Trainings had `formation_enrollments`; courses had nothing between "published"
and "somebody opened it", so a mandatory course could not be given to anyone
and nobody could answer who still had to do it.

Revision ID: 0038_course_assignments
Revises:    0037_coursera_profile
Create Date: 2026-09-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0038_course_assignments"
down_revision: Union[str, None] = "0037_coursera_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "course_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("learner_id", sa.Integer(), sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("assigned_by", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("course_id", "learner_id", name="uq_course_assignment"),
    )


def downgrade() -> None:
    op.drop_table("course_assignments")
