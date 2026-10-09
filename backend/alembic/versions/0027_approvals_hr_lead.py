"""HR lead role, explicit HRBP→BU perimeters, and the approval queue.

Adds the pieces behind the tracking board: training requests a manager decides
on, an explicit review state on logged learning so a decline is recorded rather
than looking like "not yet", and a table saying which BUs each HRBP owns — which
also closes the audit finding where an HRBP with a blank `bu` saw everything.

Revision ID: 0027_approvals
Revises:    0026_skills_spine
Create Date: 2026-09-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027_approvals"
down_revision: Union[str, None] = "0026_skills_spine"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- which BUs an HRBP is responsible for --------------------------------
    op.create_table(
        "hr_bu_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "hr_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("bu", sa.String(80), nullable=False),
        sa.Column("assigned_by_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("hr_id", "bu", name="uq_hr_bu"),
    )
    op.create_index("ix_hr_bu_assignments_hr", "hr_bu_assignments", ["hr_id"])

    # Existing HRBPs keep the perimeter they had implicitly, so nobody loses
    # access the moment this ships.
    op.execute(
        """
        INSERT INTO hr_bu_assignments (hr_id, bu, assigned_by_name, created_at, updated_at)
        SELECT id, bu, 'migration 0027', now(), now()
        FROM learners
        WHERE role = 'hr' AND bu <> ''
        """
    )

    # --- training requests ---------------------------------------------------
    op.create_table(
        "training_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "formation_id",
            sa.Integer(),
            sa.ForeignKey("formations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("title", sa.String(255), nullable=False, server_default=""),
        sa.Column("cost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "decided_by_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_by_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("decision_note", sa.String(600), nullable=False, server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_training_requests_learner", "training_requests", ["learner_id"])
    op.create_index("ix_training_requests_status", "training_requests", ["status"])

    # --- explicit review state on logged learning ----------------------------
    op.add_column(
        "learning_records",
        sa.Column("review_status", sa.String(20), nullable=False, server_default="pending"),
    )
    op.add_column(
        "learning_records",
        sa.Column("review_note", sa.String(600), nullable=False, server_default=""),
    )
    op.add_column(
        "learning_records", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Records already vouched for keep that state.
    op.execute(
        "UPDATE learning_records SET review_status = 'verified' WHERE verified_by_id IS NOT NULL"
    )

    op.add_column("assets", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("assets", "reviewed_at")
    op.drop_column("learning_records", "reviewed_at")
    op.drop_column("learning_records", "review_note")
    op.drop_column("learning_records", "review_status")
    op.drop_index("ix_training_requests_status", table_name="training_requests")
    op.drop_index("ix_training_requests_learner", table_name="training_requests")
    op.drop_table("training_requests")
    op.drop_index("ix_hr_bu_assignments_hr", table_name="hr_bu_assignments")
    op.drop_table("hr_bu_assignments")
