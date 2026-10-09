from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Skill(Base):
    """A curated competency ("SQL", "Negotiation") — the Degreed-style spine
    that connects content, people, and gap analysis.

    Two axes, because a company-wide catalogue needs both and one cannot be
    derived from the other:

    * `category` — the **domain** the skill belongs to: Cybersecurity, SAP &
      ERP, Human resources, Finance & procurement, Leadership… Which domains
      exist is the organisation's business, so it is a label and not an enum.
    * `kind` — **hard** or **soft**. Hard is a craft that can be demonstrated;
      soft is behavioural and transversal. HR asks for them separately, every
      competency framework separates them, and a single list that mixes
      "Kubernetes" with "Active listening" is useful to nobody.
    """

    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False, default="General")
    # "hard" | "soft". Defaults to hard: a skill added without saying is far
    # more often a technical one, and the catalogue screen shows the kind so a
    # wrong default is visible rather than silent.
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="hard")
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="")


class SkillLink(Base):
    """Content tagged with a skill (training, course, or certification)."""

    __tablename__ = "skill_links"
    __table_args__ = (
        UniqueConstraint("skill_id", "entity_type", "entity_id", name="uq_skill_link"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # formation | course | certification
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)


class LearnerSkill(Base):
    """A learner's relationship to a skill: following it, and a 0-5 self-rating
    (0 = just following, no rating yet)."""

    __tablename__ = "learner_skills"
    __table_args__ = (UniqueConstraint("learner_id", "skill_id", name="uq_learner_skill"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    learner_id: Mapped[int] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), nullable=False
    )
    skill_id: Mapped[int] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0-5
    following: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
