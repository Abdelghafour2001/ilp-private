"""Let L&D accept a mandatory assignment as done, on evidence they have seen.

Coursera's enterprise report only carries enrolments made through one of the
organisation's programmes. A course taken outside one is invisible to the sync
for ever, so an assignment covering it could never be closed: the learner was
reminded every day until the deadline and then counted as overdue, with a
certificate nobody could act on.

Nothing closes automatically. This records a decision and who made it.
"""

from alembic import op
import sqlalchemy as sa

revision = "0053_accept_as_done"
down_revision = "0052_declared_slug"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("course_assignments", sa.Column("accepted_on", sa.Date(), nullable=True))
    op.add_column(
        "course_assignments",
        sa.Column("accepted_by", sa.String(length=120), nullable=False, server_default=""),
    )
    op.add_column(
        "course_assignments",
        sa.Column("accepted_note", sa.String(length=400), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("course_assignments", "accepted_note")
    op.drop_column("course_assignments", "accepted_by")
    op.drop_column("course_assignments", "accepted_on")
