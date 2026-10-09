"""Remember which provider course a declaration is about.

Coursera's enterprise report only covers enrolments made through one of the
organisation's programmes — measured: 2,889 of 2,889 rows carry a programme,
and the API offers no wider endpoint. Everything somebody took on their own
account is therefore invisible to any integration, and the only way it can
reach the platform is the person telling us.

Storing the slug turns that claim into something countable: it is the same key
the specialization membership lists use, so a declared course can complete a
programme the feed only sees part of.
"""

from alembic import op
import sqlalchemy as sa

revision = "0052_declared_slug"
down_revision = "0051_skill_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "learning_records",
        sa.Column("external_slug", sa.String(length=255), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("learning_records", "external_slug")
