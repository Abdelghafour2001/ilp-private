"""L&D-editable first-connection wizard.

The role focuses and weekly goals shown to a newcomer were a Python dict. This
moves them into three tables so L&D can edit them in the console. Nothing is
seeded here: `core/onboarding_config.ensure_seeded` fills the tables from the
former hardcoded presets on first read, which keeps the seed in one place and
lets a fresh install and an existing one take the same path.

Revision ID: 0035_onboarding_config
Revises:    0034_merge_main
Create Date: 2026-09-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0035_onboarding_config"
down_revision: Union[str, None] = "0034_merge_main"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "onboarding_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=40), nullable=False, unique=True),
        sa.Column("label_fr", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("label_en", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("emoji", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "onboarding_role_skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "role_id",
            sa.Integer(),
            sa.ForeignKey("onboarding_roles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id",
            sa.Integer(),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("role_id", "skill_id", name="uq_onboarding_role_skill"),
    )
    op.create_table(
        "onboarding_goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("minutes", sa.Integer(), nullable=False, unique=True),
        sa.Column("label_fr", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("label_en", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("onboarding_goals")
    op.drop_table("onboarding_role_skills")
    op.drop_table("onboarding_roles")
