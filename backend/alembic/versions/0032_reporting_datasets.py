"""Uploadable datasets and saved views — the report builder's storage.

Rows are their own table rather than a JSON blob on the dataset. A 20k-row
upload held as one column has to be read whole to answer any question about it,
which turns every filter into a full table scan of one enormous value; as rows,
Postgres does the filtering and only the aggregate travels. It also lets a
dataset be appended to without rewriting what is already stored.

Revision ID: 0032_reporting
Revises:    0031_mandatory
Create Date: 2026-09-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0032_reporting"
down_revision: Union[str, None] = "0031_mandatory"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TS = sa.DateTime(timezone=True)


def _stamps():
    return (
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
    )


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.String(600), nullable=False, server_default=""),
        sa.Column("kind", sa.String(20), nullable=False, server_default="upload"),
        sa.Column("source_key", sa.String(60), nullable=False, server_default=""),
        sa.Column(
            "owner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("owner_name", sa.String(120), nullable=False, server_default=""),
        sa.Column(
            "columns",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_filename", sa.String(255), nullable=False, server_default=""),
        *_stamps(),
    )

    op.create_table(
        "dataset_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "dataset_id",
            sa.Integer(),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("idx", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        *_stamps(),
    )
    # Filtering and grouping both go through `data`, so it gets a GIN index —
    # without one every query on a large upload is a sequential scan.
    op.create_index(
        "ix_dataset_rows_data", "dataset_rows", ["data"], postgresql_using="gin"
    )

    op.create_table(
        "saved_views",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "dataset_id",
            sa.Integer(),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "owner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("owner_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("last_opened_at", TS, nullable=True),
        sa.UniqueConstraint("dataset_id", "name", name="uq_view_name"),
        *_stamps(),
    )


def downgrade() -> None:
    op.drop_table("saved_views")
    op.drop_index("ix_dataset_rows_data", table_name="dataset_rows")
    op.drop_table("dataset_rows")
    op.drop_table("datasets")
