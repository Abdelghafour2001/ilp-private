"""CR gaps: pathway gating, open sessions with registration & attendance,
client-required certifications, internal/external trainings.

Revision ID: 0023_cr_gaps
Revises:    0022_asset_review
Create Date: 2026-09-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_cr_gaps"
down_revision: Union[str, None] = "0022_asset_review"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- trainings: internal vs external (HR reporting axis) ----------------
    op.add_column(
        "formations",
        sa.Column("source", sa.String(20), nullable=False, server_default="internal"),
    )
    op.add_column(
        "formations",
        sa.Column("provider", sa.String(120), nullable=False, server_default=""),
    )

    # --- certifications: the ones a client contractually requires -----------
    op.add_column(
        "certifications",
        sa.Column("client_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "certifications",
        sa.Column("client_name", sa.String(120), nullable=False, server_default=""),
    )
    op.add_column(
        "certifications",
        sa.Column("validity_months", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "earned_certificates", sa.Column("reminded_on", sa.Date(), nullable=True)
    )

    # --- pathways: mandatory vs optional, and milestone gating --------------
    op.add_column(
        "pathways",
        sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Existing steps keep today's meaning: all count, none gate.
    op.add_column(
        "pathway_steps",
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "pathway_steps",
        sa.Column("milestone", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # --- sessions: open enrolment, capacity, deadline, own trainer ----------
    # formation_id becomes nullable so a session can stand on its own.
    op.alter_column("formation_sessions", "formation_id", existing_type=sa.Integer(), nullable=True)
    op.add_column(
        "formation_sessions",
        sa.Column("open_to_all", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "formation_sessions",
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "formation_sessions",
        sa.Column("registration_deadline", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("formation_sessions", sa.Column("trainer_id", sa.Integer(), nullable=True))
    op.add_column(
        "formation_sessions",
        sa.Column("trainer_name", sa.String(120), nullable=False, server_default=""),
    )
    op.add_column(
        "formation_sessions",
        sa.Column("theme", sa.String(120), nullable=False, server_default=""),
    )
    op.add_column("formation_sessions", sa.Column("created_by_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_formation_sessions_trainer", "formation_sessions", "learners",
        ["trainer_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_formation_sessions_created_by", "formation_sessions", "learners",
        ["created_by_id"], ["id"], ondelete="SET NULL",
    )

    # --- registrations + attendance -----------------------------------------
    op.create_table(
        "session_registrations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("formation_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "learner_id",
            sa.Integer(),
            sa.ForeignKey("learners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="registered"),
        sa.Column("attended", sa.Boolean(), nullable=True),
        sa.Column("marked_by", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "learner_id", name="uq_session_registration"),
    )
    op.create_index(
        "ix_session_registrations_session", "session_registrations", ["session_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_session_registrations_session", table_name="session_registrations")
    op.drop_table("session_registrations")

    op.drop_constraint("fk_formation_sessions_created_by", "formation_sessions", type_="foreignkey")
    op.drop_constraint("fk_formation_sessions_trainer", "formation_sessions", type_="foreignkey")
    for col in ("created_by_id", "theme", "trainer_name", "trainer_id",
                "registration_deadline", "capacity", "open_to_all"):
        op.drop_column("formation_sessions", col)
    op.alter_column("formation_sessions", "formation_id", existing_type=sa.Integer(), nullable=False)

    op.drop_column("pathway_steps", "milestone")
    op.drop_column("pathway_steps", "required")
    op.drop_column("pathways", "mandatory")

    op.drop_column("earned_certificates", "reminded_on")
    op.drop_column("certifications", "validity_months")
    op.drop_column("certifications", "client_name")
    op.drop_column("certifications", "client_required")

    op.drop_column("formations", "provider")
    op.drop_column("formations", "source")
