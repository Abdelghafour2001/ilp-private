"""Cache which courses make up a provider's multi-course programmes.

The enterprise enrolment feed reports courses only, so a specialization or a
professional certificate somebody earned is invisible. This table holds the
catalogue's own membership lists; who earned what is derived from them against
the completions already stored, so there is nothing per-learner to keep in step.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0050_specializations"
down_revision = "0049_assignment_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_specializations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=40), nullable=False, server_default="coursera"),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("partner_names", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("url", sa.String(length=600), nullable=False, server_default=""),
        sa.Column("logo_url", sa.String(length=600), nullable=False, server_default=""),
        sa.Column("course_slugs", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider", "slug", name="uq_external_specialization_slug"),
    )


def downgrade() -> None:
    op.drop_table("external_specializations")
