"""Certification renewal reminders.

Certificates carry a validity date; letting one lapse silently is the failure
mode this guards against — especially for the ones a client contractually
requires. Every run looks for certificates crossing an expiry threshold and
nudges the holder in-app and by email, plus their team's manager/lead and HR
when the certification is client-required.

Two branches built this feature in parallel and it is merged here. The ladder
(60/30/7, each announced exactly once) came from the M-02 side and is the
better idempotency rule: a single window fires once and then stays quiet even
as the date gets close, which is precisely when a reminder matters most. The
localisation, the client-required escalation and the HR fan-out came from the
CR-gaps side. `last_reminder_days` records the tightest threshold already
announced, so a daily run is safe to repeat.
"""

import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email_template import Button, render_email
from app.core.i18n import tr
from app.core.mailer import send_email
from app.core.notifier import notify
from app.models import Certification, EarnedCertificate, Learner, Team

log = logging.getLogger(__name__)

# Announced once each, as the date closes in.
THRESHOLDS = (60, 30, 7)

# Don't reach back indefinitely: on a first run against real data this stops
# the task from mailing about certificates that lapsed months ago.
MAX_DAYS_EXPIRED = 30


def _threshold_for(days_left: int, ladder: tuple[int, ...]) -> int | None:
    """Tightest rung `days_left` has reached, or None if not yet due.

    An already-expired certificate (days_left < 0) maps to the smallest rung,
    so a lapse is still announced even when the earlier steps were missed.
    """
    for rung in sorted(ladder):
        if days_left <= rung:
            return rung
    return None


def _overseers(db: Session, learner: Learner) -> list[int]:
    """The people who should know a required certificate is about to lapse."""
    ids: list[int] = []
    if learner.team_id:
        team = db.get(Team, learner.team_id)
        if team:
            ids += [i for i in (team.manager_id, team.lead_id) if i]
    ids += [
        row[0]
        for row in db.query(Learner.id).filter(Learner.role.in_(("hr", "hr_lead", "admin"))).all()
    ]
    return ids


def run_expiry_reminders(
    db: Session,
    *,
    days: int | None = None,
    force: bool = False,
    today: dt.date | None = None,
) -> dict:
    """Announce every newly-crossed expiry threshold. Idempotent per threshold.

    `days` replaces the ladder with a single rung — for demonstrating the job
    without waiting for a certificate to come within 60 days of lapsing.
    `force` re-announces a rung that already went out; useful for testing, not
    for the scheduled run.
    """
    ladder = (days,) if days is not None else THRESHOLDS
    today = today or dt.date.today()
    cutoff = today + dt.timedelta(days=max(ladder))

    rows = (
        db.query(EarnedCertificate)
        .filter(
            EarnedCertificate.expires_on.isnot(None),
            EarnedCertificate.expires_on <= cutoff,
        )
        .all()
    )

    reminded, skipped, escalated = 0, 0, 0
    for cert in rows:
        left = (cert.expires_on - today).days
        if left < -MAX_DAYS_EXPIRED:
            skipped += 1
            continue

        threshold = _threshold_for(left, ladder)
        if threshold is None:
            continue
        # Already announced this rung, or a tighter one — nothing new to say.
        if not force and cert.last_reminder_days is not None and threshold >= cert.last_reminder_days:
            skipped += 1
            continue

        learner = db.get(Learner, cert.learner_id)
        if not learner:
            continue

        when = f"{cert.expires_on:%d/%m/%Y}"
        # Each recipient reads this in their own language — the text is stored,
        # so it can't be re-rendered if they switch later.
        key = "cert.expired" if left < 0 else "cert.expiring"
        headline = tr(learner, f"{key}.title", title=cert.title)
        detail = tr(learner, f"{key}.body", date=when, days=left)

        catalog = db.get(Certification, cert.certification_id) if cert.certification_id else None
        if catalog and catalog.client_required:
            client = (
                tr(learner, "cert.clientRequired.client", client=catalog.client_name)
                if catalog.client_name
                else ""
            )
            detail += tr(learner, "cert.clientRequired", client=client)

        notify(
            db, [learner.id], kind="cert_expiring",
            title=headline, body=detail, link="/certifications",
        )
        # Best-effort: send_email already no-ops when SMTP is disabled and
        # sends from a daemon thread, so a dead host can never stop the
        # notification or the state update below.
        if learner.email:
            who = learner.name or learner.handle
            link = f"{settings.frontend_origin}/certifications"
            html, body_text = render_email(
                heading=headline,
                preheader=detail,
                blocks=[
                    ("p", tr(learner, "cert.greeting", who=who)),
                    ("p", detail),
                    (
                        "stats",
                        [
                            (tr(learner, "cert.expiresOn"), f"{cert.expires_on:%d/%m/%Y}"),
                            (tr(learner, "cert.daysLeft"), str(left) if left >= 0 else "—"),
                        ],
                    ),
                ],
                button=Button(tr(learner, "cert.cta"), link),
                footer_note=tr(learner, "cert.footer"),
            )
            send_email(learner.email, f"[UpSkill] {headline}", html, body_text)

        if catalog and catalog.client_required:
            watchers = [i for i in _overseers(db, learner) if i != learner.id]
            if watchers:
                who = learner.name or learner.handle
                for watcher_id in watchers:
                    watcher = db.get(Learner, watcher_id)
                    # Re-render in the *watcher's* language. Reusing `detail`
                    # here shipped the holder's language instead, so a French
                    # manager watching an English colleague's certificate got
                    # "It expires on 28/09/2026" inside an otherwise French
                    # digest.
                    watcher_detail = tr(watcher, f"{key}.body", date=when, days=left)
                    if catalog.client_required:
                        watcher_client = (
                            tr(watcher, "cert.clientRequired.client", client=catalog.client_name)
                            if catalog.client_name
                            else ""
                        )
                        watcher_detail += tr(watcher, "cert.clientRequired", client=watcher_client)
                    notify(
                        db, [watcher_id], kind="cert_expiring",
                        title=tr(watcher, "cert.escalation.title", who=who),
                        body=f"{cert.title} · {watcher_detail}",
                        link="/certifications",
                    )
                escalated += 1

        cert.last_reminder_days = threshold
        reminded += 1

    db.commit()
    result = {
        "thresholds": list(ladder),
        "reminded": reminded,
        "skipped_already_reminded": skipped,
        "escalated_client_required": escalated,
        "mail_enabled": settings.mail_enabled,
    }
    log.info("certification reminders: %s", result)
    return result
