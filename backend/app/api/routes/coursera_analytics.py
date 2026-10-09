"""Reporting on what the organisation actually does on Coursera.

Three endpoints, one data source: the enrolment rows the nightly sync stores.

The awkward part this has to handle honestly is identity. Coursera knows 256
people; AIDA knows the ones who have signed in. Most rows therefore have no
`learner_id`, and reporting only on the matched ones would understate the truth
by an order of magnitude. So these views group by the *provider's* own fields —
email, business unit, programme — and report the matched share separately. The
HR board keeps working the other way round, on people who exist here.
"""

from __future__ import annotations

import datetime as dt
import re
import json
import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.rbac import can_read_reporting
from app.db.session import get_db
from app.models import ExternalEnrollment, Learner

router = APIRouter(prefix="/analytics/coursera", tags=["analytics"])
log = logging.getLogger(__name__)

# Below this, a learner is enrolled but has not started. It is the single most
# actionable number here: licences paid for and never opened.
STARTED_PCT = 1


def _guard(db: Session, learner_id: int | None, token: str | None) -> None:
    viewer = db.get(Learner, learner_id) if learner_id else None
    if not can_read_reporting(viewer, token):
        raise HTTPException(status_code=403, detail="HR, L&D or an admin only.")


def _rows(db: Session) -> list[ExternalEnrollment]:
    return db.query(ExternalEnrollment).filter(ExternalEnrollment.provider == "coursera").all()


def _group(rows: list[ExternalEnrollment], key) -> list[dict]:
    """Enrolments, completions, hours and people per value of `key`."""
    buckets: dict[str, dict] = defaultdict(
        lambda: {"enrollments": 0, "completed": 0, "hours": 0.0, "people": set(), "not_started": 0}
    )
    for row in rows:
        b = buckets[key(row) or "—"]
        b["enrollments"] += 1
        b["completed"] += int(row.completed)
        b["hours"] += row.hours or 0.0
        b["people"].add(row.matched_email)
        b["not_started"] += int((row.progress_pct or 0) < STARTED_PCT and not row.completed)
    out = [
        {
            "label": label,
            "enrollments": b["enrollments"],
            "completed": b["completed"],
            "not_started": b["not_started"],
            "hours": round(b["hours"], 1),
            "people": len(b["people"]),
            "completion_rate": round(100 * b["completed"] / b["enrollments"]) if b["enrollments"] else 0,
        }
        for label, b in buckets.items()
    ]
    out.sort(key=lambda r: -r["enrollments"])
    return out


def _by_person(rows: list[ExternalEnrollment]) -> list[dict]:
    people: dict[str, dict] = {}
    for row in rows:
        email = row.matched_email or "—"
        person = people.setdefault(email, {
            "email": email,
            "name": row.full_name or email,
            "business_unit": row.business_unit,
            "job_title": row.job_title,
            "location": row.location_city,
            "manager": row.manager_name,
            "program": row.program_name,
            "learner_id": row.learner_id,
            "enrollments": 0,
            "completed": 0,
            "not_started": 0,
            "hours": 0.0,
            "certificates": 0,
            "last_activity": None,
        })
        person["enrollments"] += 1
        person["completed"] += int(row.completed)
        person["not_started"] += int((row.progress_pct or 0) < STARTED_PCT and not row.completed)
        person["hours"] += row.hours or 0.0
        person["certificates"] += int(bool(row.certificate_url))
        last = row.last_activity_at or row.completed_at
        if last and (person["last_activity"] is None or last > person["last_activity"]):
            person["last_activity"] = last
        # Keep the richest profile seen: some rows carry no business unit.
        for field, value in (
            ("business_unit", row.business_unit), ("job_title", row.job_title),
            ("location", row.location_city), ("manager", row.manager_name),
        ):
            if not person[field] and value:
                person[field] = value
    for person in people.values():
        person["hours"] = round(person["hours"], 1)
        person["completion_rate"] = (
            round(100 * person["completed"] / person["enrollments"]) if person["enrollments"] else 0
        )
        person["last_activity"] = person["last_activity"].date().isoformat() if person["last_activity"] else None
    return list(people.values())


@router.get("/overview")
def overview(
    learner_id: int | None = None,
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Headline numbers, breakdowns and a twelve-month completion trend."""
    from app.core import specializations

    _guard(db, learner_id, x_admin_token)
    rows = _rows(db)
    if not rows:
        return {"synced_at": None, "totals": {}, "by": {}, "trend": [], "top_courses": []}

    people = _by_person(rows)
    completed = [r for r in rows if r.completed]
    graded = [r.grade for r in rows if r.grade is not None]
    hours = sum(r.hours or 0.0 for r in rows)
    not_started = sum(1 for r in rows if (r.progress_pct or 0) < STARTED_PCT and not r.completed)
    in_progress = len(rows) - len(completed) - not_started

    today = dt.date.today()
    # Walk the calendar, not 31-day steps: subtracting 31 days repeatedly skips
    # a month every time it crosses a 30-day one, which dropped June from the
    # series and made the following month look like a recovery.
    months = []
    year, month = today.year, today.month
    for _ in range(12):
        months.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    months.reverse()
    per_month = defaultdict(int)
    for row in completed:
        if row.completed_at:
            per_month[row.completed_at.strftime("%Y-%m")] += 1

    courses: dict[str, dict] = defaultdict(lambda: {"enrollments": 0, "completed": 0, "hours": 0.0, "partner": ""})
    for row in rows:
        c = courses[row.course_title or row.course_slug]
        c["enrollments"] += 1
        c["completed"] += int(row.completed)
        c["hours"] += row.hours or 0.0
        c["partner"] = c["partner"] or row.partner_names
    top_courses = sorted(
        (
            {
                "title": title,
                "partner": c["partner"],
                "enrollments": c["enrollments"],
                "completed": c["completed"],
                "hours": round(c["hours"], 1),
                "completion_rate": round(100 * c["completed"] / c["enrollments"]),
            }
            for title, c in courses.items()
        ),
        key=lambda c: -c["enrollments"],
    )[:15]

    return {
        "synced_at": max((r.synced_at for r in rows if r.synced_at), default=None),
        "contract": next((r.contract_name for r in rows if r.contract_name), ""),
        "totals": {
            "people": len(people),
            "enrollments": len(rows),
            "completed": len(completed),
            "in_progress": in_progress,
            "not_started": not_started,
            "completion_rate": round(100 * len(completed) / len(rows)),
            "hours": round(hours, 1),
            "man_days": round(hours / 8, 1),
            "certificates": sum(1 for r in rows if r.certificate_url),
            "avg_grade": round(100 * sum(graded) / len(graded)) if graded else None,
            # The identity gap, stated rather than hidden: these people have no
            # AIDA account, so nothing here reaches their learner profile.
            "matched_people": len({r.matched_email for r in rows if r.learner_id}),
            # Specializations and professional certificates, derived from the
            # completed courses: the provider's report never names them, so this
            # is the only place the organisation can see them at all.
            "specializations": specializations.org_totals(db),
            "active_90d": sum(
                1
                for p in people
                if p["last_activity"]
                and dt.date.fromisoformat(p["last_activity"]) >= today - dt.timedelta(days=90)
            ),
        },
        "by": {
            "program": _group(rows, lambda r: r.program_name),
            "business_unit": _group(rows, lambda r: r.business_unit),
            "location": _group(rows, lambda r: r.location_city),
            "partner": _group(rows, lambda r: r.partner_names)[:10],
            "content_type": _group(rows, lambda r: r.content_type),
            "manager": _group(rows, lambda r: r.manager_name)[:10],
        },
        "trend": [{"label": m, "value": per_month.get(m, 0)} for m in months],
        "top_courses": top_courses,
    }


@router.get("/learners")
def learners(
    learner_id: int | None = None,
    search: str = "",
    program: str = "",
    business_unit: str = "",
    status: str = "all",  # all | active | stalled | inactive
    sort: str = "hours",  # hours | completed | enrollments | completion_rate | name | last_activity
    direction: str = "desc",
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """One row per person on Coursera, filtered and sorted."""
    _guard(db, learner_id, x_admin_token)
    people = _by_person(_rows(db))

    needle = search.strip().lower()
    if needle:
        people = [p for p in people if needle in p["name"].lower() or needle in p["email"].lower()]
    if program:
        people = [p for p in people if p["program"] == program]
    if business_unit:
        people = [p for p in people if p["business_unit"] == business_unit]
    if status == "active":
        people = [p for p in people if p["completed"] > 0]
    elif status == "stalled":
        # Enrolled in something, finished nothing: the population worth a nudge.
        people = [p for p in people if p["completed"] == 0 and p["enrollments"] > 0]
    elif status == "inactive":
        people = [p for p in people if p["not_started"] == p["enrollments"]]

    key = sort if sort in ("hours", "completed", "enrollments", "completion_rate") else None
    if key:
        people.sort(key=lambda p: p[key], reverse=direction != "asc")
    elif sort == "last_activity":
        people.sort(key=lambda p: p["last_activity"] or "", reverse=direction != "asc")
    else:
        people.sort(key=lambda p: p["name"].lower(), reverse=direction == "desc")

    return {
        "total": len(people),
        "items": people[offset : offset + limit],
        "programs": sorted({p["program"] for p in people if p["program"]}),
        "business_units": sorted({p["business_unit"] for p in people if p["business_unit"]}),
    }


# --------------------------------------------------------------------------- #
# Written analysis                                                            #
# --------------------------------------------------------------------------- #
# The findings below are computed, not generated: each one is a comparison with
# a threshold, so the same data always produces the same statements and every
# number in them can be traced back to a row. The model is asked to write the
# commentary *around* those findings when one is configured — and when it is
# not, or it fails, the report still stands on the computed half. A report that
# silently disappears because an LLM is unreachable is worse than a plain one.


def _findings(data: dict) -> list[str]:
    t = data["totals"]
    out: list[str] = []
    if t["enrollments"]:
        share = round(100 * t["not_started"] / t["enrollments"])
        if share >= 20:
            out.append(
                f"{t['not_started']} enrolments ({share}%) have never been opened — "
                "licence spend with nothing behind it."
            )
    if t["completion_rate"] < 40:
        out.append(
            f"Overall completion is {t['completion_rate']}%. Most started content is not finished."
        )
    stale = t["people"] - t["active_90d"]
    if stale > 0:
        out.append(
            f"{stale} of {t['people']} people have no activity in the last 90 days."
        )
    if t["matched_people"] < t["people"]:
        gap = t["people"] - t["matched_people"]
        out.append(
            f"{gap} Coursera accounts are not linked to an UpSkill account, so their hours "
            "do not reach the learner's own profile or the HR board."
        )
    programs = data["by"]["program"]
    if len(programs) >= 2:
        best = max(programs, key=lambda p: p["completion_rate"])
        worst = min(programs, key=lambda p: p["completion_rate"])
        if best["completion_rate"] - worst["completion_rate"] >= 20:
            out.append(
                f"Completion varies widely by programme: {best['label']} at {best['completion_rate']}% "
                f"against {worst['label']} at {worst['completion_rate']}%."
            )
    units = [u for u in data["by"]["business_unit"] if u["label"] != "—" and u["enrollments"] >= 20]
    if units:
        lagging = min(units, key=lambda u: u["completion_rate"])
        if lagging["completion_rate"] < 30:
            out.append(
                f"{lagging['label']} finishes {lagging['completion_rate']}% of its "
                f"{lagging['enrollments']} enrolments — the weakest unit above 20 enrolments."
            )
    dead = [c for c in data["top_courses"] if c["enrollments"] >= 20 and c["completion_rate"] < 15]
    if dead:
        names = ", ".join(c["title"] for c in dead[:3])
        out.append(f"Heavily enrolled but rarely finished: {names}.")
    recent = [m["value"] for m in data["trend"][-3:]]
    earlier = [m["value"] for m in data["trend"][-6:-3]]
    if sum(earlier) and sum(recent) < sum(earlier) * 0.6:
        out.append(
            f"Completions are falling: {sum(recent)} in the last three months against "
            f"{sum(earlier)} in the three before."
        )
    return out


def _plain_report(data: dict, findings: list[str]) -> str:
    t = data["totals"]
    lines = [
        "## Coursera — activity report",
        "",
        f"**{t['people']} people · {t['enrollments']} enrolments · {t['completed']} completions "
        f"({t['completion_rate']}%) · {t['hours']} hours ({t['man_days']} person-days) · "
        f"{t['certificates']} certificates**",
        "",
        "### What stands out",
    ]
    lines += [f"- {f}" for f in findings] or ["- Nothing outside the usual range."]
    lines += ["", "### By programme", ""]
    for p in data["by"]["program"][:8]:
        lines.append(
            f"- **{p['label']}** — {p['people']} people, {p['enrollments']} enrolments, "
            f"{p['completion_rate']}% complete, {p['hours']} h"
        )
    lines += ["", "### Most enrolled content", ""]
    for c in data["top_courses"][:8]:
        lines.append(
            f"- **{c['title']}** ({c['partner'] or 'n/a'}) — {c['enrollments']} enrolments, "
            f"{c['completion_rate']}% complete"
        )
    return "\n".join(lines)


@router.post("/report")
def report(
    learner_id: int | None = None,
    locale: str = "fr",
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """A written analysis of the Coursera activity, for a steering committee."""
    _guard(db, learner_id, x_admin_token)
    data = overview(learner_id=learner_id, x_admin_token=x_admin_token, db=db)
    if not data["totals"]:
        raise HTTPException(status_code=409, detail="No Coursera data synced yet.")

    findings = _findings(data)
    plain = _plain_report(data, findings)

    from app.core.config import settings

    if not settings.ai_enabled:
        return {"markdown": plain, "generated_by": "computed", "findings": findings}

    language = "French" if locale == "fr" else "English"
    facts = {
        "totals": data["totals"],
        "by_program": data["by"]["program"][:8],
        "by_business_unit": data["by"]["business_unit"][:8],
        "by_location": data["by"]["location"][:5],
        "top_courses": data["top_courses"][:10],
        "completions_by_month": data["trend"],
        "computed_findings": findings,
    }
    try:
        from app.ai.providers import complete_text

        markdown = complete_text(
            "You write the learning section of a steering-committee pack for a company's "
            "L&D team. You are given verified figures about the company's Coursera "
            "activity. Write in " + language + ", in Markdown, around 400 words.\n\n"
            "Rules: use only the numbers provided — never invent one, and never round a "
            "figure into a different claim. Lead with what the reader should do, not with "
            "a description of the dataset. Name programmes, units and courses explicitly. "
            "Where a number is bad, say so plainly and say what would change it. Close with "
            "three concrete recommendations. No preamble, no apology, no bullet-point soup: "
            "short sections with headings, prose in between.",
            "Figures (JSON):\n" + json.dumps(facts, ensure_ascii=False, default=str),
            max_tokens=1800,
        )
        if len(markdown) > 200:
            return {"markdown": markdown, "generated_by": settings.ai_model_name, "findings": findings}
    except Exception as exc:  # noqa: BLE001 — a missing model must not lose the report
        log.warning("coursera report: model unavailable (%s); serving the computed one", exc)
    return {"markdown": plain, "generated_by": "computed", "findings": findings}


def _provider_email(db: Session, email: str) -> str:
    """The address Coursera knows this person by, given their AIDA address.

    The two are often different — people signed up with a personal address — so
    a link built from the org chart carries the AIDA one and would otherwise
    miss every enrolment.
    """
    learner = db.query(Learner).filter(Learner.email.ilike(email.strip())).first()
    if not learner:
        return ""
    row = (
        db.query(ExternalEnrollment)
        .filter(
            ExternalEnrollment.learner_id == learner.id,
            ExternalEnrollment.matched_email != "",
        )
        .first()
    )
    return (row.matched_email or "") if row else ""


def _empty_person(db: Session, email: str, window) -> dict | None:
    """The same shape, for somebody with no provider activity at all.

    Built from the learner rather than from enrolment rows, so the page can
    show who they are and what they have done here while stating plainly that
    there is nothing on the provider side.
    """
    learner = db.query(Learner).filter(Learner.email.ilike(email.strip())).first()
    if not learner:
        return None
    blank = {"completions": 0, "hours": 0.0, "certificates": 0, "starts": 0, "active_people": 0}
    return {
        "period": window.label,
        "start": window.start,
        "end": window.end,
        "prev_start": window.prev_start,
        "prev_end": window.prev_end,
        "person": {
            "name": learner.name or learner.handle,
            "email": learner.email or email,
            "unit": learner.bu or "Not stated",
            "job_title": learner.title or "Not stated",
            "location": learner.location or "Not stated",
            "manager": "Not stated",
            "linked": False,
            "learner_id": learner.id,
            "programs": [],
        },
        "now": dict(blank),
        "before": {k: blank[k] for k in ("completions", "hours", "certificates")},
        "totals": {
            "enrollments": 0, "completed": 0, "in_progress": 0, "never_opened": 0,
            "completion_rate": 0, "hours": 0.0, "man_days": 0.0, "certificates": 0,
        },
        "benchmark": {
            "unit_label": "Not stated", "unit_people": 0,
            "unit_median_hours": 0.0, "unit_median_rate": 0.0,
            "org_people": 0, "org_median_hours": 0.0, "org_median_rate": 0.0,
        },
        "items": [],
        "by_program": [],
    }


def _first_day(db: Session, email: str = "") -> dt.date:
    """The day this account — or the whole organisation — first did anything."""
    from sqlalchemy import func, or_

    q = db.query(
        func.min(ExternalEnrollment.enrolled_at),
        func.min(ExternalEnrollment.completed_at),
        func.min(ExternalEnrollment.last_activity_at),
    ).filter(ExternalEnrollment.provider == "coursera")
    if email:
        q = q.filter(ExternalEnrollment.matched_email.ilike(email.strip()))
    days = [d.date() for d in q.one() if d]
    return min(days) if days else dt.date.today()


def _window(period: str, ref: str, start: str, end: str, locale: str = "en", db: Session | None = None,
            email: str = ""):
    """The stretch of time this report covers.

    A `start`/`end` pair wins: that is somebody picking dates on a calendar.
    Next comes the named period, which is the shortcut the quick buttons use.
    Asked for with neither, the answer is the whole record — the report is then
    the account's entire history rather than an arbitrary current month.
    """
    from app.core import activity_report

    if not start and not end and not period:
        assert db is not None, "a full-history window has to be measured against the rows"
        return activity_report.window_everything(_first_day(db, email), dt.date.today(), locale)
    if start and end:
        try:
            return activity_report.window_between(
                dt.date.fromisoformat(start), dt.date.fromisoformat(end), locale
            )
        except ValueError:
            raise HTTPException(
                status_code=400, detail="start and end must be ISO dates (YYYY-MM-DD)."
            ) from None
    if period not in activity_report.PERIODS:
        raise HTTPException(status_code=400, detail=f"period must be one of {activity_report.PERIODS}")
    try:
        reference = dt.date.fromisoformat(ref) if ref else dt.date.today()
    except ValueError:
        raise HTTPException(status_code=400, detail="ref must be an ISO date (YYYY-MM-DD).") from None
    return activity_report.window_for(period, reference, locale)


def _aida_side(db: Session, learner_id: int | None) -> dict | None:
    """What this person did *here*, for the other half of their profile.

    It reuses the learner's own history rather than recomputing hours a second
    way: two arithmetics for the same figure end up disagreeing, and the one on
    the profile page is the one a manager quotes.
    """
    if learner_id is None:
        return None
    from app.api.routes.history import history as learner_history

    from app.labs.badges import BADGES_BY_ID
    from app.labs.gamification import level_info, streak_is_live
    from app.models import Achievement

    record = learner_history(learner_id=learner_id, db=db)
    # The external items are the Coursera side, already on this page.
    own = [i for i in record["items"] if i["kind"] != "external"]
    learner = db.get(Learner, learner_id)
    level = level_info(learner.xp)
    # The badges themselves, not a count: HR reads them as what this person is
    # good at, and "7" says nothing about that.
    earned = (
        db.query(Achievement)
        .filter(Achievement.learner_id == learner_id)
        .order_by(Achievement.id)
        .all()
    )
    badges = [
        {
            "id": a.badge_id,
            "name": BADGES_BY_ID[a.badge_id].name,
            "emoji": BADGES_BY_ID[a.badge_id].emoji,
            "description": BADGES_BY_ID[a.badge_id].description,
        }
        for a in earned
        if a.badge_id in BADGES_BY_ID
    ]
    return {
        "learner_id": learner_id,
        "handle": learner.handle,
        "xp": learner.xp,
        "coursera_xp": learner.coursera_xp,
        "level": level["level"],
        "level_title": level["level_title"],
        "level_pct": level["level_pct"],
        "xp_to_next": level["xp_to_next"],
        "badges": badges,
        "badge_total": len(BADGES_BY_ID),
        # A streak only counts while it is alive; the stored number keeps its
        # last value forever, which reads as activity that stopped months ago.
        "current_streak": streak_is_live(learner),
        "longest_streak": learner.longest_streak or 0,
        "last_active_on": learner.last_active_on.isoformat() if learner.last_active_on else "",
        "items": len(own),
        "completed": sum(1 for i in own if i["status"] == "completed"),
        "in_progress": sum(1 for i in own if i["status"] == "in_progress"),
        "hours": round(sum(i["hours"] for i in own), 1),
        "certificates": record["totals"]["certificates"],
        "mandatory_open": sum(1 for i in own if i["mandatory"] and i["status"] != "completed"),
    }


@router.get("/person")
def person(
    email: str,
    learner_id: int | None = None,
    # Empty means the whole record; the quick buttons send a named period.
    period: str = "",
    ref: str = "",
    # A calendar range wins over the named period when both are given.
    start: str = "",
    end: str = "",
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Everything known about one person on Coursera, for their profile page."""
    from app.core import activity_report

    _guard(db, learner_id, x_admin_token)
    window = _window(period, ref, start, end, "en", db, email)
    data = activity_report.collect_person(db, email, window, "en")
    if not data:
        alias = _provider_email(db, email)
        if alias:
            data = activity_report.collect_person(db, alias, window, "en")
    if not data:
        # No provider activity does not mean no person. Most colleagues have
        # never touched Coursera, and refusing to show them made every name on
        # the org screens unclickable — the page is somebody's record, and the
        # Coursera half of it is simply empty.
        data = _empty_person(db, email, window)
        if not data:
            raise HTTPException(status_code=404, detail=f"Nobody here with the address {email}.")
    data["findings"] = activity_report.person_findings(data, "en")
    # The programmes those courses add up to. Coursera reports courses only, so
    # without this a professional certificate somebody earned is nowhere on
    # their record — see app.core.specializations for how it is derived and
    # what the derivation can and cannot see.
    from app.core import specializations

    learner_id_here = data["person"]["learner_id"]
    data["specializations"] = (
        specializations.for_learner(db, learner_id_here) if learner_id_here else []
    )
    # The AIDA half of the same person, so a linked profile answers both
    # questions on one page instead of sending the reader to another screen.
    data["aida"] = _aida_side(db, data["person"]["learner_id"])
    # Dates are not JSON, and the page only needs the labels.
    data["start"] = data["start"].isoformat()
    data["end"] = data["end"].isoformat()
    data["prev_start"] = data["prev_start"].isoformat()
    data["prev_end"] = data["prev_end"].isoformat()
    return data


@router.get("/report.pdf")
def report_pdf(
    learner_id: int | None = None,
    # Empty means the whole record; the quick buttons send a named period.
    period: str = "",
    ref: str = "",
    # A calendar range wins over the named period when both are given.
    start: str = "",
    end: str = "",
    locale: str = "fr",
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """The report as a branded PDF, over whatever stretch of time was asked for.

    Give it `start` and `end` for an arbitrary range. Give it `period` plus a
    `ref` inside the period for a whole month, quarter or year — which is what
    the quick buttons send, so "the quarter that just closed" stays a date
    rather than an off-by-one argument about quarter numbering.
    """
    from fastapi.responses import Response

    from app.core import activity_report, report_pdf as pdf_builder

    _guard(db, learner_id, x_admin_token)
    window = _window(period, ref, start, end, locale, db)
    data = activity_report.collect(db, window, locale)
    if not data["totals"]["enrollments"]:
        raise HTTPException(status_code=409, detail="No Coursera data synced yet.")
    data["findings"] = activity_report.findings(data, locale)
    commentary, author = activity_report.narrative(data, data["findings"], locale)

    blob = pdf_builder.build(data, commentary, author, locale)
    stem = re.sub(r"[^a-z0-9]+", "-", window.label.lower()).strip("-")
    return Response(
        content=blob,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="aida-learning-report-{stem}.pdf"'},
    )


def _aida_record(db: Session, learner_id: int | None) -> tuple[list[dict], list[dict]]:
    """Their internal learning and their certificates, for the printed card.

    The card used to be the Coursera half only, so a colleague who did most of
    their learning here read as somebody who had done almost nothing.
    """
    if learner_id is None:
        return [], []
    from app.api.routes.history import history as learner_history

    record = learner_history(learner_id=learner_id, db=db)
    # The provider rows are the other half of the card already.
    return [i for i in record["items"] if i["source"] == "aida"], record["certificates"]


@router.get("/person.pdf")
def person_pdf(
    email: str,
    learner_id: int | None = None,
    # Empty means the whole record; the quick buttons send a named period.
    period: str = "",
    ref: str = "",
    # A calendar range wins over the named period when both are given.
    start: str = "",
    end: str = "",
    locale: str = "fr",
    x_admin_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """One collaborator's card: their activity, set against their unit and the
    organisation, for the person and their manager."""
    from fastapi.responses import Response

    from app.core import activity_report, report_pdf as pdf_builder

    _guard(db, learner_id, x_admin_token)
    window = _window(period, ref, start, end, locale, db, email)
    data = activity_report.collect_person(db, email, window, locale)
    if not data:
        raise HTTPException(status_code=404, detail=f"No Coursera activity for {email}.")
    data["findings"] = activity_report.person_findings(data, locale)
    data["aida_items"], data["aida_certificates"] = _aida_record(db, data["person"]["learner_id"])
    commentary, author = _person_narrative(data, locale)

    blob = pdf_builder.build_person(data, commentary, author, locale)
    stem = email.split("@")[0].replace(".", "-")
    return Response(
        content=blob,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="aida-card-{stem}.pdf"'},
    )


def _person_narrative(data: dict, locale: str) -> tuple[str, str]:
    """Three sentences a manager can open a conversation with."""
    from app.core.config import settings

    if not settings.ai_enabled:
        return "", "computed"
    language = "French" if locale == "fr" else "English"
    facts = {
        "person": {k: v for k, v in data["person"].items() if k != "email"},
        "this_period": data["now"],
        "previous_period": data["before"],
        "cumulative": data["totals"],
        "benchmarks": data["benchmark"],
        "items": data["items"][:12],
        "computed_findings": data["findings"],
    }
    try:
        from app.ai.providers import complete_text

        text = complete_text(
            "You brief a manager before a one-to-one about one person's learning activity. "
            f"Write in {language}, 90-130 words, two short paragraphs, no headings, no lists.\n\n"
            "Rules: use only the figures provided and never invent one. Compare the person with "
            "the medians given rather than judging the raw number. Be factual and neutral — this "
            "document is shown to the person themselves, so no speculation about motivation and "
            "no performance verdict. Name the content that matters. End with one question the "
            "manager could ask.",
            json.dumps(facts, ensure_ascii=False, default=str),
            max_tokens=600,
        )
        if len(text) > 80:
            return text.strip(), settings.ai_model_name
    except Exception as exc:  # noqa: BLE001
        log.warning("person card: model unavailable (%s)", exc)
    return "", "computed"
