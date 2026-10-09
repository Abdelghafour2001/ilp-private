"""external-link courses (Coursera & co) + personal certification recommendations

Revision ID: 0014_external_personal
Revises: 0013_notifications
Create Date: 2026-07-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_external_personal"
down_revision: Union[str, None] = "0013_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("external_url", sa.String(500), nullable=False, server_default=""))
    op.add_column("courses", sa.Column("provider", sa.String(120), nullable=False, server_default=""))

    # A suggestion now targets a team OR one learner.
    op.alter_column("certification_suggestions", "team_id", nullable=True)
    op.add_column(
        "certification_suggestions",
        sa.Column(
            "target_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.execute("DELETE FROM certification_suggestions WHERE team_id IS NULL")
    op.drop_column("certification_suggestions", "target_id")
    op.alter_column("certification_suggestions", "team_id", nullable=False)
    op.drop_column("courses", "provider")
    op.drop_column("courses", "external_url")
