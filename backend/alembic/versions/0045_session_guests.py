"""External guests on a session.

A client or partner attending a workshop has no account here, and should not
get one: every HR figure the platform reports is computed over learners, so a
guest with a learner row would quietly join the organisation's own headcount
and learning hours.

They sit beside registrations instead — on the roster, markable present,
counted as guests, invisible to HR reporting.

Revision ID: 0045_session_guests
Revises: 0044_learning_goals
"""

import sqlalchemy as sa
from alembic import op

revision = "0045_session_guests"
down_revision = "0044_learning_goals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_guests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("formation_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("company", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("invited_by", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="invited"),
        sa.Column("attended", sa.Boolean(), nullable=True),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("session_id", "email", name="uq_session_guest"),
    )
    op.create_index("ix_session_guests_session_id", "session_guests", ["session_id"])
    # The token is how a guest is identified at all, so it has to be unique.
    op.create_index("ix_session_guests_token", "session_guests", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_session_guests_token", table_name="session_guests")
    op.drop_index("ix_session_guests_session_id", table_name="session_guests")
    op.drop_table("session_guests")
