from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Team(Base):
    """A group of learners tracked by a Skill Lead (the HR/skills responsible).

    The lead manages members and sees a dashboard of the team's XP, streaks and
    formation progress; the team's (operational) manager gets the same dashboard
    read-only. Members are linked via `Learner.team_id` (one team per learner).
    """

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    lead_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
    manager_id: Mapped[int | None] = mapped_column(
        ForeignKey("learners.id", ondelete="SET NULL"), nullable=True
    )
