from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Notification(Base):
    """One in-app notification for one learner.

    `kind` groups them for icons/filtering (invite, session, team, cert_suggested,
    cert_earned…); `link` is a frontend path the notification navigates to.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="info")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    link: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
