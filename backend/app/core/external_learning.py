"""Sync learning done on outside platforms into AIDA.

The identity join is the fragile part, not the HTTP. A provider knows a person
by the email they signed up with; we know them by handle and matricule. If
someone used a personal address, their work is unattributable — so an unmatched
row is *stored with a NULL learner* and counted, rather than dropped. A silent
drop and a genuine zero look identical in a report, and only one of them is
true.

That unmatched count is the number to watch: if it is not near zero, SSO is not
doing its job and the KPI is understating reality.
"""

import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.connectors.coursera import CourseraReporting, record_hours
from app.core.cert_expiry import expiry_from_validity
from app.models import Certification, Course, EarnedCertificate, ExternalEnrollment, Learner

log = logging.getLogger(__name__)


def _match_learner(db: Session, email: str) -> Learner | None:
    if not email:
        return None
    return db.query(Learner).filter(Learner.email.ilike(email.strip())).first()


def _parse_ts(value: str | int | None) -> dt.datetime | None:
    """A Coursera timestamp, as epoch milliseconds or ISO-8601.

    The spec documents ISO-8601; the live Business API sends epoch
    milliseconds (1768136929244). Parsing only the documented shape dropped
    every completion date, which left certificates with no obtained date and
    therefore no expiry, so nothing entered the renewal sweep.
    """
    if value in (None, ""):
        return None
    text = str(value)
    if text.lstrip("-").isdigit():
        seconds = int(text) / (1000 if abs(int(text)) > 10_000_000_000 else 1)
        return dt.datetime.fromtimestamp(seconds, dt.timezone.utc)
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        log.warning("coursera: unparseable timestamp %r", value)
        return None


def _match_course(db: Session, slug: str) -> Course | None:
    """Link to our catalog entry when the same course was imported locally."""
    if not slug:
        return None
    return (
        db.query(Course)
        .filter(Course.external_url.ilike(f"%/learn/{slug}"))
        .first()
    )


def _record_certificate(db: Session, learner: Learner, row: ExternalEnrollment) -> bool:
    """Turn a completed Coursera enrolment with a certificate into an AIDA one.

    Until now the certificate URL was stored on the enrolment and nowhere else,
    so a Coursera certificate counted towards hours but never appeared on the
    Certifications page, on the learner's profile, or in the renewal sweep.
    Keyed on the credential URL, so a nightly re-sync never duplicates it.
    Returns True when a certificate was created.
    """
    if not (row.completed and row.certificate_url):
        return False
    exists = (
        db.query(EarnedCertificate)
        .filter_by(learner_id=learner.id, credential_url=row.certificate_url)
        .first()
    )
    # Link to the catalogue when an entry of the same name exists, so a
    # client-required Coursera certification gets its validity period and
    # joins compliance follow-up like any other.
    catalog = (
        db.query(Certification).filter(Certification.name.ilike(row.course_title)).first()
        if row.course_title
        else None
    )
    obtained = row.completed_at.date() if row.completed_at else None
    if exists:
        # A certificate recorded before the date was readable stays dateless,
        # and a certificate with no date can never expire — so it would sit
        # outside the renewal sweep forever. Fill it in once the date arrives.
        if obtained and not exists.obtained_on:
            exists.obtained_on = obtained
            exists.expires_on = exists.expires_on or expiry_from_validity(
                obtained, catalog.validity_months if catalog else None
            )
        return False
    db.add(EarnedCertificate(
        learner_id=learner.id,
        certification_id=catalog.id if catalog else None,
        title=row.course_title or row.course_slug,
        issuer="Coursera",
        obtained_on=obtained,
        expires_on=expiry_from_validity(obtained, catalog.validity_months if catalog else None),
        credential_url=row.certificate_url,
    ))
    return True


def sync_coursera(db: Session) -> dict:
    """Pull every enrollment record and upsert it. Returns a summary."""
    client = CourseraReporting()
    now = dt.datetime.now(dt.timezone.utc)

    created = updated = matched = unmatched = certificates = 0
    measured_hours = estimated_hours = 0.0
    unmatched_emails: list[str] = []
    # Rows touched in this run, by key. The real feed repeats an `id` when the
    # same person reaches one learning path through two programmes, and the
    # session does not autoflush, so the lookup below cannot see a row added a
    # moment ago — without this the second copy became a second INSERT and the
    # whole sync died on the unique constraint at commit.
    seen: dict[str, ExternalEnrollment] = {}

    for record in client.enrollment_reports():
        # Key on the report row's own `id`, NOT `externalId`. Per the spec
        # `externalId` is the learner's SSO credential, so one person enrolled in
        # three courses sends three records sharing it — keying on it would make
        # each sync overwrite the same row and report a third of the truth. Fall
        # back to learner+content, which is unique for the same reason.
        external_id = str(
            record.get("id")
            or f"{record.get('externalId') or ''}~{record.get('contentId') or ''}"
        ).strip("~")
        if not external_id:
            continue

        email = record.get("email") or ""
        learner = _match_learner(db, email)
        if learner:
            matched += 1
        else:
            unmatched += 1
            if email and email not in unmatched_emails:
                unmatched_emails.append(email)

        row = seen.get(external_id) or (
            db.query(ExternalEnrollment)
            .filter_by(provider="coursera", external_id=external_id)
            .first()
        )
        if row:
            updated += 1
        else:
            row = ExternalEnrollment(provider="coursera", external_id=external_id)
            db.add(row)
            created += 1
        seen[external_id] = row

        slug = record.get("contentSlug") or ""
        course = _match_course(db, slug)

        row.learner_id = learner.id if learner else None
        row.matched_email = email
        row.course_slug = slug
        row.course_title = record.get("contentName") or slug
        row.course_id = course.id if course else None
        row.content_type = record.get("contentType") or "Course"
        row.program_name = record.get("programName") or ""
        row.progress_pct = int(record.get("overallProgress") or 0)
        row.completed = bool(record.get("isCompleted"))
        row.completed_at = _parse_ts(record.get("completedAt"))
        row.last_activity_at = _parse_ts(record.get("lastActivityAt"))
        row.enrolled_at = _parse_ts(record.get("enrolledAt"))
        row.certificate_url = record.get("contentCertificateUrl") or ""
        grade = record.get("grade")
        row.grade = float(grade) if grade is not None else None

        # The provider's own view of the person and the content. Most of these
        # people have no account here yet, so this is the only business unit,
        # location and manager we have for them.
        profile = record.get("learnerProfileStandardFields") or {}
        row.full_name = record.get("fullName") or ""
        row.partner_names = ", ".join(record.get("partnerNames") or [])
        row.collection_name = record.get("collectionName") or ""
        row.contract_name = record.get("contractName") or ""
        row.course_type = record.get("courseType") or ""
        row.job_title = profile.get("jobTitle") or ""
        row.job_type = profile.get("jobType") or ""
        row.business_unit = profile.get("businessUnit") or ""
        row.business_unit_2 = profile.get("businessUnit2") or ""
        row.location_city = profile.get("locationCity") or ""
        row.location_country = profile.get("locationCountry") or ""
        row.manager_name = profile.get("managerName") or ""
        row.manager_email = profile.get("managerEmail") or ""

        # Coursera reports time actually spent. Fall back to the imported
        # course's published length only when it does not, and mark that case
        # as an estimate so HR reporting can keep the two apart — a Jour-Homme
        # built on published course length is not defensible in a review.
        hours, measured = record_hours(record)
        if not measured:
            hours = float(course.external_hours if course else 0) or 0.0
        row.hours = hours
        row.hours_measured = measured

        if measured:
            measured_hours += hours
        else:
            estimated_hours += hours
        row.synced_at = now
        if learner and _record_certificate(db, learner, row):
            certificates += 1

    db.commit()

    # Keep XP and badges level with what the provider now reports. Without
    # this, a course finished last night sits in the table and changes nothing
    # on the learner's profile until somebody re-links their account by hand.
    from app.core.coursera_link import grant_coursera_xp

    linked = (
        db.query(Learner)
        .filter(Learner.id.in_({r.learner_id for r in seen.values() if r.learner_id} or {0}))
        .all()
    )
    badges_awarded = 0
    for person in linked:
        badges_awarded += len(grant_coursera_xp(db, person)["new_badges"])

    # Which multi-course programmes those courses add up to. The feed never
    # says, so it is derived from the public catalogue — and a catalogue outage
    # must not throw away an enrolment sync that already succeeded.
    from app.core import specializations

    try:
        programmes = specializations.refresh(db)
    except Exception as exc:  # noqa: BLE001 — the catalogue is public HTTP, not a contract
        log.warning("coursera specializations skipped: %s", exc)
        programmes = {"skipped": str(exc)}

    summary = {
        "mode": client.mode,
        "specializations": programmes,
        "learners_rescored": len(linked),
        "badges_awarded": badges_awarded,
        "created": created,
        "updated": updated,
        "matched_learners": matched,
        "unmatched": unmatched,
        "certificates_recorded": certificates,
        # Split out so the HR view can state plainly how much of the Coursera
        # contribution is real time on task versus published course length.
        "measured_hours": round(measured_hours, 2),
        "estimated_hours": round(estimated_hours, 2),
        # Surfaced deliberately: these are people whose learning is invisible
        # to HR until their Coursera account uses their corporate address.
        "unmatched_emails": unmatched_emails[:20],
    }
    log.info("coursera sync: %s", summary)
    return summary
