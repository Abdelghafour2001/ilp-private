"""Drop the data-quality tables.

The workbench these fed — database connections, check suites, runs and their
results — was inherited from the tool this platform grew out of. It is a
different product from a learning platform, and nothing in AIDA read these
tables. All five were empty when this was written.

The lab grading engine is unaffected: it shares the check *kinds* module, not
these tables.

Revision ID: 0040_drop_data_quality
Revises: 0039_coursera_xp
"""

import sqlalchemy as sa
from alembic import op

revision = "0040_drop_data_quality"
down_revision = "0039_coursera_xp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Children first: results reference runs and checks, checks reference suites.
    for table in ("results", "runs", "checks", "suites", "connections"):
        op.drop_table(table)


def downgrade() -> None:
    op.create_table(
        "connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("dsn", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "suites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("connections.id", ondelete="CASCADE")),
        sa.Column("schema_name", sa.String(length=120), nullable=False),
        sa.Column("table_name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "checks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("suite_id", sa.Integer(), sa.ForeignKey("suites.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("column", sa.String(length=120), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
    )
    op.create_table(
        "runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("suite_id", sa.Integer(), sa.ForeignKey("suites.id", ondelete="CASCADE")),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("runs.id", ondelete="CASCADE")),
        sa.Column("check_id", sa.Integer(), sa.ForeignKey("checks.id", ondelete="CASCADE")),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=True),
        sa.Column("observed_value", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
    )
