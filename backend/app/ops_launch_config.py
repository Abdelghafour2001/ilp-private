"""The launch configuration: a learning platform, and nothing else yet.

The feedback after the demo was that the product introduces itself as too many
things at once. Somebody who came to see "a training platform" was shown an
innovation board, a lab runner, a tool-recipe library and a leaderboard, and
read that as four half-products rather than one finished one.

So the first release is narrowed on purpose. Nothing is deleted — every module
stays in the code, keeps its data, and comes back by flipping its switch once
the client asks for it.

    Collaborate  (challenges, sessions, assets)   off — a second phase
    Labs, Stacks                                  off — the engineering half
    Leaderboard                                   staff only, not learners

Skills stays on: it moves *inside* the learner's profile rather than being its
own place in the menu, which is a navigation change, not a switch.

    podman exec -i <backend> python - < app/ops_launch_config.py
"""

from __future__ import annotations

from app.db.session import SessionLocal
from app.models import FeatureFlag

OFF = {
    "challenges": "Phase 2 — the first release is a training platform.",
    "sessions": "Phase 2 — scheduling comes with the live-training rollout.",
    "assets": "Phase 2 — shared notebooks are an engineering-team need.",
    "labs": "Phase 2 — hands-on labs are for the technical audience.",
    "stacks": "Phase 2 — tool recipes are for the technical audience.",
}

# Everyone *except* a plain learner. The switchboard narrows by naming the
# roles that keep a module, so "hide it from learners" is spelled as the list
# of everybody else.
STAFF = ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"]


def main() -> None:
    db = SessionLocal()

    for key, why in OFF.items():
        flag = db.query(FeatureFlag).filter(FeatureFlag.key == key).first() or FeatureFlag(key=key)
        flag.enabled = False
        flag.roles = []
        flag.bus = []
        flag.note = why
        flag.updated_by = "launch configuration"
        db.add(flag)

    board = (
        db.query(FeatureFlag).filter(FeatureFlag.key == "leaderboard").first()
        or FeatureFlag(key="leaderboard")
    )
    board.enabled = True
    board.roles = STAFF
    board.bus = []
    board.note = "Ranking colleagues is a management view, not a learner's."
    board.updated_by = "launch configuration"
    db.add(board)

    db.commit()

    print("Launch configuration applied:\n")
    for flag in db.query(FeatureFlag).order_by(FeatureFlag.key).all():
        who = "everyone" if not flag.roles else ", ".join(flag.roles)
        print(f"  {flag.key:15} {'on ' if flag.enabled else 'OFF'}  {who}")
    print("\nEverything not listed is on for everyone. Flip any of it back at /admin.")
    db.close()


if __name__ == "__main__":
    main()
