"""Give every person Coursera knows about an AIDA account, and link it.

The roster here was invented: ava, liam, maya, noah. Meanwhile the provider
knows 261 real colleagues with names, business units, job titles and managers,
and only a handful of them had an account. Reporting on invented people while
the real population sits unmatched is the identity gap the whole linking
machinery exists to close, so this closes it in bulk.

For each provider account it creates a learner if none exists, fills the HR
fields the provider knows, then runs the ordinary link operation — the same one
the admin screen calls — so certificates are backfilled, XP is granted and
badges are evaluated. Idempotent: re-running adopts new rows and leaves
everything else alone.

    podman exec -i <backend> python - < app/ops_import_coursera_people.py
"""

from __future__ import annotations

import re

from app.core.coursera_link import link_learner
from app.db.session import SessionLocal
from app.models import ExternalEnrollment, Learner

# Accounts that only ever existed to make a demo screen look populated. They
# carry no real learning, and leaving them beside 261 real colleagues is how a
# roster stops being believable.
# `amina` is left alone deliberately: she owns a published training, and
# removing an owner to tidy a roster is how content loses its author.
PLACEHOLDERS = ("ava", "liam", "maya", "noah", "sofia", "mehdi")


def handle_for(email: str, taken: set[str]) -> str:
    """A handle from the email's local part, unique against what exists."""
    base = re.sub(r"[^a-z0-9._-]", "", email.split("@")[0].lower()) or "colleague"
    handle = base[:40]
    n = 2
    while handle in taken:
        handle = f"{base[:36]}{n}"
        n += 1
    taken.add(handle)
    return handle


def main() -> None:
    db = SessionLocal()

    rows = db.query(ExternalEnrollment).filter(ExternalEnrollment.provider == "coursera").all()
    # Keep the richest row per person: the provider leaves HR fields blank on
    # plenty of them, and one filled row is enough to place somebody.
    profiles: dict[str, ExternalEnrollment] = {}
    for row in rows:
        email = (row.matched_email or "").strip().lower()
        if not email:
            continue
        best = profiles.get(email)
        if best is None or (row.business_unit and not best.business_unit):
            profiles[email] = row

    existing = {l.email.strip().lower(): l for l in db.query(Learner) if l.email}
    taken = {l.handle for l in db.query(Learner)}

    created = linked = 0
    for email, row in sorted(profiles.items()):
        learner = existing.get(email)
        if learner is None:
            learner = Learner(
                handle=handle_for(email, taken),
                email=row.matched_email,
                name=row.full_name or email,
                role="user",
                bu=row.business_unit or "",
                title=row.job_title or "",
                location=row.location_city or "",
                locale="fr",
            )
            db.add(learner)
            db.flush()
            created += 1
        else:
            # Fill only what is blank; never overwrite something L&D set here.
            for field, value in (
                ("name", row.full_name),
                ("bu", row.business_unit),
                ("title", row.job_title),
                ("location", row.location_city),
            ):
                if value and not getattr(learner, field, None):
                    setattr(learner, field, value)
        db.commit()

        result = link_learner(db, learner, email)
        if result.get("linked"):
            linked += 1

    print(f"created {created} accounts, linked {linked} of {len(profiles)} provider accounts")

    removed = []
    for handle in PLACEHOLDERS:
        learner = db.query(Learner).filter(Learner.handle == handle).first()
        if learner:
            removed.append(handle)
            db.delete(learner)
    db.commit()
    print("removed placeholders:", ", ".join(removed) or "none")

    total = db.query(Learner).count()
    print(f"roster is now {total} accounts")
    db.close()


if __name__ == "__main__":
    main()
