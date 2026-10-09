"""Somebody from outside the company, invited to a session.

Deliberately not a `Learner`. A guest from a client or a partner has no
account, no XP, no skills and no manager here — and every HR figure the
platform produces (headcount, learning hours, completion, Jour-Homme) is
computed over learners. Giving a guest a learner row would quietly add
outsiders to the organisation's own numbers, which is the kind of error nobody
notices until a steering committee reads it.

So guests sit beside registrations rather than inside them: they appear on the
roster, they can be marked present, and they are counted as guests. The
attendance a trainer takes still means what it says, and HR reporting never
sees them.
"""

import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SessionGuest(Base):
    __tablename__ = "session_guests"
    __table_args__ = (UniqueConstraint("session_id", "email", name="uq_session_guest"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("formation_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    # The company they are from — "Managem", "OCP". Shown on the roster so a
    # trainer knows who is in the room and on whose behalf.
    company: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    invited_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # invited | accepted | declined. A guest cannot log in, so this moves
    # through the links in their invitation email.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="invited")
    attended: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Opaque, unguessable, and the only thing that authenticates a guest: it is
    # in the link they receive and nothing else identifies them.
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    responded_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
