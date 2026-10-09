"""courses.cover_url + learners.locale

Revision ID: 0024_cover_locale
Revises:    0023_cr_gaps
Create Date: 2026-09-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_cover_locale"
down_revision: Union[str, None] = "0023_cr_gaps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Card artwork; blank means "derive from the course's own video content".
    op.add_column(
        "courses",
        sa.Column("cover_url", sa.String(500), nullable=False, server_default=""),
    )
    # Preferred UI language. Also picks the language of the emails and in-app
    # notifications we generate for this person.
    op.add_column(
        "learners",
        sa.Column("locale", sa.String(5), nullable=False, server_default="fr"),
    )


def downgrade() -> None:
    op.drop_column("learners", "locale")
    op.drop_column("courses", "cover_url")
