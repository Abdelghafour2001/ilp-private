"""A switch over one part of the platform, optionally narrowed to who sees it.

The platform ships more than any one client bought. Managem wants the Coursera
half and the compliance board; another client wants labs and challenges and
nothing else. Until now that was a branch per client, which is how two clients
become two products.

A flag answers one question — *is this module on for this person* — and the
answer can be narrowed twice:

* `roles`   — empty means everyone; otherwise only those roles see it.
* `bus`     — empty means every unit; otherwise only those units.

Both narrow, neither grants: a flag that is off is off for everybody, including
an admin. That ordering matters. A switch whose "off" has exceptions is not a
switch, and the first exception is always "except for us, to test it".
"""

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # One of app.core.features.FEATURES — a module of the platform.
    key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Empty list = no narrowing. JSONB rather than a join table: these are
    # short lists read on every request and edited by hand a few times a year.
    roles: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    bus: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Why it was turned off, for whoever finds it off six months later.
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    # `created_at` and `updated_at` come from Base — redeclaring updated_at here
    # shadowed it and left the table a column short.
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
