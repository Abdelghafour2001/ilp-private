"""Server-side messages in the recipient's language.

Notifications and emails are *generated* text: unlike UI labels, they are
written once and stored, so they cannot be re-translated later when someone
switches language. We therefore render them in the recipient's `locale` at the
moment they are created — which is why `Learner.locale` exists.

Usage:

    from app.core.i18n import tr

    tr(learner, "session.registered.title", title=session.title)

A missing key falls back to English, then to the key itself, so a forgotten
translation degrades to readable text instead of raising in a request that was
really about something else.
"""

from typing import Any

SUPPORTED_LOCALES = ("fr", "en")
DEFAULT_LOCALE = "fr"

MESSAGES: dict[str, dict[str, str]] = {
    "en": {
        # session registration
        "session.registered.title": "Registration confirmed: {title}",
        "session.registered.body": "{when}{where}",
        "session.waitlisted.title": "Waitlisted: {title}",
        "session.waitlisted.body":
            "{when} — the session is full; you'll be promoted if a seat frees up.",
        "session.promoted.title": "A seat opened up: {title}",
        "session.promoted.body": "You've moved from the waitlist to the confirmed list.",
        "session.new.title": "New session: {title}",
        "session.new.body.formation": "{formation} — {when}{where}",
        "session.new.body.open": "Open session — {when}{where}. Registration required.",
        # certification renewals
        "cert.expiring.title": "Certification to renew: {title}",
        "cert.expiring.body": "It expires on {date} (in {days} days).",
        "cert.expired.title": "Certification expired: {title}",
        "cert.expired.body": "It expired on {date}. Please renew it.",
        "cert.clientRequired": " This certification is required by a client{client}.",
        "cert.clientRequired.client": " ({client})",
        "cert.escalation.title": "Client certification to renew — {who}",
        "assign.course.title": "New course assigned: {title}",
        "assign.course.mandatory": "{who} assigned you this course. It is mandatory.",
        "assign.course.optional": "{who} recommended this course to you.",
        "assign.course.body.mandatory": "{who} has assigned you the course <b>{title}</b>. It is mandatory.",
        "assign.course.body.optional": "{who} recommends the course <b>{title}</b> to you.",
        "assign.greeting": "Hello {who},",
        "assign.due": "Due by",
        "assign.cta": "Open the course",
        "due.soon.subject": "Due in {n} day(s): {title}",
        "due.soon.body": "<b>{title}</b> is mandatory and due on {date} — {n} day(s) left. It is not finished yet.",
        "due.overdue.subject": "Overdue: {title}",
        "due.overdue.body": "<b>{title}</b> was due on {date}, {n} day(s) ago, and is still open.",
        "accept.body": "{who} accepted this as done, on evidence outside the platform. Nothing more is expected of you.",
        "accept.subject": "Done: {title}",
        "accept.cta": "See my learning",
        "accept.footer": "Accepted by {who} on {date}. If you think this is a mistake, reply to this message.",
        "accept.evidence": "Evidence recorded",
        "team.assigned.subject": "{n} new mandatory item(s) for your team",
        "team.assigned.body": "{who} has just assigned these. Nothing is expected of you — this is so you know.",
        "team.due.subject": "{n} mandatory item(s) in your team need attention",
        "team.due.body": "Deadlines approaching or passed, and not finished yet:",
        "team.line.soon": "due in {n} day(s)",
        "team.line.late": "{n} day(s) late",
        "team.cta": "Open the tracking board",
        "team.footer": "You receive this because you manage these people. One message a day at most.",
        "due.cta": "Finish it now",
        "due.footer": "Assigned by {who}. You receive this because the item is mandatory and still open.",
        "campaign.subject.one": "1 item assigned to you",
        "campaign.subject.many": "{n} items assigned to you",
        "campaign.intro.mandatory": "{who} has assigned you the following, and it is <b>mandatory</b>:",
        "campaign.intro.optional": "{who} suggests the following for you:",
        "campaign.intro.mixed": "{who} has assigned you the following. The ones marked mandatory are expected of you:",
        "campaign.item.mandatory": "📌 {title} — mandatory",
        "campaign.item.optional": "💡 {title}",
        "campaign.cta": "Open my learning",
        "campaign.footer": "Assigned by {who} through UpSkill. Everything is also in My learning.",
        "assign.footer": "Assigned by {who} through UpSkill.",
        "cert.greeting": "Hello {who},",
        "cert.cta": "View my certifications",
        "cert.expiresOn": "Expires on",
        "cert.daysLeft": "Days left",
        "cert.footer": "You are receiving this because a certification on your profile is approaching its expiry date.",
        "session.when": "When",
        "session.where": "Where",
        "session.cta": "See the schedule",
    },
    "fr": {
        "session.registered.title": "Inscription confirmée : {title}",
        "session.registered.body": "{when}{where}",
        "session.waitlisted.title": "Liste d'attente : {title}",
        "session.waitlisted.body":
            "{when} — la session est complète, vous serez promu si une place se libère.",
        "session.promoted.title": "Une place s'est libérée : {title}",
        "session.promoted.body": "Vous passez de la liste d'attente aux inscrits.",
        "session.new.title": "Nouvelle session : {title}",
        "session.new.body.formation": "{formation} — {when}{where}",
        "session.new.body.open": "Session ouverte — {when}{where}. Inscription requise.",
        "cert.expiring.title": "Certification à renouveler : {title}",
        "cert.expiring.body": "Elle expire le {date} (dans {days} jours).",
        "cert.expired.title": "Certification expirée : {title}",
        "cert.expired.body": "Elle a expiré le {date}. Pensez à la renouveler.",
        "cert.clientRequired": " Cette certification est requise par un client{client}.",
        "cert.clientRequired.client": " ({client})",
        "cert.escalation.title": "Certification client à renouveler — {who}",
        "assign.course.title": "Nouveau cours assigné : {title}",
        "assign.course.mandatory": "{who} vous a assigné ce cours. Il est obligatoire.",
        "assign.course.optional": "{who} vous recommande ce cours.",
        "assign.course.body.mandatory": "{who} vous a assigné le cours <b>{title}</b>. Il est obligatoire.",
        "assign.course.body.optional": "{who} vous recommande le cours <b>{title}</b>.",
        "assign.greeting": "Bonjour {who},",
        "assign.due": "À faire avant le",
        "assign.cta": "Ouvrir le cours",
        "due.soon.subject": "À faire dans {n} jour(s) : {title}",
        "due.soon.body": "<b>{title}</b> est obligatoire et à faire avant le {date} — il reste {n} jour(s). Ce n'est pas encore terminé.",
        "due.overdue.subject": "En retard : {title}",
        "due.overdue.body": "<b>{title}</b> était à faire avant le {date}, il y a {n} jour(s), et reste ouvert.",
        "accept.body": "{who} a validé cette obligation comme faite, sur une preuve extérieure à la plateforme. Rien d'autre n'est attendu de vous.",
        "accept.subject": "C'est validé : {title}",
        "accept.cta": "Voir mes formations",
        "accept.footer": "Validé par {who} le {date}. Si vous pensez qu'il y a une erreur, répondez à ce message.",
        "accept.evidence": "Preuve enregistrée",
        "team.assigned.subject": "{n} obligation(s) pour votre équipe",
        "team.assigned.body": "{who} vient de les affecter. Rien n'est attendu de vous : c'est pour information.",
        "team.due.subject": "{n} obligation(s) de votre équipe demandent votre attention",
        "team.due.body": "Échéances proches ou dépassées, et pas encore terminées :",
        "team.line.soon": "à faire dans {n} jour(s)",
        "team.line.late": "{n} jour(s) de retard",
        "team.cta": "Ouvrir le suivi",
        "team.footer": "Vous recevez ce message parce que vous encadrez ces personnes. Un message par jour au maximum.",
        "due.cta": "Terminer maintenant",
        "due.footer": "Affecté par {who}. Vous recevez ce message parce que le contenu est obligatoire et encore ouvert.",
        "campaign.subject.one": "1 contenu vous a été affecté",
        "campaign.subject.many": "{n} contenus vous ont été affectés",
        "campaign.intro.mandatory": "{who} vous a affecté ce qui suit, et c'est <b>obligatoire</b> :",
        "campaign.intro.optional": "{who} vous recommande ce qui suit :",
        "campaign.intro.mixed": "{who} vous a affecté ce qui suit. Les éléments marqués obligatoires sont attendus de vous :",
        "campaign.item.mandatory": "📌 {title} — obligatoire",
        "campaign.item.optional": "💡 {title}",
        "campaign.cta": "Ouvrir mes formations",
        "campaign.footer": "Affecté par {who} via UpSkill. Tout est également dans Mes formations.",
        "assign.footer": "Assigné par {who} via UpSkill.",
        "cert.greeting": "Bonjour {who},",
        "cert.cta": "Voir mes certifications",
        "cert.expiresOn": "Expire le",
        "cert.daysLeft": "Jours restants",
        "cert.footer": "Vous recevez ce message parce qu'une certification de votre profil approche de sa date d'expiration.",
        "session.when": "Quand",
        "session.where": "Où",
        "session.cta": "Voir le planning",
    },
}


def normalize(locale: str | None) -> str:
    return locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE


def t(locale: str | None, key: str, **vars: Any) -> str:
    """Render `key` in `locale`, falling back to English then to the key."""
    code = normalize(locale)
    template = MESSAGES[code].get(key) or MESSAGES["en"].get(key) or key
    try:
        return template.format(**vars)
    except (KeyError, IndexError):
        # A caller missing a placeholder should not break the request that
        # triggered the notification.
        return template


def tr(learner: Any, key: str, **vars: Any) -> str:
    """`t()` for a Learner — reads the recipient's own preferred language."""
    return t(getattr(learner, "locale", None), key, **vars)
