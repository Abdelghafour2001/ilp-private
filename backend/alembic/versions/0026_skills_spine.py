"""Self-reported learning, skill profiles/targets, multi-source skill ratings.

Turns the skills catalog from a side feature into the spine: what people learn
anywhere gets logged and tagged, roles carry expected levels, and a rating
carries who said so.

Revision ID: 0026_skills_spine
Revises:    0025_external_learning
Create Date: 2026-09-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026_skills_spine"
down_revision: Union[str, None] = "0025_external_learning"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- self-reported learning ---------------------------------------------
    op.create_table(
        "learning_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False, server_default="article"),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False, server_default=""),
        sa.Column("provider", sa.String(120), nullable=False, server_default=""),
        sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column(
            "verified_by_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("verified_by_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_learning_records_learner", "learning_records", ["learner_id"])

    op.create_table(
        "learning_record_skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "record_id",
            sa.Integer(),
            sa.ForeignKey("learning_records.id", ondelete="CASCADE"),
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
        sa.UniqueConstraint("record_id", "skill_id", name="uq_learning_record_skill"),
    )

    # --- role → expected skill levels ---------------------------------------
    op.create_table(
        "skill_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.String(400), nullable=False, server_default=""),
        sa.Column("practice", sa.String(80), nullable=False, server_default=""),
        sa.Column("job_level", sa.String(80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "skill_profile_targets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("skill_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id",
            sa.Integer(),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_level", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("profile_id", "skill_id", name="uq_skill_profile_target"),
    )
    op.add_column(
        "learners",
        sa.Column(
            "skill_profile_id",
            sa.Integer(),
            sa.ForeignKey("skill_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # --- multi-source ratings ------------------------------------------------
    op.create_table(
        "skill_ratings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id",
            sa.Integer(),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(20), nullable=False, server_default="peer"),
        sa.Column(
            "rater_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rater_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("note", sa.String(400), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "learner_id", "skill_id", "source", "rater_id", name="uq_skill_rating"
        ),
    )
    op.create_index("ix_skill_ratings_learner", "skill_ratings", ["learner_id"])


def downgrade() -> None:
    op.drop_index("ix_skill_ratings_learner", table_name="skill_ratings")
    op.drop_table("skill_ratings")
    op.drop_column("learners", "skill_profile_id")
    op.drop_table("skill_profile_targets")
    op.drop_table("skill_profiles")
    op.drop_table("learning_record_skills")
    op.drop_index("ix_learning_records_learner", table_name="learning_records")
    op.drop_table("learning_records")
