"""Certificates AIDA issues itself.

Until now the platform only recorded certificates people earned *elsewhere* —
a Coursera link, an uploaded PDF from Microsoft. Finishing an internal programme
produced a completion percentage and nothing to show for it, which is the one
thing people actually keep and forward.

So this renders one: a landscape A4 with the Teal mark, the learner's name, the
programme, the hours behind it, and a verification code. Deliberately printable
rather than a web page — the audience for a certificate is a manager, a wall,
and occasionally a client audit, none of which open a URL.

Nothing about the design is decorative for its own sake: every line on it is a
fact somebody may need to check, and the hours are labelled measured or
estimated exactly as they are everywhere else in the platform, because a
certificate that overstates them is worse than no certificate.
"""

import datetime as dt
import io
import logging

from app.core.branding import (
    INK,
    LOGO_ASPECT,
    MUTED,
    TEAL,
    TEAL_DARK,
    logo_path,
    verification_code,
)

log = logging.getLogger(__name__)

# Wording lives here rather than in the i18n bundle: this is a document, not a
# screen, and it is rendered by a worker that has no locale context. The caller
# picks the language; both are complete.
COPY = {
    "fr": {
        "title": "Certificat de réussite",
        "awarded": "décerné à",
        "for": "pour avoir suivi et validé",
        "hours": "{hours} heures de formation",
        "hours_measured": "{hours} heures de formation (temps mesuré)",
        "issued": "Délivré le {date}",
        "code": "Référence : {code}",
        "verify": "Vérifiable auprès du service Formation.",
        "programme": "Programme",
        "trainer": "Formateur",
        "score": "Score final : {score} %",
        "progress": "Progression : {before} % → {after} %",
    },
    "en": {
        "title": "Certificate of Completion",
        "awarded": "awarded to",
        "for": "for completing",
        "hours": "{hours} training hours",
        "hours_measured": "{hours} training hours (measured time)",
        "issued": "Issued on {date}",
        "code": "Reference: {code}",
        "verify": "Verifiable with the Learning & Development team.",
        "programme": "Programme",
        "trainer": "Trainer",
        "score": "Final score: {score}%",
        "progress": "Progress: {before}% → {after}%",
    },
}


def build_certificate(
    *,
    learner_name: str,
    programme: str,
    record_id: int,
    learner_id: int,
    hours: float = 0.0,
    hours_measured: bool = False,
    issued_on: dt.date | None = None,
    trainer: str = "",
    score: int | None = None,
    entry_score: int | None = None,
    locale: str = "fr",
    kind: str = "formation",
) -> bytes:
    """Render one certificate as a PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as pdfcanvas

    words = COPY.get(locale, COPY["fr"])
    issued_on = issued_on or dt.date.today()
    code = verification_code(kind, record_id, learner_id)

    buffer = io.BytesIO()
    width, height = landscape(A4)
    c = pdfcanvas.Canvas(buffer, pagesize=landscape(A4))
    c.setTitle(f"{words['title']} — {learner_name}")

    # --- frame ------------------------------------------------------------
    # A double rule rather than a border image: it prints cleanly on any
    # printer and survives being photocopied, which a gradient does not.
    c.setStrokeColor(colors.HexColor(TEAL_DARK))
    c.setLineWidth(2.5)
    c.rect(12 * mm, 12 * mm, width - 24 * mm, height - 24 * mm)
    c.setStrokeColor(colors.HexColor(TEAL))
    c.setLineWidth(0.6)
    c.rect(15 * mm, 15 * mm, width - 30 * mm, height - 30 * mm)

    # --- mark -------------------------------------------------------------
    logo = logo_path()
    logo_h = 22 * mm
    if logo:
        c.drawImage(
            logo,
            (width - logo_h * LOGO_ASPECT) / 2,
            height - 46 * mm,
            width=logo_h * LOGO_ASPECT,
            height=logo_h,
            mask="auto",
            preserveAspectRatio=True,
        )
    else:
        # The wordmark is the fallback, so a missing asset costs the letterhead
        # and not the document.
        c.setFillColor(colors.HexColor(TEAL))
        c.setFont("Helvetica-Bold", 26)
        c.drawCentredString(width / 2, height - 36 * mm, "Teal")

    c.setFont("Helvetica", 8.5)
    c.setFillColor(colors.HexColor(MUTED))
    c.drawCentredString(width / 2, height - 52 * mm, "UpSkill · AI & DATA ACADEMY")

    # --- title ------------------------------------------------------------
    c.setFillColor(colors.HexColor(TEAL_DARK))
    c.setFont("Helvetica-Bold", 27)
    c.drawCentredString(width / 2, height - 72 * mm, words["title"])

    c.setFont("Helvetica", 11)
    c.setFillColor(colors.HexColor(MUTED))
    c.drawCentredString(width / 2, height - 84 * mm, words["awarded"])

    # --- the name, which is the point of the page -------------------------
    c.setFillColor(colors.HexColor(INK))
    # Long names have to fit rather than run off the edge, so the size steps
    # down until it does.
    size = 34
    while size > 16 and c.stringWidth(learner_name, "Helvetica-Bold", size) > width - 90 * mm:
        size -= 1
    c.setFont("Helvetica-Bold", size)
    c.drawCentredString(width / 2, height - 100 * mm, learner_name)

    c.setStrokeColor(colors.HexColor(TEAL))
    c.setLineWidth(1)
    rule = min(width - 90 * mm, max(80 * mm, c.stringWidth(learner_name, "Helvetica-Bold", size) + 20 * mm))
    c.line((width - rule) / 2, height - 105 * mm, (width + rule) / 2, height - 105 * mm)

    c.setFont("Helvetica", 11)
    c.setFillColor(colors.HexColor(MUTED))
    c.drawCentredString(width / 2, height - 115 * mm, words["for"])

    c.setFillColor(colors.HexColor(INK))
    size = 17
    while size > 10 and c.stringWidth(programme, "Helvetica-Bold", size) > width - 80 * mm:
        size -= 1
    c.setFont("Helvetica-Bold", size)
    c.drawCentredString(width / 2, height - 126 * mm, programme)

    # --- the facts behind it ---------------------------------------------
    facts: list[str] = []
    if hours:
        key = "hours_measured" if hours_measured else "hours"
        facts.append(words[key].format(hours=f"{hours:g}"))
    if score is not None:
        facts.append(words["score"].format(score=score))
    if entry_score is not None and score is not None and score > entry_score:
        # The before/after gap is the strongest line on the page when it
        # exists: it is the only one that says the training worked.
        facts.append(words["progress"].format(before=entry_score, after=score))
    if trainer:
        facts.append(f"{words['trainer']} : {trainer}")

    c.setFont("Helvetica", 10.5)
    c.setFillColor(colors.HexColor(MUTED))
    y = height - 140 * mm
    for line in facts:
        c.drawCentredString(width / 2, y, line)
        y -= 6 * mm

    # --- footer -----------------------------------------------------------
    c.setFont("Helvetica", 8.5)
    c.setFillColor(colors.HexColor(MUTED))
    c.drawString(24 * mm, 24 * mm, words["issued"].format(date=issued_on.strftime("%d/%m/%Y")))
    c.drawRightString(width - 24 * mm, 24 * mm, words["code"].format(code=code))
    c.setFont("Helvetica-Oblique", 8)
    c.drawCentredString(width / 2, 19 * mm, words["verify"])

    c.showPage()
    c.save()
    return buffer.getvalue()
