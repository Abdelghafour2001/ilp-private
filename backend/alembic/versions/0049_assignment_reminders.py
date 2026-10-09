"""Remember the day a mandatory assignment was last chased.

Without it, "remind once a day" depends on the scheduler never restarting,
never retrying and never being run by hand — three things that all happen.
"""

from alembic import op
import sqlalchemy as sa

revision = "0049_assignment_reminders"
down_revision = "0048_rename_to_upskill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_assignments", sa.Column("last_reminded_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("course_assignments", "last_reminded_on")
