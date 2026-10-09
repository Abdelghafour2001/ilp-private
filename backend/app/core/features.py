"""Which parts of the platform are switched on, and for whom.

The registry below is the whole list — a flag that is not here does not exist,
so a typo in the admin API is refused rather than silently stored as a switch
nobody will ever read.

Only *optional* modules are listed. Signing in, the catalogue, your own
learning record and the admin surface itself are the platform; turning them off
leaves a product that cannot be used, so they are not offered as switches.

Resolution, in order:

1. no row for the key   -> on (a client who never opened the switchboard has
                           everything, which is what shipping means)
2. `enabled` is false   -> off for everybody, admins included
3. `roles` non-empty    -> on only for those roles
4. `bus` non-empty      -> on only for those units

Steps 3 and 4 narrow; neither grants. An admin who switches a module off and
still sees it would have no way to know what their users see, which is the one
question the switchboard exists to answer.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import FeatureFlag, Learner

# key -> (label, what turning it off actually removes)
FEATURES: dict[str, tuple[str, str]] = {
    "coursera": ("Coursera", "The provider sync, the blended figures and the person cards."),
    "pathways": ("Pathways", "Curated journeys. Steps already assigned stay assigned."),
    "labs": ("Labs", "Hands-on graded lessons and the lab editor."),
    "stacks": ("Stacks", "Local tool recipes."),
    "challenges": ("Challenges", "The open innovation board."),
    "sessions": ("Sessions", "Live sessions, the schedule and guest invitations."),
    "assets": ("Assets", "Shared notebooks and models."),
    "certifications": ("Certifications", "The certification catalogue and renewal reminders."),
    "skills": ("Skills", "The skill tree, self-ratings and role profiles."),
    "goals": ("Learning goals", "Personal goals and the weekly target."),
    "leaderboard": ("Leaderboard", "XP rankings. XP is still earned and still shown on a profile."),
    "reports": ("Report builder", "The build-your-own reporting screen. Periodic reports stay."),
    "compliance": ("Compliance board", "The mandatory-training board and its assignment tracking."),
    "ai": ("AI assistance", "The tutor, the review and the written report commentary."),
    # The first-connection questions. Switching them off does not delete
    # anybody's answers or the pathways they led to — it stops the dialog
    # appearing, which is what a rollout wants when the questions are not
    # ready, or when people are being onboarded some other way.
    "onboarding": ("Onboarding questions", "The first-connection dialog that asks a new colleague what they do."),
}


def _allows(flag: FeatureFlag, learner: Learner | None) -> bool:
    if not flag.enabled:
        return False
    if flag.roles and (learner is None or learner.role not in flag.roles):
        return False
    if flag.bus and (learner is None or (learner.bu or "") not in flag.bus):
        return False
    return True


def enabled_for(db: Session, learner: Learner | None) -> dict[str, bool]:
    """Every known feature, and whether this person gets it."""
    rows = {f.key: f for f in db.query(FeatureFlag).all()}
    return {
        key: _allows(rows[key], learner) if key in rows else True
        for key in FEATURES
    }


def is_on(db: Session, key: str, learner: Learner | None) -> bool:
    """One feature, for one person. Unknown keys are on: a feature nobody has
    registered cannot have been deliberately switched off."""
    flag = db.query(FeatureFlag).filter(FeatureFlag.key == key).first()
    return _allows(flag, learner) if flag else True
