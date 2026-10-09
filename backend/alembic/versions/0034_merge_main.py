"""Rejoin the two lines of development, and settle on one reminder state column.

`main` and `feature/cr-managem-gaps` both branched off 0022_asset_review and
both numbered their next revisions 0023/0024, so the graph has had two heads
since. This merges them.

It also drops `earned_certificates.reminded_on`. Both branches independently
built certification-expiry reminders and each added its own state column:
`reminded_on` (a date — "we nudged this one today") on the CR-gaps side, and
`last_reminder_days` (an int — "we have already announced the 30-day step") on
main's. The merged reminder job keeps main's rule, because a date only tells
you that *a* nudge went out, so a single window fires once and then stays quiet
as the expiry gets closer — which is exactly when the reminder matters. Keeping
both columns would leave one of them silently wrong, so the unused one goes.

Revision ID: 0034_merge_main
Revises:    0033_org_registry, 0024_cert_reminder_state
Create Date: 2026-09-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0034_merge_main"
down_revision: Union[str, Sequence[str], None] = ("0033_org_registry", "0024_cert_reminder_state")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("earned_certificates")}
    if "reminded_on" in cols:
        op.drop_column("earned_certificates", "reminded_on")


def downgrade() -> None:
    op.add_column(
        "earned_certificates", sa.Column("reminded_on", sa.Date(), nullable=True)
    )
