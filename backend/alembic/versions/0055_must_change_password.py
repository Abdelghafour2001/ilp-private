"""A password somebody else chose is a password that has to be replaced.

Testers are opened in bulk: L&D sets a password, hands it over in a chat, and
that message sits in the thread for ever. The flag turns that into a one-time
credential — the account cannot be used until its owner picks their own — so
the handed-over string stops being a working key the moment it is used.

False for everyone already here: their passwords were set before this existed
and asking the whole organisation to change on next sign-in would be a
migration announcing itself as an incident.
"""

from alembic import op
import sqlalchemy as sa

revision = "0055_must_change_password"
down_revision = "0054_manager_digest"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "learners",
        sa.Column("must_change_password", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("learners", "must_change_password")
