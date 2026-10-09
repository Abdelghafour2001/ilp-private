"""Outgoing mail, over SMTP or Microsoft Graph.

Two transports, chosen by configuration and never by the caller — everything in
the platform calls `send_email()` and does not care:

* **SMTP** — no auth, no TLS: built for Mailpit and relay-style hosts. The
  default, and what local development uses.
* **Graph** — `sendMail` as a shared mailbox, with an app registration holding
  the application permission `Mail.Send`. Set `GRAPH_*` and this wins, because
  a deployment inside the tenant can usually get an app registration and cannot
  usually get an SMTP relay: Exchange Online no longer accepts basic auth.

Sending runs in a daemon thread either way, so a slow or unreachable mail host
never blocks an API request; failures are logged and swallowed, because email
here is best-effort and a failed digest must not fail the request that sent it.
"""

import base64
import logging
import pathlib
import smtplib
import urllib.parse
import threading
from email.message import EmailMessage

from app.core.branding import logo_path
from app.core.config import settings
from app.core.email_template import LOGO_CID

log = logging.getLogger(__name__)


def _send_sync(to: str, subject: str, html: str, text: str) -> None:
    if settings.mail_transport == "graph":
        _send_graph(to, subject, html, text)
        return
    _send_smtp(to, subject, html, text)


def _logo_bytes() -> bytes | None:
    """The letterhead mark, or None. Failure is silent: a missing logo should
    cost the message its letterhead, not its delivery."""
    path = logo_path()
    if not path:
        return None
    try:
        return pathlib.Path(path).read_bytes()
    except OSError as exc:  # noqa: BLE001
        log.warning("email: could not read the logo (%s)", exc)
        return None


def _send_graph(to: str, subject: str, html: str, text: str) -> None:
    """One message through Graph, as the mailbox the app registration owns.

    Graph decides the sender from the mailbox in the URL — it ignores any From
    we might ask for — so `GRAPH_MAILBOX` is the address recipients see.
    """
    from app.core.graph import Graph

    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html},
        "toRecipients": [{"emailAddress": {"address": to}}],
    }
    logo = _logo_bytes()
    if logo:
        # Inline rather than hosted, for the same reason as the SMTP path: remote
        # images are blocked by default in most clients.
        message["attachments"] = [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": "logo.png",
            "contentType": "image/png",
            "contentBytes": base64.b64encode(logo).decode(),
            "contentId": LOGO_CID,
            "isInline": True,
        }]
    try:
        Graph().post(
            f"/users/{urllib.parse.quote(settings.graph_mailbox.strip())}/sendMail",
            {"message": message, "saveToSentItems": True},
        )
    except Exception as exc:  # noqa: BLE001 — email must never break the request
        log.warning("graph email to %s failed: %s", to, exc)


def _send_smtp(to: str, subject: str, html: str, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    _attach_logo(msg)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            smtp.send_message(msg)
    except Exception as exc:  # noqa: BLE001 — email must never break the request
        log.warning("email to %s failed: %s", to, exc)


def _attach_logo(msg: EmailMessage) -> None:
    """Embed the mark in the HTML part as an inline attachment.

    A `cid:` reference rather than a hosted URL: remote images are blocked by
    default in most clients, and a URL pointing at the app is unreachable for
    anyone reading mail outside the network.
    """
    data = _logo_bytes()
    if not data:
        return
    # payload[0] is the text alternative, payload[1] the HTML one; the image
    # has to be related to the HTML part, not to the message.
    html_part = msg.get_payload()[1]
    html_part.add_related(data, maintype="image", subtype="png", cid=f"<{LOGO_CID}>")


def send_email(to: str, subject: str, html: str, text: str = "") -> bool:
    """Queue an email; returns False when it will not be sent.

    False rather than a silent no-op on purpose: callers count what they sent,
    and a campaign reporting "14 emails" that nobody received is worse than one
    reporting 2.
    """
    if not settings.mail_enabled or not to:
        return False
    if not settings.may_email(to):
        # A non-production environment holding the real organisation. Logged
        # rather than dropped quietly, so "why did nobody get it" takes one
        # grep and not an afternoon.
        log.info("mail suppressed, %s is not in MAIL_ALLOWLIST (%s)", to, subject[:60])
        return False
    threading.Thread(
        target=_send_sync, args=(to, subject, html, text or subject), daemon=True
    ).start()
    return True
