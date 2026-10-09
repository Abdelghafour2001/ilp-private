"""Weekly learning digest (M-09).

Builds a per-learner email summarising the week's notifications, grouped by
kind, plus a nudge back into the app. Sending is triggered from
`POST /admin/digest/run` (manual for v1; wire a scheduler/Celery beat later).
"""

import datetime as dt
from collections import defaultdict

from sqlalchemy.orm import Session

from app.core.branding import TEAL_DARK
from app.core.email_template import Button, render_email
from app.models import Learner, Notification

# kind -> (emoji, human label) — mirrors the in-app notification bell
KIND_META: dict[str, tuple[str, str]] = {
    "invite": ("✉️", "Invitations reçues"),
    "assignment": ("📋", "Formations & parcours assignés"),
    "enrollment": ("🎓", "Nouvelles inscriptions"),
    "session": ("📅", "Sessions programmées"),
    "team": ("👥", "Votre équipe"),
    "cert_suggested": ("📌", "Certifications recommandées"),
    "cert_earned": ("🏅", "Certifications obtenues"),
    "cert_expiring": ("⏳", "Certifications à renouveler"),
    "comment": ("💬", "Commentaires"),
    "info": ("🔔", "Divers"),
}


def build_digest(
    db: Session, learner: Learner, *, days: int = 7, frontend_origin: str
) -> tuple[str, str, str] | None:
    """Return (subject, html, text) for the learner, or None if nothing to send."""
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=max(1, days))
    notifs = (
        db.query(Notification)
        .filter(Notification.learner_id == learner.id, Notification.created_at >= since)
        .order_by(Notification.created_at.desc())
        .all()
    )
    if not notifs:
        return None

    unread = sum(1 for n in notifs if not n.read)
    groups: dict[str, list[Notification]] = defaultdict(list)
    for n in notifs:
        groups[n.kind].append(n)

    who = learner.name or learner.handle
    subject = f"[UpSkill] Votre semaine d'apprentissage — {len(notifs)} nouveauté" + (
        "s" if len(notifs) > 1 else ""
    )

    # One shell for every message the platform sends — see core/email_template.
    blocks: list = [
        # The heading already greets them by name; repeating it here read as a
        # mail-merge glitch.
        ("p", "Voici le résumé de votre semaine sur UpSkill."),
        (
            "stats",
            # The label agrees with its own number: "1 Nouveautés" is the kind
            # of detail that makes a generated mail read as generated.
            [("Nouveauté" + ("s" if len(notifs) > 1 else ""), str(len(notifs)))]
            + ([("Non lue" + ("s" if unread > 1 else ""), str(unread))] if unread else []),
        ),
    ]
    for kind, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        emoji, label = KIND_META.get(kind, ("🔔", kind))
        blocks.append(("h", f"{emoji} {label} ({len(items)})"))
        entries = [
            f"<a href='{frontend_origin}{n.link or '/'}' "
            f"style='color:{TEAL_DARK};text-decoration:none;'>{_esc(n.title)}</a>"
            + (f"<br>{_esc(n.body)}" if n.body else "")
            for n in items[:6]
        ]
        if len(items) > 6:
            entries.append(f"+ {len(items) - 6} de plus…")
        blocks.append(("list", entries))

    html, text = render_email(
        heading=f"Bonjour {_esc(who)} 👋",
        preheader=f"{len(notifs)} nouveauté{'s' if len(notifs) > 1 else ''} cette semaine sur UpSkill.",
        blocks=blocks,
        button=Button("Ouvrir UpSkill", f"{frontend_origin}/"),
        footer_note="Vous recevez cet e-mail car vous avez de l'activité sur l'académie UpSkill.",
    )

    return subject, html, text


def _esc(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
