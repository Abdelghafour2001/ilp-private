"""The periodic learning report, as a branded PDF.

What this is for: a steering committee opens one document per month, quarter or
year and sees what happened, how it compares with the period before, and what
to do about it. The previous HR export was four pages of tables with no
comparison and no commentary, so every reading of it started with someone
working out whether 20% completion was good or bad.

Three rules hold this together:

* **Every figure is computed here, from rows.** The model writes commentary
  around the numbers it is given and never produces one of its own.
* **A period needs a comparison.** A rate on its own is a number; a rate next
  to the previous quarter's is an argument.
* **Hours are attributed by last activity.** The provider reports total time
  per enrolment, not a daily ledger, so an enrolment counts in the period it
  was last worked on. Stated in the method note rather than glossed over.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
import logging
from collections import defaultdict

from sqlalchemy.orm import Session

from app.models import EarnedCertificate, ExternalEnrollment, Learner

log = logging.getLogger(__name__)

PERIODS = ("month", "quarter", "year")
HOURS_PER_MAN_DAY = 8.0

MONTHS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


def period_bounds(period: str, ref: dt.date) -> tuple[dt.date, dt.date]:
    """First and last day of the period `ref` falls in."""
    if period == "year":
        return dt.date(ref.year, 1, 1), dt.date(ref.year, 12, 31)
    if period == "quarter":
        first_month = 3 * ((ref.month - 1) // 3) + 1
        start = dt.date(ref.year, first_month, 1)
        end_month = first_month + 2
        last_day = (dt.date(ref.year + end_month // 12, end_month % 12 + 1, 1) - dt.timedelta(days=1))
        return start, last_day
    start = ref.replace(day=1)
    next_month = dt.date(ref.year + ref.month // 12, ref.month % 12 + 1, 1)
    return start, next_month - dt.timedelta(days=1)


def previous_period(period: str, start: dt.date) -> tuple[dt.date, dt.date]:
    return period_bounds(period, start - dt.timedelta(days=1))


def period_label(period: str, start: dt.date, locale: str) -> str:
    if period == "year":
        return str(start.year)
    if period == "quarter":
        return f"T{(start.month - 1) // 3 + 1} {start.year}" if locale == "fr" else f"Q{(start.month - 1) // 3 + 1} {start.year}"
    if locale == "fr":
        return f"{MONTHS_FR[start.month - 1]} {start.year}"
    return f"{start:%B %Y}"


@dataclass(frozen=True)
class Window:
    """The stretch of time a report covers, and what it is compared against.

    Reports used to take a named period — month, quarter, year — which answers
    "how was September" and nothing else. A real question is usually "between
    the kickoff and the review", so the window is now explicit and the named
    periods are just shortcuts that build one.

    `prev_start`/`prev_end` is what "vs. previous" means. For a named period it
    is the period before; for an arbitrary range it is the same number of days
    immediately before it, which is the only comparison that is fair.
    """

    start: dt.date
    end: dt.date
    prev_start: dt.date
    prev_end: dt.date
    label: str


def window_for(period: str, ref: dt.date, locale: str = "fr") -> Window:
    """The month, quarter or year that `ref` falls in."""
    start, end = period_bounds(period, ref)
    prev_start, prev_end = previous_period(period, start)
    return Window(start, end, prev_start, prev_end, period_label(period, start, locale))


def window_between(start: dt.date, end: dt.date, locale: str = "fr") -> Window:
    """Any two dates. Swapped dates are read the way they were meant."""
    if end < start:
        start, end = end, start
    span = (end - start).days
    prev_end = start - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=span)
    fmt = "%d/%m/%Y" if locale == "fr" else "%d %b %Y"
    label = f"{start:{fmt}} → {end:{fmt}}"
    return Window(start, end, prev_start, prev_end, label)


def window_everything(first: dt.date, today: dt.date, locale: str = "fr") -> Window:
    """Everything, from the first day there is anything to the day of asking.

    Asked for without dates, a card should be the whole record rather than
    whatever happened to fall in the current month — somebody who stopped in
    March otherwise gets a card saying they did nothing.

    There is no period before "everything", so the comparison window is empty
    by construction and the deltas read as "nothing before this".
    """
    fmt = "%d/%m/%Y" if locale == "fr" else "%d %b %Y"
    label = (
        f"Depuis le début — {first:{fmt}} → {today:{fmt}}"
        if locale == "fr"
        else f"Full history — {first:{fmt}} → {today:{fmt}}"
    )
    before = first - dt.timedelta(days=1)
    return Window(first, today, before, before, label)


def _in(day: dt.date | None, start: dt.date, end: dt.date) -> bool:
    return day is not None and start <= day <= end


def _slice(rows: list[ExternalEnrollment], start: dt.date, end: dt.date) -> dict:
    """Everything the report says about one period, computed from rows."""
    completions = [r for r in rows if _in(r.completed_at.date() if r.completed_at else None, start, end)]
    starts = [r for r in rows if _in(r.enrolled_at.date() if r.enrolled_at else None, start, end)]
    touched = [
        r for r in rows
        if _in((r.last_activity_at or r.completed_at).date() if (r.last_activity_at or r.completed_at) else None, start, end)
    ]
    hours = sum(r.hours or 0.0 for r in touched)
    graded = [r.grade for r in completions if r.grade is not None]
    return {
        "completions": len(completions),
        "starts": len(starts),
        "active_people": len({r.matched_email for r in touched}),
        "hours": round(hours, 1),
        "man_days": round(hours / HOURS_PER_MAN_DAY, 1),
        "certificates": sum(1 for r in completions if r.certificate_url),
        "avg_grade": round(100 * sum(graded) / len(graded)) if graded else None,
        "rows_completed": completions,
        "rows_touched": touched,
    }


def _by(rows: list[ExternalEnrollment], key, unknown: str = "Non renseigné") -> list[dict]:
    """Group rows, naming the blank bucket rather than printing a dash.

    A large "—" row reads as a rendering fault; "Non renseigné" reads as what it
    is — people the provider sends us with no business unit attached.
    """
    buckets: dict[str, dict] = defaultdict(
        lambda: {"n": 0, "done": 0, "hours": 0.0, "people": set(), "certs": 0}
    )
    for row in rows:
        b = buckets[(key(row) or unknown)[:40]]
        b["n"] += 1
        b["done"] += int(row.completed)
        b["hours"] += row.hours or 0.0
        b["people"].add(row.matched_email)
        b["certs"] += int(bool(row.certificate_url))
    out = [
        {
            "label": label,
            "enrollments": b["n"],
            "completed": b["done"],
            "people": len(b["people"]),
            "hours": round(b["hours"], 1),
            "rate": round(100 * b["done"] / b["n"]) if b["n"] else 0,
            "certificates": b["certs"],
        }
        for label, b in buckets.items()
    ]
    return sorted(out, key=lambda r: -r["enrollments"])


def collect(db: Session, window: Window, locale: str = "fr") -> dict:
    """Facts for the window, the stretch before it, and the running totals."""
    unknown = "Non renseigné" if locale == "fr" else "Not stated"
    rows = db.query(ExternalEnrollment).filter(ExternalEnrollment.provider == "coursera").all()
    start, end = window.start, window.end
    prev_start, prev_end = window.prev_start, window.prev_end

    now = _slice(rows, start, end)
    before = _slice(rows, prev_start, prev_end)

    # Twelve months of completions, so the period sits in its own history.
    months: list[tuple[str, int]] = []
    cursor = dt.date(end.year, end.month, 1)
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        if row.completed_at:
            counts[row.completed_at.strftime("%Y-%m")] += 1
    for _ in range(12):
        months.append((cursor.strftime("%Y-%m"), counts[cursor.strftime("%Y-%m")]))
        cursor = (cursor - dt.timedelta(days=1)).replace(day=1)
    months.reverse()

    never_opened = sum(1 for r in rows if (r.progress_pct or 0) < 1 and not r.completed)
    in_progress = sum(1 for r in rows if 1 <= (r.progress_pct or 0) < 100 and not r.completed)
    period_rows = now["rows_touched"] or rows

    # Who is stalled, as a count and a shape rather than a list of names: the
    # committee report says how many and where, the per-person card carries the
    # detail to the one manager who can act on it.
    stalled_rows = [r for r in rows if not r.completed and (r.progress_pct or 0) >= 1]
    stalled_units: dict[str, int] = defaultdict(int)
    for row in stalled_rows:
        stalled_units[row.business_unit or unknown] += 1
    where = ", ".join(
        f"{unit} ({count})"
        for unit, count in sorted(stalled_units.items(), key=lambda kv: -kv[1])[:3]
    )

    certificates_issued = (
        db.query(EarnedCertificate)
        .filter(EarnedCertificate.obtained_on.isnot(None))
        .filter(EarnedCertificate.obtained_on >= start, EarnedCertificate.obtained_on <= end)
        .count()
    )

    return {
        "period": window.label,
        "start": start,
        "end": end,
        "prev_start": prev_start,
        "prev_end": prev_end,
        "now": {k: v for k, v in now.items() if not k.startswith("rows_")},
        "before": {k: v for k, v in before.items() if not k.startswith("rows_")},
        "totals": {
            "people": len({r.matched_email for r in rows}),
            "enrollments": len(rows),
            "completed": sum(1 for r in rows if r.completed),
            "in_progress": in_progress,
            "never_opened": never_opened,
            "completion_rate": round(100 * sum(1 for r in rows if r.completed) / len(rows)) if rows else 0,
            "hours": round(sum(r.hours or 0.0 for r in rows), 1),
            "certificates_in_aida": certificates_issued,
            "contract": next((r.contract_name for r in rows if r.contract_name), ""),
        },
        "trend": months,
        "by_program": _by(period_rows, lambda r: r.program_name, unknown),
        "by_unit": _by(period_rows, lambda r: r.business_unit, unknown),
        "by_location": _by(period_rows, lambda r: r.location_city, unknown),
        "top_content": sorted(
            _by(period_rows, lambda r: r.course_title or r.course_slug, unknown),
            key=lambda c: -c["enrollments"],
        )[:10],
        "stalled": {
            "people": len({r.matched_email for r in stalled_rows}),
            "items": len(stalled_rows),
            "where": where or unknown,
        },
    }


def delta(now: float | None, before: float | None) -> str:
    """A signed change, or an em dash when there is nothing to compare."""
    if now is None or before is None:
        return "—"
    change = now - before
    # Hours are tenths and counts are whole: rounding both to an integer printed
    # 18.9 hours of change as "+19", which reads as a different number.
    shown = f"{change:+.1f}".rstrip("0").rstrip(".") if isinstance(now, float) else f"{change:+d}"
    if not before:
        return "—" if not change else shown
    return f"{shown} ({round(100 * change / before):+d}%)"


def findings(data: dict, locale: str) -> list[str]:
    """Computed observations. Same data in, same sentences out."""
    fr = locale == "fr"
    now, before, totals = data["now"], data["before"], data["totals"]
    out: list[str] = []

    change = now["completions"] - before["completions"]
    if before["completions"] and abs(change) / max(before["completions"], 1) >= 0.15:
        out.append(
            f"Les complétions passent de {before['completions']} à {now['completions']} "
            f"({change:+d}) par rapport à la période précédente."
            if fr else
            f"Completions moved from {before['completions']} to {now['completions']} "
            f"({change:+d}) against the previous period."
        )
    if totals["enrollments"]:
        share = round(100 * totals["never_opened"] / totals["enrollments"])
        if share >= 20:
            out.append(
                f"{totals['never_opened']} inscriptions ({share} %) n'ont jamais été ouvertes."
                if fr else
                f"{totals['never_opened']} enrolments ({share}%) have never been opened."
            )
    units = [u for u in data["by_unit"] if u["label"] != "—" and u["enrollments"] >= 15]
    if units:
        worst = min(units, key=lambda u: u["rate"])
        best = max(units, key=lambda u: u["rate"])
        if best["rate"] - worst["rate"] >= 20:
            out.append(
                f"Écart entre entités : {best['label']} à {best['rate']} % contre "
                f"{worst['label']} à {worst['rate']} %."
                if fr else
                f"Unit spread: {best['label']} at {best['rate']}% against "
                f"{worst['label']} at {worst['rate']}%."
            )
    dead = [c for c in data["top_content"] if c["enrollments"] >= 15 and c["rate"] < 15]
    if dead:
        names = ", ".join(c["label"] for c in dead[:2])
        out.append(
            f"Très suivis, rarement terminés : {names}."
            if fr else
            f"Heavily enrolled, rarely finished: {names}."
        )
    if now["active_people"] and totals["people"]:
        share = round(100 * now["active_people"] / totals["people"])
        out.append(
            f"{now['active_people']} collaborateurs actifs sur la période, soit {share} % de la population inscrite."
            if fr else
            f"{now['active_people']} people were active in the period — {share}% of those enrolled."
        )
    return out


def narrative(data: dict, computed: list[str], locale: str) -> tuple[str, str]:
    """The model's commentary on the computed figures, and who wrote it."""
    from app.core.config import settings

    if not settings.ai_enabled:
        return "", "computed"
    import json

    facts = {
        "period": f"{data['start']} to {data['end']}",
        "this_period": data["now"],
        "previous_period": data["before"],
        "running_totals": data["totals"],
        "by_program": data["by_program"][:6],
        "by_unit": data["by_unit"][:6],
        "top_content": data["top_content"][:6],
        "computed_findings": computed,
    }
    language = "French" if locale == "fr" else "English"
    try:
        from app.ai.providers import complete_text

        text = complete_text(
            "You write the learning section of a steering-committee pack. You are given "
            f"verified figures. Write in {language}, 180-220 words, plain paragraphs, no "
            "headings and no bullet points.\n\n"
            "Rules: use only the numbers provided and never invent one. Open with the single "
            "thing the committee should decide. Compare this period with the previous one "
            "explicitly. Name programmes and units. Where a number is poor, say so and say "
            "what would move it. End with one sentence on what to do before the next period.",
            json.dumps(facts, ensure_ascii=False, default=str),
            max_tokens=900,
        )
        if len(text) > 150:
            return text.strip(), settings.ai_model_name
    except Exception as exc:  # noqa: BLE001 — a report without commentary still ships
        log.warning("activity report: model unavailable (%s)", exc)
    return "", "computed"


# --------------------------------------------------------------------------- #
# One person                                                                  #
# --------------------------------------------------------------------------- #
# The card a manager takes into a one-to-one. Same figures as the committee
# report, narrowed to one person and set against two benchmarks — their unit
# and the whole organisation — because "12 hours" means nothing on its own and
# "12 hours against a unit median of 3" means something.


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 1)
    return round((ordered[middle - 1] + ordered[middle]) / 2, 1)


def collect_person(db: Session, email: str, window: Window, locale: str = "fr") -> dict | None:
    unknown = "Non renseigné" if locale == "fr" else "Not stated"
    rows = db.query(ExternalEnrollment).filter(ExternalEnrollment.provider == "coursera").all()
    mine = [r for r in rows if (r.matched_email or "").lower() == email.lower()]
    if not mine:
        return None

    start, end = window.start, window.end
    prev_start, prev_end = window.prev_start, window.prev_end
    profile = next((r for r in mine if r.full_name), mine[0])
    # Coursera leaves most HR fields blank. For a linked person we know the
    # answer here, so the card says "AI & Data" instead of "Not stated".
    here = db.get(Learner, profile.learner_id) if profile.learner_id else None
    unit = profile.business_unit or (here.bu if here else "")
    # The peer cohort is drawn from the provider's own unit field. Falling back
    # to the AIDA BU for the *comparison* would put this person against people
    # Coursera never placed in that unit, i.e. against nobody.
    cohort_unit = profile.business_unit
    job_title = profile.job_title or (here.title if here else "")
    location = profile.location_city or (here.location if here else "")

    def hours_of(person_rows: list[ExternalEnrollment]) -> float:
        return sum(r.hours or 0.0 for r in person_rows)

    by_person: dict[str, list[ExternalEnrollment]] = defaultdict(list)
    for row in rows:
        by_person[row.matched_email].append(row)
    unit_people = {
        e: rs for e, rs in by_person.items() if any(r.business_unit == cohort_unit for r in rs)
    } if cohort_unit else {}

    def rate(person_rows: list[ExternalEnrollment]) -> int:
        return round(100 * sum(1 for r in person_rows if r.completed) / len(person_rows)) if person_rows else 0

    now = _slice(mine, start, end)
    before = _slice(mine, prev_start, prev_end)

    items = sorted(
        (
            {
                "title": r.course_title or r.course_slug,
                "type": r.content_type or "Course",
                "partner": r.partner_names,
                "program": r.program_name or unknown,
                "progress": r.progress_pct or 0,
                "hours": round(r.hours or 0.0, 1),
                "completed_on": r.completed_at.date().isoformat() if r.completed_at else "",
                "grade": round(100 * r.grade) if r.grade is not None else None,
                "certificate": bool(r.certificate_url),
                "last_activity": (r.last_activity_at or r.completed_at).date().isoformat()
                if (r.last_activity_at or r.completed_at) else "",
            }
            for r in mine
        ),
        key=lambda i: (-i["progress"], i["title"]),
    )

    return {
        "period": window.label,
        "start": start,
        "end": end,
        "prev_start": prev_start,
        "prev_end": prev_end,
        "person": {
            "name": profile.full_name or email,
            "email": email,
            "unit": unit or unknown,
            "job_title": job_title or unknown,
            "location": location or unknown,
            "manager": profile.manager_name or unknown,
            "linked": profile.learner_id is not None,
            # The AIDA account behind this Coursera one, when there is one. The
            # profile page uses it to show what they did here as well.
            "learner_id": profile.learner_id,
            # A person is usually in several programmes; naming one at the top
            # of their card said nothing. The breakdown below says it properly.
            "programs": sorted({r.program_name for r in mine if r.program_name}),
        },
        "now": {k: v for k, v in now.items() if not k.startswith("rows_")},
        "before": {k: v for k, v in before.items() if not k.startswith("rows_")},
        "totals": {
            "enrollments": len(mine),
            "completed": sum(1 for r in mine if r.completed),
            "in_progress": sum(1 for r in mine if 1 <= (r.progress_pct or 0) < 100 and not r.completed),
            "never_opened": sum(1 for r in mine if (r.progress_pct or 0) < 1 and not r.completed),
            "completion_rate": rate(mine),
            "hours": round(hours_of(mine), 1),
            "man_days": round(hours_of(mine) / HOURS_PER_MAN_DAY, 1),
            "certificates": sum(1 for r in mine if r.certificate_url),
        },
        "benchmark": {
            "unit_label": cohort_unit or unknown,
            "unit_people": len(unit_people),
            "unit_median_hours": _median([hours_of(rs) for rs in unit_people.values()]),
            "unit_median_rate": _median([float(rate(rs)) for rs in unit_people.values()]),
            "org_people": len(by_person),
            "org_median_hours": _median([hours_of(rs) for rs in by_person.values()]),
            "org_median_rate": _median([float(rate(rs)) for rs in by_person.values()]),
        },
        "items": items,
        "by_program": _by(mine, lambda r: r.program_name, unknown),
        # Courses, specialisations, learning paths and videos counted apart:
        # a specialisation is several courses' worth of work and reading it in
        # a list of 38 lines said nothing about what was actually earned.
        "by_type": _by(mine, lambda r: r.content_type, "Course"),
    }


def person_findings(data: dict, locale: str) -> list[str]:
    fr = locale == "fr"
    totals, bench, now = data["totals"], data["benchmark"], data["now"]
    out: list[str] = []
    if totals["never_opened"]:
        out.append(
            f"{totals['never_opened']} contenu(s) jamais ouvert(s) sur {totals['enrollments']} inscriptions."
            if fr else
            f"{totals['never_opened']} of {totals['enrollments']} enrolments never opened."
        )
    if totals["hours"] and bench["org_median_hours"]:
        ratio = totals["hours"] / bench["org_median_hours"]
        if ratio >= 1.5 or ratio <= 0.6:
            out.append(
                f"{totals['hours']} h cumulées, contre une médiane de {bench['org_median_hours']} h "
                "dans l'organisation."
                if fr else
                f"{totals['hours']} hours in total, against an organisation median of "
                f"{bench['org_median_hours']} h."
            )
    if totals["in_progress"] >= 3:
        out.append(
            f"{totals['in_progress']} contenus commencés et non terminés en parallèle."
            if fr else
            f"{totals['in_progress']} items started and running in parallel."
        )
    if not now["completions"]:
        out.append(
            "Aucune complétion sur la période."
            if fr else
            "No completion in the period."
        )
    # Only worth saying when there are provider hours to attach to somebody.
    # For the many colleagues with no Coursera account at all it read as an
    # unlinked account, which is the opposite of true.
    if not data["person"]["linked"] and totals["enrollments"]:
        out.append(
            "Ce compte Coursera n'est rattaché à aucun compte UpSkill : ces heures n'apparaissent pas sur son profil."
            if fr else
            "This Coursera account is not linked to an UpSkill account, so these hours do not show on their profile."
        )
    return out
