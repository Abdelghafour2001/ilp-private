"""BU heads, a two-stage approval chain, and auto-assigned pathways.

Three changes that belong together because they are one org change.

A BU head sits above the team managers — Mostapha heads AI & Data, which holds
both the Data Practice and the AI Factory under different managers — so a
training request now goes to the N+1 manager first and the BU head second. The
chain is rows rather than two more columns on the request: a third stage becomes
configuration instead of another migration, and each decision stays attached to
the stage that made it.

`skill_lead` goes at the same time. It sat beside `manager` with the same reach
and no distinct meaning, which made the hierarchy ambiguous while granting
nothing. Anyone holding it becomes a `trainer`, which is what they were doing.

Existing requests are backfilled with a single completed or pending manager step
so the new UI has something coherent to render for them; they are not
retroactively sent to a BU head, because nobody actually asked those people.

Revision ID: 0029_bu_head
Revises:    0028_coursera_fields
Create Date: 2026-09-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029_bu_head"
down_revision: Union[str, None] = "0028_coursera_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bu_head_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "head_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("bu", sa.String(80), nullable=False),
        sa.Column("assigned_by_name", sa.String(120), nullable=False, server_default=""),
        sa.UniqueConstraint("head_id", "bu", name="uq_bu_head"),
    )

    op.create_table(
        "approval_steps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "request_id",
            sa.Integer(),
            sa.ForeignKey("training_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("stage", sa.String(20), nullable=False, server_default="manager"),
        sa.Column(
            "approver_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("approver_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("note", sa.String(600), nullable=False, server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("request_id", "position", name="uq_step_position"),
    )

    op.add_column(
        "pathways",
        sa.Column("auto_assign", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "pathways",
        sa.Column("audience_bu", sa.String(80), nullable=False, server_default=""),
    )

    # Every existing request gets the manager step it effectively already had,
    # carrying whatever decision was recorded on the request itself.
    op.execute(
        """
        INSERT INTO approval_steps
            (request_id, position, stage, approver_id, approver_name,
             status, note, decided_at)
        SELECT id, 1, 'manager', decided_by_id, decided_by_name,
               status, decision_note, decided_at
        FROM training_requests
        """
    )

    op.execute("UPDATE learners SET role = 'trainer' WHERE role = 'skill_lead'")


def downgrade() -> None:
    op.drop_column("pathways", "audience_bu")
    op.drop_column("pathways", "auto_assign")
    op.drop_table("approval_steps")
    op.drop_table("bu_head_assignments")
