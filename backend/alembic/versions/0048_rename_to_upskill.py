"""Carry the rename into stored data.

Renaming the product is a one-line change in the source and a silent breakage
in the database: a saved view stores the *name* of the column it groups or
measures, and "Heures AIDA" stopped existing the moment the dataset started
calling it "Heures UpSkill". The view would still open, still draw, and simply
show nothing — the worst kind of failure, because nobody notices.

Three places hold the old name:

* `saved_views.config` — the column names a view refers to;
* `saved_views.description` and `datasets.description` — prose shown beside it;
* `saved_views.owner_name` — the seeded views are authored by the platform
  itself, so the product name is literally the author;
* `datasets.columns` — the declared schema of a builtin dataset, and
  `datasets.owner_name`, which for a builtin dataset is the platform itself.

Uploaded datasets are untouched: their columns are whatever the file said.
"""

from alembic import op

revision = "0048_rename_to_upskill"
down_revision = "0047_auth_and_features"
branch_labels = None
depends_on = None

OLD, NEW = "AIDA", "UpSkill"


def _swap(before: str, after: str) -> None:
    op.execute(
        f"""
        UPDATE saved_views
           SET config = REPLACE(config::text, '{before}', '{after}')::jsonb,
               description = REPLACE(description, '{before}', '{after}'),
               owner_name = REPLACE(owner_name, '{before}', '{after}')
         WHERE config::text LIKE '%{before}%'
            OR description LIKE '%{before}%'
            OR owner_name LIKE '%{before}%'
        """
    )
    op.execute(
        f"""
        UPDATE datasets
           SET columns = REPLACE(columns::text, '{before}', '{after}')::jsonb,
               description = REPLACE(description, '{before}', '{after}'),
               owner_name = REPLACE(owner_name, '{before}', '{after}')
         WHERE kind = 'builtin'
           AND (columns::text LIKE '%{before}%'
                OR description LIKE '%{before}%'
                OR owner_name LIKE '%{before}%')
        """
    )


def upgrade() -> None:
    _swap(OLD, NEW)


def downgrade() -> None:
    _swap(NEW, OLD)
