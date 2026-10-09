"""star ratings (1-5) on trainings/courses — average + feedback rate for HR

Revision ID: 0019_reviews
Revises: 0019_learner_org_profile
Create Date: 2026-07-28

NB: re-parented from 0018_training_cost to 0019_learner_org_profile to
linearise a two-head branch (F-03 and F-07 were developed in parallel).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_reviews"
down_revision: Union[str, None] = "0019_learner_org_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
    op.drop_table("reviews")