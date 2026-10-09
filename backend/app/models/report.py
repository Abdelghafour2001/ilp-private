"""Datasets people upload, and the views they build on them.

The reporting page used to answer a fixed set of questions. This lets HR ask
their own: upload a spreadsheet, pick what to group by and what to measure, save
the result under a name, come back to it.

Rows live in their own table as JSONB rather than as a blob on the dataset.
A 20k-row upload held as one JSON column has to be loaded whole to answer any
question about it, which turns every filter into a full read; as rows, Postgres
does the filtering and only the aggregate comes back. It also means a dataset
can be appended to without rewriting what is already there.

Columns are typed on upload rather than guessed at query time. "1 200" and
"1200" and "1,200" are the same number to a person and three different strings
to a database, and deciding that once at upload is the difference between a
number column and a text one that silently refuses to sum.
"""

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# What a column can hold. Deliberately few: every extra type is another branch
# in the aggregator, and these three cover what a spreadsheet actually carries.
COLUMN_TYPES = ("text", "number", "date")


class Dataset(Base):
    """A table people can report on — uploaded, or one of AIDA's own."""

    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    # "upload" — a file somebody loaded. "builtin" — AIDA's own data, exposed as
    # a dataset so the builder is useful before anyone uploads anything.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="upload")
    # For a builtin, which internal source feeds it.
    source_key: Mapped[str] = mapped_column(String(60), nullable=False, default="")

    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # [{"name": "BU", "type": "text"}, {"name": "Heures", "type": "number"}, ...]
    columns: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # The file it came from, kept so a re-upload can say what it is replacing.
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    rows: Mapped[list["DatasetRow"]] = relationship(
        "DatasetRow", cascade="all, delete-orphan", passive_deletes=True
    )


class DatasetRow(Base):
    """One row of an uploaded dataset, keyed by column name."""

    __tablename__ = "dataset_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Position in the uploaded file, so the raw preview shows it in file order.
    idx: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class SavedView(Base):
    """A saved question: what to group by, what to measure, how to draw it.

    Shared views are the point — an HR lead builds "hours by BU by quarter" once
    and everybody opens the same figure, instead of six people rebuilding it
    slightly differently and disagreeing in the meeting.
    """

    __tablename__ = "saved_views"
    __table_args__ = (UniqueConstraint("dataset_id", "name", name="uq_view_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Private by default: a half-built view on someone's screen is not a figure
    # the organisation should be reading yet.
    shared: Mapped[bool] = mapped_column(nullable=False, default=False)

    # {"dimensions": [...], "measures": [{"column","agg"}], "filters": [...],
    #  "chart": "bar", "sort": {...}, "limit": 50}
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    last_opened_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
