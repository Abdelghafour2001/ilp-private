"""Heal schema drift left by the 0018/0019 branch fork.

F-01/F-02 (training details/cost), F-03 (reviews) and F-07 (org profile)
were developed on parallel branches that briefly gave alembic two heads.
Databases that migrated during that window — or were `alembic stamp`ed to
silence the multiple-heads error — can be missing any subset of what those
migrations create, while alembic_version claims they are up to date.

This migration re-checks everything from that era and adds only what is
missing; it is a no-op on healthy databases:
  - learners: bu, practice, location, matricule, job_level  (0019_learner_org_profile)
  - formations: prerequisites, format                       (0018_training_details)
  - formations.cost, courses.cost                           (0018_training_cost)
  - reviews table                                           (0019_reviews)

Revision ID: 0020_heal_learner_org_profile
Revises: 0019_reviews
Create Date: 2026-08-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020_heal_learner_org_profile"
down_revision: Union[str, None] = "0019_reviews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# table -> [(column name, column def)]
HEAL_COLUMNS: dict[str, list[tuple[str, sa.Column]]] = {
    "learners": [
        (name, sa.Column(name, sa.String(80), nullable=False, server_default=""))
        for name in ("bu", "practice", "location", "matricule", "job_level")
    ],
    "formations": [
        ("prerequisites", sa.Column("prerequisites", sa.String(1000), nullable=False, server_default="")),
        ("format", sa.Column("format", sa.String(20), nullable=False, server_default="elearning")),
        ("cost", sa.Column("cost", sa.Integer, nullable=False, server_default="0")),
    ],
    "courses": [
        ("cost", sa.Column("cost", sa.Integer, nullable=False, server_default="0")),
    ],
}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    for table, columns in HEAL_COLUMNS.items():
        if not inspector.has_table(table):
            continue  # earlier migrations are missing too; nothing to heal onto
        existing = {col["name"] for col in inspector.get_columns(table)}
        for name, column in columns:
            if name not in existing:
                op.add_column(table, column)

    if not inspector.has_table("reviews"):
        op.create_table(
            "reviews",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("entity_type", sa.String(20), nullable=False),
            sa.Column("entity_id", sa.Integer, nullable=False, index=True),
            sa.Column(
                "learner_id", sa.Integer,
                sa.ForeignKey("learners.id", ondelete="CASCADE"), nullable=False,
            ),
            sa.Column("stars", sa.Integer, nullable=False),
            sa.CheckConstraint("stars BETWEEN 1 AND 5", name="ck_review_stars_range"),
            sa.UniqueConstraint("learner_id", "entity_type", "entity_id", name="uq_review"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    # Everything here is owned by the 0018/0019 migrations; nothing to undo.
    pass
