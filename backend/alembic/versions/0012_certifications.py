"""certifications catalog + team suggestions + earned-certificate sharing wall

Revision ID: 0012_certifications
Revises: 0011_team_manager
Create Date: 2026-07-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_certifications"
down_revision: Union[str, None] = "0011_team_manager"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "certifications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("provider", sa.String(120), nullable=False, server_default=""),
        sa.Column("description", sa.String(600), nullable=False, server_default=""),
        sa.Column("url", sa.String(500), nullable=False, server_default=""),
        sa.Column("level", sa.String(20), nullable=False, server_default="beginner"),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column(
            "added_by_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("added_by_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "certification_suggestions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "certification_id",
            sa.Integer,
            sa.ForeignKey("certifications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "team_id",
            sa.Integer,
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "suggested_by_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("suggested_by_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("note", sa.String(400), nullable=False, server_default=""),
        sa.UniqueConstraint("certification_id", "team_id", name="uq_cert_suggestion_team"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "earned_certificates",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "certification_id",
            sa.Integer,
            sa.ForeignKey("certifications.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("issuer", sa.String(120), nullable=False, server_default=""),
        sa.Column("obtained_on", sa.Date, nullable=True),
        sa.Column("credential_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("file_original_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("earned_certificates")
    op.drop_table("certification_suggestions")
    op.drop_table("certifications")
