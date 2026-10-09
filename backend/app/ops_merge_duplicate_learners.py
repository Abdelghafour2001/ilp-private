"""Fold a duplicate account back into the person it belongs to.

The bulk import keyed on the provider's email, so anyone who already had an
account under a different address got a second one: `abdelghafour.lahrache`
with the platform history and `abdelghafour.lahrache2` with the Coursera rows.
Two accounts for one colleague makes every role test ambiguous and splits the
learning record the platform exists to keep whole.

The account that stays is the original: it carries the role, the team, the
approvals and everything anybody has already decided about this person. The
duplicate hands over its provider rows and certificates, and goes.

    podman exec -i <backend> python - < app/ops_merge_duplicate_learners.py
"""

from __future__ import annotations

from app.core.coursera_link import grant_coursera_xp
from app.db.session import SessionLocal
from app.models import EarnedCertificate, ExternalEnrollment, Learner


def main() -> None:
    db = SessionLocal()

    by_handle = {l.handle: l for l in db.query(Learner).all()}
    pairs = [
        (by_handle[h], by_handle[h + "2"])
        for h in sorted(by_handle)
        if h + "2" in by_handle
    ]

    for keep, drop in pairs:
        moved = (
            db.query(ExternalEnrollment)
            .filter(ExternalEnrollment.learner_id == drop.id)
            .update({"learner_id": keep.id}, synchronize_session=False)
        )

        # A certificate the duplicate recorded belongs to the same person, but
        # only once: the original may already hold it from an earlier link.
        held = {
            (c.title, c.issuer)
            for c in db.query(EarnedCertificate).filter_by(learner_id=keep.id)
        }
        carried = 0
        for cert in db.query(EarnedCertificate).filter_by(learner_id=drop.id).all():
            if (cert.title, cert.issuer) in held:
                db.delete(cert)
            else:
                cert.learner_id = keep.id
                carried += 1

        # The provider's address becomes the one on file: it is the address the
        # sync matches on, and the platform one was never real.
        keep.email = drop.email or keep.email
        keep.name = keep.name or drop.name
        for field in ("bu", "title", "location"):
            if not getattr(keep, field, None):
                setattr(keep, field, getattr(drop, field, "") or "")

        db.delete(drop)
        db.commit()

        xp = grant_coursera_xp(db, keep)
        print(
            f"{keep.handle}: took {moved} enrolments and {carried} certificates "
            f"from {drop.handle} — {xp['granted']} XP, {len(xp['new_badges'])} new badges"
        )

    print(f"merged {len(pairs)} duplicate account(s); roster is now {db.query(Learner).count()}")
    db.close()


if __name__ == "__main__":
    main()
