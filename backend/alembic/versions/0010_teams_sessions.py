"""teams (skill-lead groups) + learners.team_id + formation live sessions

Revision ID: 0010_teams_sessions
Revises: 0009_formations
Create Date: 2026-07-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_teams_sessions"
down_revision: Union[str, None] = "0009_formations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.String(400), nullable=False, server_default=""),
        sa.Column(
            "lead_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.add_column(
        "learners",
        sa.Column(
            "team_id",
            sa.Integer,
            sa.ForeignKey("teams.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "formation_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "formation_id",
            sa.Integer,
            sa.ForeignKey("formations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.String(600), nullable=False, server_default=""),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_min", sa.Integer, nullable=False, server_default="60"),
        sa.Column("location", sa.String(255), nullable=False, server_default=""),
        sa.Column("meeting_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("formation_sessions")
    op.drop_column("learners", "team_id")
    op.drop_table("teams")
