"""Hard or soft, on every skill.

The catalogue was ten data and AI skills, where "Soft skills" was one category
among technical ones. A company-wide catalogue needs the two axes apart: the
domain a skill belongs to (Cybersecurity, Human resources, Leadership) and
whether it is a craft or a behaviour. HR reports on them separately and no
competency framework merges them.
"""

from alembic import op
import sqlalchemy as sa

revision = "0051_skill_kind"
down_revision = "0050_specializations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skills",
        sa.Column("kind", sa.String(length=10), nullable=False, server_default="hard"),
    )
    # The one category that was already a kind rather than a domain.
    op.execute("UPDATE skills SET kind = 'soft' WHERE category ILIKE 'soft%'")


def downgrade() -> None:
    op.drop_column("skills", "kind")
