"""teams.manager_id — the team's operational manager gets read-only dashboard access

Revision ID: 0011_team_manager
Revises: 0010_teams_sessions
Create Date: 2026-07-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_team_manager"
down_revision: Union[str, None] = "0010_teams_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "teams",
        sa.Column(
            "manager_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("teams", "manager_id")
