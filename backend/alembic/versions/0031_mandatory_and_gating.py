"""Mandatory programmes, a gating entry quiz, and feedback as a real step.

Three flags that change what a completion figure means.

`mandatory` on a formation or course is compliance, and belongs on the card
rather than inside the page — a required training nobody can see is required has
the same completion rate as an optional one and none of the effect. It is
separate from a pathway's `mandatory`: a training can be required on its own
without belonging to any pathway, and an optional pathway can still contain a
required step.

`require_feedback` makes the review the last step of the programme instead of a
popup afterwards. The step joins the denominator, so a learner sees one item
left and what it is, rather than a bar stuck below 100 for no visible reason.

The gating entry assessment lives in the curriculum JSON (`gating`,
`pass_score` on a lesson tagged `assessment: pre`), so it needs no column — but
it is enforced server-side, because a padlock a page reload walks around is a
decoration, and the entry score it protects is the baseline every before/after
measurement rests on.

Revision ID: 0031_mandatory
Revises:    0030_timestamps
Create Date: 2026-09-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0031_mandatory"
down_revision: Union[str, None] = "0030_timestamps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("formations", "courses")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.add_column(
            table,
            sa.Column(
                "require_feedback", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "require_feedback")
        op.drop_column(table, "mandatory")
