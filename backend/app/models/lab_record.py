from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LabRecord(Base):
    """A lab authored/managed in the app (vs. the file-based ones in backend/labs).

    The full lab definition is stored as JSONB matching the same schema as the
    YAML files, so the loader/registry can validate it with one pydantic model.
    """

    __tablename__ = "lab_records"

    # The lab's slug id (matches definition["id"]).
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    definition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
