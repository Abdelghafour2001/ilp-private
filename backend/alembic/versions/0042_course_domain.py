"""Give a course the subject it belongs to.

The catalogue went from 26 entries to 833, and at that size browsing without a
taxonomy is scrolling. Coursera publishes its own — `domainTypes`, e.g.
`data-science` / `machine-learning` — so the categories people filter by are
the provider's classification rather than a guess made from a title.

Blank for in-house courses until somebody sets one; an empty subject is a real
state and reads as "not classified", not as a category of its own.

Revision ID: 0042_course_domain
Revises: 0041_content_status
"""

import sqlalchemy as sa
from alembic import op

revision = "0042_course_domain"
down_revision = "0041_content_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column("domain", sa.String(length=80), nullable=False, server_default=""),
    )
    op.add_column(
        "courses",
        sa.Column("subdomain", sa.String(length=80), nullable=False, server_default=""),
    )
    # Filtering by subject is the whole point, so it is worth an index.
    op.create_index("ix_courses_domain", "courses", ["domain"])


def downgrade() -> None:
    op.drop_index("ix_courses_domain", table_name="courses")
    op.drop_column("courses", "subdomain")
    op.drop_column("courses", "domain")
