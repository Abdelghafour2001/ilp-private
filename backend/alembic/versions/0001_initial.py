"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-22
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "connections",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(50), nullable=False, server_default="postgres"),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer, nullable=False, server_default="5432"),
        sa.Column("database", sa.String(255), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("password_encrypted", sa.String, nullable=False),
        *_timestamps(),
    )

    op.create_table(
        "suites",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "connection_id",
            sa.Integer,
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("schema_name", sa.String(255), nullable=False, server_default="public"),
        sa.Column("table_name", sa.String(255), nullable=False),
        *_timestamps(),
    )

    op.create_table(
        "checks",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "suite_id",
            sa.Integer,
            sa.ForeignKey("suites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(50), nullable=False),
        sa.Column("column", sa.String(255), nullable=True),
        sa.Column("params", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("ai_generated", sa.Boolean, nullable=False, server_default=sa.false()),
        *_timestamps(),
    )

    op.create_table(
        "runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "suite_id",
            sa.Integer,
            sa.ForeignKey("suites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_checks", sa.Integer, server_default="0"),
        sa.Column("passed_checks", sa.Integer, server_default="0"),
        sa.Column("error", sa.String, nullable=True),
        *_timestamps(),
    )

    op.create_table(
        "results",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "run_id", sa.Integer, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "check_id", sa.Integer, sa.ForeignKey("checks.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("passed", sa.Boolean, server_default=sa.false()),
        sa.Column("failed_count", sa.Integer, nullable=True),
        sa.Column("observed_value", sa.Float, nullable=True),
        sa.Column("message", sa.String, nullable=True),
        sa.Column("details", postgresql.JSONB, nullable=False, server_default="{}"),
        *_timestamps(),
    )


def downgrade() -> None:
    op.drop_table("results")
    op.drop_table("runs")
    op.drop_table("checks")
    op.drop_table("suites")
    op.drop_table("connections")
