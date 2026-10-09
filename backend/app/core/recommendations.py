"""What this learner should probably do next, and why.

No model, no scoring vector, no "people like you". Four joins over data the
platform already holds, each of which can state its reason in one sentence the
reader can check:

1. **Finish what you started.** An enrolment between 1% and 99% is the cheapest
   completion available to anybody — the decision to take the course has
   already been made.
2. **One course from a programme you nearly hold.** The specialization
   membership lists make this computable: somebody 9 of 10 through the IBM AI
   Developer certificate is one course from a credential, and nothing in the
   platform tells them so today.
3. **What your unit is taking.** The most-enrolled courses among colleagues in
   the same business unit, minus whatever they already have. This is the "top
   enrolled" list, scoped to the people whose job most resembles theirs.
4. **What the organisation is taking.** The same thing company-wide, as the
   fallback for somebody whose unit has no Coursera history yet.

The reason matters as much as the recommendation. "Recommended for you" with no
justification is advertising; "4 colleagues in Data & AI took this" is a fact
the reader can weigh. Each item therefore carries the sentence that produced it,
and anything that cannot produce one does not belong on the list.

Ordering is by how close the thing is to done, not by popularity: a course at
80% outranks a course twenty colleagues took, because one is twenty minutes of
work and the other is twenty hours.
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import specializations
from app.models import Course, ExternalEnrollment, Learner

# How many of each kind to offer. Small on purpose: a list of twenty
# recommendations is a catalogue, and a catalogue is what they already have.
PER_REASON = 3
POPULAR_MIN_PEOPLE = 2


def _catalogue(db: Session, slugs: set[str]) -> dict[str, Course]:
    """The catalogue entries for these provider slugs, when they were imported.

    A course we hold is linked inside the app, where the assignment and the
    progress live; one we do not is linked straight to the provider. Both are
    useful, and pretending the second does not exist would hide most of the
    catalogue.
    """
    if not slugs:
        return {}
    found: dict[str, Course] = {}
    for course in db.query(Course).filter(Course.external_url != "").all():
        from app.core.external_progress import slug_from_url

        slug = slug_from_url(course.external_url)
        if slug in slugs and slug not in found:
            found[slug] = course
    return found


def _item(title: str, reason: str, kind: str, slug: str, course: Course | None,
          percent: int = 0) -> dict:
    return {
        "title": title,
        "reason": reason,
        "kind": kind,
        "percent": percent,
        "slug": slug,
        "course_id": course.id if course else None,
        # In the app when we hold it, on the provider when we do not.
        "link": f"/courses/{course.id}" if course else f"https://www.coursera.org/learn/{slug}",
        "external": course is None,
    }


def for_learner(db: Session, learner_id: int) -> list[dict]:
    learner = db.get(Learner, learner_id)
    if not learner:
        return []

    mine = (
        db.query(ExternalEnrollment)
        .filter(ExternalEnrollment.learner_id == learner_id)
        .all()
    )
    my_slugs = {r.course_slug for r in mine if r.course_slug}
    items: list[dict] = []

    # --- 1. unfinished -----------------------------------------------------
    unfinished = sorted(
        (r for r in mine if r.course_slug and not r.completed and 0 < (r.progress_pct or 0) < 100),
        key=lambda r: -(r.progress_pct or 0),
    )[:PER_REASON]
    catalogue = _catalogue(db, {r.course_slug for r in unfinished})
    for row in unfinished:
        items.append(_item(
            row.course_title or row.course_slug,
            f"Started and {row.progress_pct}% done — the cheapest completion you have.",
            "finish", row.course_slug, catalogue.get(row.course_slug), row.progress_pct or 0,
        ))

    # --- 2. one course from a programme ------------------------------------
    near = [
        spec
        for spec in specializations.for_learner(db, learner_id)
        if not spec["complete"] and 0 < len(spec["missing"]) <= 2
    ][:PER_REASON]
    catalogue = _catalogue(db, {slug for spec in near for slug in spec["missing"]})
    for spec in near:
        left = len(spec["missing"])
        for slug in spec["missing"]:
            items.append(_item(
                slug.replace("-", " ").title(),
                f"{spec['done']} of {spec['courses']} courses of “{spec['name']}” done — "
                + ("this is the last one." if left == 1 else f"{left} left."),
                "programme", slug, catalogue.get(slug),
            ))

    # --- 3 & 4. what colleagues are taking ---------------------------------
    for scope, label in (("unit", learner.bu), ("org", "")):
        if scope == "unit" and not learner.bu:
            continue
        query = (
            db.query(
                ExternalEnrollment.course_slug,
                ExternalEnrollment.course_title,
                func.count(func.distinct(ExternalEnrollment.matched_email)),
            )
            .filter(ExternalEnrollment.provider == "coursera")
            .filter(ExternalEnrollment.course_slug != "")
            .filter(ExternalEnrollment.course_slug.notin_(my_slugs or {""}))
        )
        if scope == "unit":
            # Colleagues are people with the same unit *here*, not rows carrying
            # the same unit name on the provider: Coursera's profile fields
            # still hold its own org names (HCMS, Support F…), which stopped
            # matching the day the organisation was re-taxonomised.
            colleagues = [
                i for (i,) in db.query(Learner.id).filter(Learner.bu == learner.bu).all()
                if i != learner_id
            ]
            if not colleagues:
                continue
            query = query.filter(ExternalEnrollment.learner_id.in_(colleagues))
        rows = (
            query.group_by(ExternalEnrollment.course_slug, ExternalEnrollment.course_title)
            .order_by(func.count(func.distinct(ExternalEnrollment.matched_email)).desc())
            .limit(PER_REASON)
            .all()
        )
        rows = [r for r in rows if r[2] >= POPULAR_MIN_PEOPLE]
        catalogue = _catalogue(db, {r[0] for r in rows})
        for slug, title, people in rows:
            where = f"in {label}" if scope == "unit" else "across the organisation"
            items.append(_item(
                title or slug,
                f"{people} colleagues {where} have taken it.",
                "popular_unit" if scope == "unit" else "popular_org",
                slug, catalogue.get(slug),
            ))
        # The organisation-wide list is a fallback, not an addition: somebody
        # whose unit is active does not need both.
        if scope == "unit" and rows:
            break

    # Nearest to done first; a half-finished course beats a popular one.
    order = {"finish": 0, "programme": 1, "popular_unit": 2, "popular_org": 3}
    items.sort(key=lambda i: (order[i["kind"]], -i["percent"]))
    # One row per course, whatever reason found it first.
    seen: set[str] = set()
    unique = []
    for item in items:
        if item["slug"] in seen:
            continue
        seen.add(item["slug"])
        unique.append(item)
    return unique
