"""Multi-course programmes somebody finished, worked out from their courses.

Coursera's enterprise feed reports one row per *course*. A specialization or a
professional certificate — the thing a person actually puts on their CV, and the
thing a budget was approved for — is never reported at all. So the platform
could say somebody finished eleven courses and not that those eleven courses are
the IBM Data Analyst certificate.

The public catalogue closes the gap in two steps, and neither needs a contract:

1. **Discovery.** Ask the catalogue which programmes contain a course somebody
   finished (`courses.v1 … fields=s12nIds`). The set of programmes worth knowing
   about therefore builds itself out of the completions already stored — there is
   no list of slugs to maintain, which matters because the catalogue offers no
   search endpoint to look them up with.
2. **Membership.** Ask what a programme is made of
   (`onDemandSpecializations.v1`), store the member course slugs, and compare
   them with what the person completed.

What this gives, stated plainly because the number goes into HR reporting:

* It **never over-reports.** Every member course has to be complete.
* It **under-reports** when a member course is missing from the enterprise feed
  — somebody took it outside the organisation's licence, so there is no row for
  it here and the programme looks unfinished. Measured against the real data,
  roughly one programme in three is affected. The partial count is therefore
  shown rather than hidden: "9 of 10" is useful, and silently dropping it is not.
* It is **derived**, not the certificate Coursera issued. Decided (Oct 2026):
  ship the derived figure labelled as a floor, and reconcile it later against
  Coursera's own specialization-completions export, stored alongside rather
  than replacing it — where the two disagree, what you learn is which courses
  the licence does not cover. The import is not built: it needs one sample of
  that export to be written against, and guessing its columns would produce a
  parser nobody can trust.
"""

from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.models import ExternalEnrollment, ExternalSpecialization, Learner, LearningRecord

log = logging.getLogger(__name__)


def refresh(db: Session, provider: str = "coursera", full: bool = False) -> dict:
    """Learn the membership of every programme behind a completed course.

    One catalogue call per distinct completed course — a few minutes on an
    organisation of this size, and cheap after that because only programmes
    that are not stored yet have their membership fetched. Each course's
    programmes are committed as they are found, so a catalogue outage halfway
    through loses nothing and the next run carries on from there.
    """
    from app.connectors.coursera import CourseraCatalog

    completed = {
        slug
        for (slug,) in db.query(ExternalEnrollment.course_slug)
        .filter(ExternalEnrollment.provider == provider)
        .filter(ExternalEnrollment.completed.is_(True))
        .distinct()
        if slug
    }
    stored = db.query(ExternalSpecialization).filter_by(provider=provider).all()
    by_slug = {row.slug: row for row in stored}
    known_ids = {row.external_id for row in stored if row.external_id}

    # Two passes, because the honest one is not cheap:
    #
    # * `full` asks the catalogue about *every* completed course. It has to:
    #   a course usually belongs to several programmes, so skipping one already
    #   named in a stored programme hides its other parents — that shortcut cost
    #   five earned programmes out of fifty on the real data. One call per
    #   distinct completed course, a few minutes; a nightly job's work.
    # * the default asks only about courses no stored programme mentions, which
    #   is every *new* completion and nothing else. Near-free, and what a sync
    #   that runs every few minutes must do unless we want to call a public API
    #   four hundred times an hour.
    covered: set[str] = set()
    if not full:
        covered = {slug for row in stored for slug in row.course_slugs}
        # Narrower still: only courses finished since the last pass looked. A
        # course that belongs to no programme at all — an organisation's own
        # content, a Coursera Instructor Network session — is never "covered",
        # so without this it would be asked about on every single run, forever.
        # Rows with no completion date are left to the nightly full pass.
        last = max((row.synced_at for row in stored if row.synced_at), default=None)
        if last:
            fresh = {
                slug
                for (slug,) in db.query(ExternalEnrollment.course_slug)
                .filter(ExternalEnrollment.provider == provider)
                .filter(ExternalEnrollment.completed.is_(True))
                .filter(ExternalEnrollment.completed_at >= last - dt.timedelta(days=1))
                .distinct()
                if slug
            }
            completed &= fresh

    looked_up = created = updated = 0
    now = dt.datetime.now(dt.timezone.utc)
    with CourseraCatalog() as catalog:
        for course_slug in sorted(completed - covered):
            looked_up += 1
            ids = catalog.specialization_ids(course_slug)
            # Membership is only fetched for programmes not stored yet; that
            # half of the memo loses nothing, because a programme's member list
            # is the same whichever of its courses led us to it.
            for spec in catalog.specializations([i for i in ids if i not in known_ids]):
                if not spec["slug"]:
                    continue
                slugs = catalog.course_slugs(spec["course_ids"])
                members = [slugs[i] for i in spec["course_ids"] if slugs.get(i)]
                if not members:
                    continue
                row = by_slug.get(spec["slug"])
                if row:
                    updated += 1
                else:
                    row = ExternalSpecialization(provider=provider, slug=spec["slug"])
                    db.add(row)
                    by_slug[spec["slug"]] = row
                    created += 1
                row.external_id = spec["external_id"]
                row.name = spec["name"]
                row.partner_names = ", ".join(catalog.partner_names(spec["partner_ids"]).values())
                row.url = spec["url"]
                row.logo_url = spec["logo_url"]
                row.course_slugs = members
                row.synced_at = now
                known_ids.add(spec["external_id"])
                covered.update(members)
            db.commit()

    summary = {
        "pass": "full" if full else "new completions only",
        "completed_courses": len(completed),
        "courses_looked_up": looked_up,
        "programmes_created": created,
        "programmes_updated": updated,
        "programmes_known": len(by_slug),
    }
    log.info("coursera specializations: %s", summary)
    return summary


def _completions(db: Session, learner_id: int) -> tuple[dict[str, dt.date | None], set[str]]:
    """Course slug -> the day it was finished. Plus which ones were declared.

    Two sources, because the feed cannot see everything: enrolments the
    provider reported, and courses the person logged themselves. The second
    exists because Coursera's enterprise report only carries enrolments made
    through one of the organisation's programmes — anything taken on a personal
    account is invisible to every integration, so the only way it can be known
    is somebody saying so.

    A declaration is weaker evidence than a sync, so the two never merge
    silently: the set of declared slugs is returned alongside, and anything
    built on top says which part of a programme rests on a claim.
    """
    done: dict[str, dt.date | None] = {}
    rows = (
        db.query(ExternalEnrollment.course_slug, ExternalEnrollment.completed_at)
        .filter(ExternalEnrollment.learner_id == learner_id)
        .filter(ExternalEnrollment.completed.is_(True))
        .all()
    )
    for slug, completed_at in rows:
        if slug:
            done[slug] = completed_at.date() if completed_at else None

    declared: set[str] = set()
    claims = (
        db.query(LearningRecord.external_slug, LearningRecord.completed_on)
        .filter(LearningRecord.learner_id == learner_id)
        .filter(LearningRecord.external_slug != "")
        .filter(LearningRecord.review_status != "declined")
        .all()
    )
    for slug, completed_on in claims:
        if slug and slug not in done:
            done[slug] = completed_on
            declared.add(slug)
    return done, declared


def for_learner(db: Session, learner_id: int, provider: str = "coursera") -> list[dict]:
    """Every programme this person has touched, the finished ones first.

    A programme with nothing done is left out; one that is part-done is kept,
    because "9 of 10 courses of the IBM AI Developer certificate" is the most
    useful line on the page — it is either a nudge or the evidence that the feed
    is missing a course they really did.
    """
    done, declared = _completions(db, learner_id)
    if not done:
        return []
    out = []
    for row in db.query(ExternalSpecialization).filter_by(provider=provider).all():
        members = list(row.course_slugs)
        finished = [slug for slug in members if slug in done]
        if not finished:
            continue
        complete = len(finished) == len(members)
        dates = [done[slug] for slug in finished if done[slug]]
        out.append({
            "slug": row.slug,
            "name": row.name,
            "partner": row.partner_names,
            "url": row.url,
            "logo_url": row.logo_url,
            "courses": len(members),
            "done": len(finished),
            "complete": complete,
            # The day the last member course was finished is the day the
            # programme itself was earned.
            "earned_on": max(dates).isoformat() if complete and dates else "",
            "missing": [slug for slug in members if slug not in done],
            # Courses counted here on the learner's word rather than on the
            # provider's report. A reviewer should see which ones they are
            # before quoting the programme as earned.
            "declared": [slug for slug in finished if slug in declared],
        })
    out.sort(key=lambda s: (not s["complete"], -s["done"], s["name"]))
    return out


def earned_count(db: Session, learner_id: int, provider: str = "coursera") -> int:
    """How many programmes this person has completed in full. For badges."""
    return sum(1 for spec in for_learner(db, learner_id, provider) if spec["complete"])


def org_totals(db: Session, provider: str = "coursera") -> dict:
    """Programmes earned across the organisation, and by how many people.

    Counted in one pass rather than per learner: the person card asks about one
    learner, the HR board asks about everyone, and an HR page that fires 250
    queries to print one number is a page nobody loads twice.
    """
    specs = [
        list(row.course_slugs)
        for row in db.query(ExternalSpecialization).filter_by(provider=provider).all()
    ]
    if not specs:
        return {"programmes_known": 0, "earned": 0, "people": 0}

    rows = (
        db.query(ExternalEnrollment.matched_email, ExternalEnrollment.learner_id,
                 ExternalEnrollment.course_slug)
        .filter(ExternalEnrollment.provider == provider)
        .filter(ExternalEnrollment.completed.is_(True))
        .all()
    )
    # Keyed on the provider email, not the learner: most of these people have no
    # account here yet, and leaving them out would understate the organisation.
    by_person: dict[str, set[str]] = {}
    for email, learner_id, slug in rows:
        if slug:
            by_person.setdefault(email or f"learner-{learner_id}", set()).add(slug)

    # Courses people logged themselves, keyed the same way. Same rule as the
    # person card, so the tile and the card cannot disagree — and counted
    # separately as well, because a figure that leans on claims should say so.
    declared_by_person: dict[str, set[str]] = {}
    claims = (
        db.query(Learner.email, Learner.id, LearningRecord.external_slug)
        .join(LearningRecord, LearningRecord.learner_id == Learner.id)
        .filter(LearningRecord.external_slug != "")
        .filter(LearningRecord.review_status != "declined")
        .all()
    )
    for email, learner_id, slug in claims:
        key = (email or "").lower() or f"learner-{learner_id}"
        declared_by_person.setdefault(key, set()).add(slug)
        by_person.setdefault(key, set()).add(slug)

    earned = people = leaning_on_claims = 0
    for key, done in by_person.items():
        claimed = declared_by_person.get(key, set())
        mine = 0
        for members in specs:
            if not members or not set(members) <= done:
                continue
            mine += 1
            if claimed & set(members):
                leaning_on_claims += 1
        earned += mine
        people += int(mine > 0)
    return {
        "programmes_known": len(specs),
        "earned": earned,
        "people": people,
        # Of those, how many need at least one self-declared course to add up.
        "with_declared": leaning_on_claims,
    }
