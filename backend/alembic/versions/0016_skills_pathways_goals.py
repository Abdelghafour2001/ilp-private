"""skills framework + pathways + weekly learning goals (Degreed-style layer)

Revision ID: 0016_skills_pathways
Revises: 0015_social_analytics
Create Date: 2026-07-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_skills_pathways"
down_revision: Union[str, None] = "0015_social_analytics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("category", sa.String(60), nullable=False, server_default="General"),
        sa.Column("description", sa.String(400), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "skill_links",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("skill_id", sa.Integer, sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.Integer, nullable=False),
        sa.UniqueConstraint("skill_id", "entity_type", "entity_id", name="uq_skill_link"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "learner_skills",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("learner_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.Integer, sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.Integer, nullable=False, server_default="0"),
        sa.Column("following", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("learner_id", "skill_id", name="uq_learner_skill"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "pathways",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.String(600), nullable=False, server_default=""),
        sa.Column("emoji", sa.String(8), nullable=False, server_default="🧭"),
        sa.Column("created_by_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("published", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "pathway_steps",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("pathway_id", sa.Integer, sa.ForeignKey("pathways.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("entity_type", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.Integer, nullable=False),
        sa.Column("note", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "pathway_enrollments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("pathway_id", sa.Integer, sa.ForeignKey("pathways.id", ondelete="CASCADE"), nullable=False),
        sa.Column("learner_id", sa.Integer, sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assigned_by", sa.String(120), nullable=False, server_default=""),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.UniqueConstraint("pathway_id", "learner_id", name="uq_pathway_learner"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.add_column("learners", sa.Column("weekly_goal_min", sa.Integer, nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("learners", "weekly_goal_min")
    op.drop_table("pathway_enrollments")
    op.drop_table("pathway_steps")
    op.drop_table("pathways")
    op.drop_table("learner_skills")
    op.drop_table("skill_links")
    op.drop_table("skills")
