"""Remember the day a manager last received the team digest.

Managers are told once a day at most about their team's mandatory work. The
stamp lives on the person rather than on the schedule, because beat restarts,
retries and manual runs all happen, and none of them should produce a second
digest in one morning.
"""

from alembic import op
import sqlalchemy as sa

revision = "0054_manager_digest"
down_revision = "0053_accept_as_done"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learners", sa.Column("manager_digest_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("learners", "manager_digest_on")
