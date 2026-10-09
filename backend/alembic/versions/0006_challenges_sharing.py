"""challenges + sharing sessions

Revision ID: 0006_challenges_sharing
Revises: 0005_courses
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_challenges_sharing"
down_revision: Union[str, None] = "0005_courses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "challenges",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.String(600), nullable=False, server_default=""),
        sa.Column("brief_md", sa.Text, nullable=False, server_default=""),
        sa.Column("theme", sa.String(80), nullable=False, server_default="General"),
        sa.Column("prize", sa.String(255), nullable=True),
        sa.Column("deadline", sa.Date, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("author", sa.String(80), nullable=False, server_default="anonymous"),
        sa.Column("learner_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="SET NULL"), nullable=True),
        *_ts(),
    )

    op.create_table(
        "challenge_submissions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("challenge_id", sa.Integer, sa.ForeignKey("challenges.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.String(600), nullable=False, server_default=""),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column("link", sa.String, nullable=True),
        sa.Column("author", sa.String(80), nullable=False, server_default="anonymous"),
        sa.Column("learner_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="SET NULL"), nullable=True),
        *_ts(),
    )

    op.create_table(
        "challenge_votes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("submission_id", sa.Integer, sa.ForeignKey("challenge_submissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("learner_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("learner_id", "submission_id", name="uq_challenge_vote"),
        *_ts(),
    )

    op.create_table(
        "sharing_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("abstract", sa.String(600), nullable=False, server_default=""),
        sa.Column("body_md", sa.Text, nullable=False, server_default=""),
        sa.Column("presenter", sa.String(120), nullable=False, server_default=""),
        sa.Column("session_date", sa.Date, nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("file_name", sa.String, nullable=True),
        sa.Column("file_original_name", sa.String, nullable=True),
        sa.Column("recording_url", sa.String, nullable=True),
        sa.Column("author", sa.String(80), nullable=False, server_default="anonymous"),
        sa.Column("learner_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="SET NULL"), nullable=True),
        *_ts(),
    )


def downgrade() -> None:
    op.drop_table("sharing_sessions")
    op.drop_table("challenge_votes")
    op.drop_table("challenge_submissions")
    op.drop_table("challenges")
