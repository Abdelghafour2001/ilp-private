"""Email + password sign-in, and the feature switchboard.

Two things arrive together because they answer the same deployment question:
who may sign in, and what they get once they have.

Nothing here changes an existing account. `password_hash` is null for everyone,
which means exactly what it says — no password set, so no password sign-in —
and the feature table starts empty, which means every module is on.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0047_auth_and_features"
down_revision = "0046_practices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learners", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column("learners", sa.Column("password_set_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "learners",
        sa.Column("failed_logins", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("learners", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "feature_flags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=60), nullable=False, unique=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("roles", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("bus", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("note", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(length=120), nullable=False, server_default=""),
        # Base gives every table both timestamps.
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_feature_flags_key", "feature_flags", ["key"])


def downgrade() -> None:
    op.drop_index("ix_feature_flags_key", table_name="feature_flags")
    op.drop_table("feature_flags")
    for column in ("locked_until", "failed_logins", "password_set_at", "password_hash"):
        op.drop_column("learners", column)
