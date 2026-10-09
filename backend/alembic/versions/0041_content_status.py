"""Give courses and pathways the lifecycle trainings already had.

Both carried a `published` boolean defaulting to True. That is two problems in
one column: it cannot express "archived", and its default is what let any
signed-in learner publish straight into the catalogue.

Existing rows keep their current visibility — a published course stays
published — so nothing disappears from anyone's catalogue on deploy. Only new
courses start as drafts.

Labs keep their boolean on purpose: lab definitions are authored by platform
admins, so there is no draft to review and nothing to archive that hiding does
not already cover.

Revision ID: 0041_content_status
Revises: 0040_drop_data_quality
"""

import sqlalchemy as sa
from alembic import op

revision = "0041_content_status"
down_revision = "0040_drop_data_quality"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table, default in (("courses", "published"), ("pathways", "published")):
        op.add_column(
            table,
            sa.Column("status", sa.String(length=20), nullable=False, server_default=default),
        )
        # Carry the old meaning across before the column goes.
        op.execute(
            f"UPDATE {table} SET status = CASE WHEN published THEN 'published' ELSE 'draft' END"
        )
        op.drop_column(table, "published")

    # Courses gain the same review trail assets have, so a rejection can say why.
    op.add_column("courses", sa.Column("reviewed_by", sa.String(length=80), nullable=True))
    op.add_column("courses", sa.Column("review_note", sa.String(length=500), nullable=True))
    # Aware, like every other timestamp in the schema. A naive one here cannot
    # be sorted against `created_at` in the approvals queue.
    op.add_column("courses", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("courses", "reviewed_at")
    op.drop_column("courses", "review_note")
    op.drop_column("courses", "reviewed_by")
    for table in ("courses", "pathways"):
        op.add_column(
            table,
            sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
        # Anything not on the catalogue becomes unpublished; the distinction
        # between draft, pending and archived cannot survive a boolean.
        op.execute(f"UPDATE {table} SET published = (status = 'published')")
        op.drop_column(table, "status")
