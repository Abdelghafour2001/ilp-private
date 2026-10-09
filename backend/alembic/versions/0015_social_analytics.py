"""comments + likes/shares + content editors — the engagement layer HR tracks

Revision ID: 0015_social_analytics
Revises: 0014_external_personal
Create Date: 2026-07-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015_social_analytics"
down_revision: Union[str, None] = "0014_external_personal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.Integer, nullable=False, index=True),
        sa.Column(
            "learner_id", sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("body", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "engagements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.Integer, nullable=False, index=True),
        sa.Column(
            "learner_id", sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.UniqueConstraint("learner_id", "entity_type", "entity_id", "kind", name="uq_engagement"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "content_editors",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.Integer, nullable=False, index=True),
        sa.Column(
            "learner_id", sa.Integer,
            sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False, server_default=""),
        sa.Column("edits", sa.Integer, nullable=False, server_default="1"),
        sa.UniqueConstraint("entity_type", "entity_id", "learner_id", name="uq_content_editor"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("content_editors")
    op.drop_table("engagements")
    op.drop_table("comments")
