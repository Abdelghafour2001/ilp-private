"""Assign anything, and record every attempt.

Two changes that go together, because both exist to answer L&D's question:
who was asked to do this, and how are they getting on.

`course_assignments` only knew about courses, so a training or a pathway could
be declared mandatory and never actually given to anyone. It gains
`entity_type` / `entity_id` and keeps its rows: every one of them was a course,
so they migrate as such.

`assessment_attempts` is new. A completion row is only written when somebody
passes, which means a first-time pass and a sixth-attempt pass looked
identical and "how many failed attempts" had no answer at all.

Revision ID: 0043_assignments_and_attempts
Revises: 0042_course_domain
"""

import sqlalchemy as sa
from alembic import op

revision = "0043_assignments_and_attempts"
down_revision = "0042_course_domain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- assignments become general -------------------------------------
    op.add_column(
        "course_assignments",
        sa.Column("entity_type", sa.String(length=20), nullable=False, server_default="course"),
    )
    op.add_column("course_assignments", sa.Column("entity_id", sa.Integer(), nullable=True))
    op.add_column("course_assignments", sa.Column("via_team_id", sa.Integer(), nullable=True))
    op.execute("UPDATE course_assignments SET entity_id = course_id")
    op.alter_column("course_assignments", "entity_id", nullable=False)
    op.create_foreign_key(
        "fk_assignment_team", "course_assignments", "teams", ["via_team_id"], ["id"],
        ondelete="SET NULL",
    )
    op.drop_constraint("uq_course_assignment", "course_assignments", type_="unique")
    op.create_unique_constraint(
        "uq_assignment_target", "course_assignments", ["entity_type", "entity_id", "learner_id"]
    )
    op.drop_column("course_assignments", "course_id")

    # --- every attempt, pass or fail ------------------------------------
    op.create_table(
        "assessment_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("lesson_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("kind", sa.String(length=30), nullable=False, server_default="challenge"),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("pass_mark", sa.Float(), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_assessment_attempts_learner_id", "assessment_attempts", ["learner_id"])


def downgrade() -> None:
    op.drop_index("ix_assessment_attempts_learner_id", table_name="assessment_attempts")
    op.drop_table("assessment_attempts")

    op.add_column("course_assignments", sa.Column("course_id", sa.Integer(), nullable=True))
    # Only the course rows can survive a column that only holds courses.
    op.execute("UPDATE course_assignments SET course_id = entity_id WHERE entity_type = 'course'")
    op.execute("DELETE FROM course_assignments WHERE entity_type <> 'course'")
    op.alter_column("course_assignments", "course_id", nullable=False)
    op.drop_constraint("uq_assignment_target", "course_assignments", type_="unique")
    op.create_unique_constraint(
        "uq_course_assignment", "course_assignments", ["course_id", "learner_id"]
    )
    op.drop_constraint("fk_assignment_team", "course_assignments", type_="foreignkey")
    op.drop_column("course_assignments", "via_team_id")
    op.drop_column("course_assignments", "entity_id")
    op.drop_column("course_assignments", "entity_type")
