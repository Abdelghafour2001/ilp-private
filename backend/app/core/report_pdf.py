"""The periodic learning report as a branded PDF.

Kept apart from `activity_report`, which computes the figures: one module
decides what is true, this one decides how it looks. Charts are hand-drawn with
reportlab's own shapes — a charting dependency would have to be installed into
the image to draw four series of numbers.
"""

from __future__ import annotations

import datetime as dt
import io

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.activity_report import HOURS_PER_MAN_DAY, delta
from app.core.branding import INK, LOGO_ASPECT, MUTED, TEAL, TEAL_DARK, logo_path

TINT = "#E8F5F3"
RULE = "#D9DEE3"

# Coursera's own content types, said in words a reader recognises. Anything
# the provider adds later falls through to its own name rather than a blank.
CONTENT_TYPES = {
    "Course": {"fr": "Cours", "en": "Course"},
    "Specialization": {"fr": "Spécialisation", "en": "Specialization"},
    "LearningPath": {"fr": "Parcours", "en": "Learning path"},
    "Video": {"fr": "Vidéo", "en": "Video"},
    "Project": {"fr": "Projet", "en": "Project"},
}
AMBER = "#F2A93B"
SLATE = "#CBD5E1"


def _styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName="Helvetica", textColor=colors.HexColor(INK), fontSize=9.5, leading=13)
    return {
        "title": ParagraphStyle("t", **{**base, "fontName": "Helvetica-Bold", "fontSize": 24, "leading": 28}),
        "sub": ParagraphStyle("s", **{**base, "fontSize": 12, "leading": 16, "textColor": colors.HexColor(MUTED)}),
        "h2": ParagraphStyle("h2", **{**base, "fontName": "Helvetica-Bold", "fontSize": 13, "leading": 17,
                                      "textColor": colors.HexColor(TEAL_DARK), "spaceBefore": 12, "spaceAfter": 5}),
        "body": ParagraphStyle("b", **base),
        "small": ParagraphStyle("sm", **{**base, "fontSize": 8, "leading": 11, "textColor": colors.HexColor(MUTED)}),
        "cell": ParagraphStyle("c", **{**base, "fontSize": 8, "leading": 10}),
        "head": ParagraphStyle("h", **{**base, "fontName": "Helvetica-Bold", "fontSize": 7.5, "leading": 10,
                                       "textColor": colors.HexColor(TEAL_DARK)}),
        "kpi": ParagraphStyle("k", **{**base, "fontName": "Helvetica-Bold", "fontSize": 16, "leading": 19}),
    }


def _column_chart(rows: list[tuple[str, float]], width: float, height: float, colour: str) -> Drawing:
    drawing = Drawing(width, height)
    chart = VerticalBarChart()
    chart.x, chart.y = 30, 24
    chart.width, chart.height = width - 44, height - 44
    chart.data = [[value for _, value in rows]]
    chart.categoryAxis.categoryNames = [label for label, _ in rows]
    chart.categoryAxis.labels.fontSize = 6.5
    chart.categoryAxis.labels.angle = 30
    chart.categoryAxis.labels.dy = -6
    chart.categoryAxis.labels.boxAnchor = "ne"
    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontSize = 6.5
    chart.bars[0].fillColor = colors.HexColor(colour)
    chart.bars[0].strokeColor = None
    chart.barSpacing = 1.5
    drawing.add(chart)
    return drawing


def _donut(parts: list[tuple[str, float]], width: float, height: float) -> Drawing:
    """A ring with its legend beside it — the three states an enrolment can be in."""
    palette = [TEAL, AMBER, SLATE]
    drawing = Drawing(width, height)
    pie = Pie()
    pie.x, pie.y = 10, 12
    pie.width = pie.height = height - 24
    pie.data = [max(float(value), 0.001) for _, value in parts]
    pie.innerRadiusFraction = 0.55
    pie.slices.strokeWidth = 0
    for index in range(len(parts)):
        pie.slices[index].fillColor = colors.HexColor(palette[index])
    drawing.add(pie)

    total = sum(value for _, value in parts) or 1
    for index, (label, value) in enumerate(parts):
        y = height - 34 - index * 15
        drawing.add(String(pie.width + 34, y, "■", fillColor=colors.HexColor(palette[index]), fontSize=10))
        drawing.add(String(pie.width + 48, y, f"{label} — {int(value)} ({round(100 * value / total)}%)",
                           fillColor=colors.HexColor(INK), fontSize=8))
    return drawing


def build(data: dict, commentary: str, author: str, locale: str) -> bytes:
    fr = locale == "fr"

    def tr(french: str, english: str) -> str:
        return french if fr else english

    S = _styles()
    label = data["period"]
    now, before, totals = data["now"], data["before"], data["totals"]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=18 * mm, bottomMargin=16 * mm,
        title=tr(f"Rapport formation — {label}", f"Learning report — {label}"), author="UpSkill",
    )
    width = doc.width

    def table(header: list[str], rows: list[list], widths: list[float]) -> Table:
        body = [[Paragraph(h, S["head"]) for h in header]]
        body += [[Paragraph(str(cell), S["cell"]) for cell in row] for row in rows]
        t = Table(body, colWidths=[w * width for w in widths], repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(TINT)),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(RULE)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return t

    story: list = []

    # cover
    mark = logo_path()
    if mark:
        height = 18 * mm
        story.append(RLImage(mark, width=height * LOGO_ASPECT, height=height, hAlign="LEFT"))
        story.append(Spacer(1, 12))
    story.append(Paragraph(tr("Rapport d'activité formation", "Learning activity report"), S["title"]))
    story.append(Paragraph(label, S["sub"]))
    bar = Table([[""]], colWidths=[width], rowHeights=[2.5])
    bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(TEAL))]))
    story += [Spacer(1, 10), bar, Spacer(1, 12)]

    meta = [
        (tr("Période", "Period"), f"{data['start']:%d/%m/%Y} – {data['end']:%d/%m/%Y}"),
        (tr("Comparée à", "Compared with"), f"{data['prev_start']:%d/%m/%Y} – {data['prev_end']:%d/%m/%Y}"),
        (tr("Périmètre", "Scope"), totals["contract"] or tr("Toute l'organisation", "Whole organisation")),
        (tr("Source", "Source"), "Coursera for Business + UpSkill"),
        (tr("Généré le", "Generated"), f"{dt.date.today():%d/%m/%Y}"),
    ]
    meta_table = Table([[Paragraph(k, S["small"]), Paragraph(v, S["body"])] for k, v in meta],
                       colWidths=[0.24 * width, 0.76 * width])
    meta_table.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(meta_table)

    # KPI band — two rows of three, each with its change on the period before
    story.append(Paragraph(tr("Chiffres de la période", "The period in figures"), S["h2"]))
    kpis = [
        (tr("Complétions", "Completions"), now["completions"], before["completions"]),
        (tr("Heures", "Hours"), now["hours"], before["hours"]),
        (tr("Jour-Homme", "Person-days"), now["man_days"], before["man_days"]),
        (tr("Collaborateurs actifs", "Active people"), now["active_people"], before["active_people"]),
        (tr("Nouvelles inscriptions", "New enrolments"), now["starts"], before["starts"]),
        (tr("Certificats", "Certificates"), now["certificates"], before["certificates"]),
    ]
    cells = [
        [Paragraph(name, S["small"]), Paragraph(str(value), S["kpi"]),
         Paragraph(tr("vs préc. : ", "vs prev: ") + delta(value, previous), S["small"])]
        for name, value, previous in kpis
    ]
    grid = [[Table([[line] for line in cell], style=TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ])) for cell in cells[start:start + 3]] for start in (0, 3)]
    band = Table(grid, colWidths=[width / 3] * 3)
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F6FAFA")),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor(RULE)),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor(RULE)),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(band)

    # commentary and findings
    story.append(Paragraph(tr("Analyse", "Analysis"), S["h2"]))
    if commentary:
        for paragraph in [p.strip() for p in commentary.split("\n") if p.strip()]:
            story.append(Paragraph(paragraph, S["body"]))
            story.append(Spacer(1, 5))
        story.append(Paragraph(tr(
            f"Commentaire rédigé par {author} à partir des chiffres de ce rapport.",
            f"Commentary written by {author} from the figures in this report."), S["small"]))
    else:
        story.append(Paragraph(tr(
            "Aucun modèle n'était joignable : seuls les constats calculés figurent ci-dessous.",
            "No model was reachable, so only the computed findings appear below."), S["small"]))

    story.append(Paragraph(tr("Constats", "What stands out"), S["h2"]))
    for item in data["findings"] or [tr("Rien hors des plages habituelles.", "Nothing outside the usual range.")]:
        story.append(Paragraph(f"• {item}", S["body"]))

    # charts
    story.append(PageBreak())
    story.append(Paragraph(tr("Complétions par mois", "Completions per month"), S["h2"]))
    story.append(_column_chart([(f"{m[5:7]}/{m[2:4]}", value) for m, value in data["trend"]], width, 160, TEAL))

    story.append(Paragraph(tr("Où en sont les inscriptions", "Where enrolments stand"), S["h2"]))
    story.append(_donut([
        (tr("Terminées", "Completed"), totals["completed"]),
        (tr("En cours", "In progress"), totals["in_progress"]),
        (tr("Jamais ouvertes", "Never opened"), totals["never_opened"]),
    ], width, 140))

    units = [u for u in data["by_unit"] if u["label"] not in ("Non renseigné", "Not stated")][:8]
    if units:
        story.append(Paragraph(tr("Taux de complétion par entité (%)", "Completion rate by unit (%)"), S["h2"]))
        story.append(_column_chart([(u["label"][:14], u["rate"]) for u in units], width, 150, TEAL_DARK))

    # tables
    story.append(PageBreak())
    story.append(Paragraph(tr("Par programme", "By programme"), S["h2"]))
    story.append(table(
        [tr("Programme", "Programme"), tr("Collab.", "People"), tr("Inscriptions", "Enrolments"),
         tr("Terminées", "Completed"), tr("Complétion", "Completion"), tr("Heures", "Hours")],
        [[p["label"], p["people"], p["enrollments"], p["completed"], f"{p['rate']}%", p["hours"]]
         for p in data["by_program"][:10]],
        [0.34, 0.11, 0.15, 0.13, 0.13, 0.14],
    ))

    story.append(Paragraph(tr("Par entité", "By unit"), S["h2"]))
    story.append(table(
        [tr("Entité", "Unit"), tr("Collab.", "People"), tr("Inscriptions", "Enrolments"),
         tr("Complétion", "Completion"), tr("Heures", "Hours")],
        [[u["label"], u["people"], u["enrollments"], f"{u['rate']}%", u["hours"]] for u in data["by_unit"][:10]],
        [0.40, 0.13, 0.19, 0.14, 0.14],
    ))

    story.append(Paragraph(tr("Contenus les plus suivis", "Most enrolled content"), S["h2"]))
    story.append(table(
        [tr("Contenu", "Content"), tr("Inscriptions", "Enrolments"), tr("Terminées", "Completed"),
         tr("Complétion", "Completion"), tr("Heures", "Hours")],
        [[c["label"], c["enrollments"], c["completed"], f"{c['rate']}%", c["hours"]] for c in data["top_content"]],
        [0.44, 0.15, 0.14, 0.13, 0.14],
    ))

    # Deliberately aggregate. An earlier draft listed the people who had started
    # without finishing, by name, which turns a steering-committee document into
    # a list of individuals to explain themselves — a management conversation,
    # not a committee one. The count and where it sits carry the same signal;
    # the names live in the per-person card, which goes to that person's manager.
    stalled = data["stalled"]
    if stalled["people"]:
        story.append(Paragraph(tr("Engagement à relancer", "Engagement to pick up"), S["h2"]))
        story.append(Paragraph(tr(
            f"{stalled['people']} collaborateurs ont commencé un contenu sans le terminer, "
            f"pour {stalled['items']} contenus ouverts. Les plus concernées : "
            f"{stalled['where']}. Le détail nominatif est disponible par collaborateur "
            "(fiche individuelle), destinée au manager plutôt qu'au comité.",
            f"{stalled['people']} people have started content without finishing it, across "
            f"{stalled['items']} open items. Most affected: {stalled['where']}. The names are "
            "available per person (individual card), which is a manager's conversation rather "
            "than a committee's."), S["body"]))

    story.append(Paragraph(tr("Méthode", "Method"), S["h2"]))
    story.append(Paragraph(tr(
        "Les heures sont le temps rapporté par Coursera, rattaché à la période de dernière "
        f"activité de l'inscription. Un Jour-Homme vaut {HOURS_PER_MAN_DAY:.0f} heures. Le taux de "
        "complétion rapporte les inscriptions terminées au total des inscriptions, y compris celles "
        "jamais ouvertes. Tous les chiffres sont calculés à partir des enregistrements de la "
        "plateforme ; le commentaire n'en produit aucun.",
        "Hours are the time Coursera reports, attributed to the period of the enrolment's last "
        f"activity. A person-day is {HOURS_PER_MAN_DAY:.0f} hours. Completion is finished enrolments over "
        "all enrolments, including those never opened. Every figure is computed from platform "
        "records; the commentary produces none of its own."), S["small"]))

    def furniture(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor(TEAL))
        canvas.setLineWidth(3)
        canvas.line(0, A4[1] - 5 * mm, A4[0], A4[1] - 5 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(16 * mm, 10 * mm,
                          tr(f"UpSkill — Rapport formation · {label}", f"UpSkill — Learning report · {label}"))
        canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, str(document.page))
        canvas.restoreState()

    doc.build(story, onFirstPage=furniture, onLaterPages=furniture)
    return buffer.getvalue()


def build_person(data: dict, commentary: str, author: str, locale: str) -> bytes:
    """The individual card: one page a manager can take into a one-to-one."""
    fr = locale == "fr"

    def tr(french: str, english: str) -> str:
        return french if fr else english

    S = _styles()
    person = data["person"]
    totals, bench, now, before = data["totals"], data["benchmark"], data["now"], data["before"]
    label = data["period"]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=18 * mm, bottomMargin=16 * mm,
        title=tr(f"Fiche formation — {person['name']}", f"Learning card — {person['name']}"),
        author="UpSkill",
    )
    width = doc.width

    def table(header: list[str], rows: list[list], widths: list[float]) -> Table:
        body = [[Paragraph(h, S["head"]) for h in header]]
        body += [[Paragraph(str(cell), S["cell"]) for cell in row] for row in rows]
        t = Table(body, colWidths=[w * width for w in widths], repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(TINT)),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(RULE)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return t

    story: list = []
    mark = logo_path()
    head = Table(
        [[
            RLImage(mark, width=14 * mm * LOGO_ASPECT, height=14 * mm) if mark else Paragraph("UpSkill", S["h2"]),
            [
                Paragraph(person["name"], S["title"]),
                Paragraph(
                    " · ".join(x for x in (person["job_title"], person["unit"], person["location"]) if x),
                    S["sub"],
                ),
            ],
        ]],
        colWidths=[20 * mm, width - 20 * mm],
    )
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(head)
    bar = Table([[""]], colWidths=[width], rowHeights=[2.5])
    bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(TEAL))]))
    story += [Spacer(1, 8), bar, Spacer(1, 10)]

    meta = [
        # A range label already carries its own dates; printing them twice read
        # as two different periods.
        (tr("Période", "Period"),
         label if "→" in label else f"{label} — {data['start']:%d/%m/%Y} – {data['end']:%d/%m/%Y}"),
        (tr("Manager", "Manager"), person["manager"]),
        # The programme list is not in the header: somebody on nine of them got
        # a wall of text above their own figures, and the breakdown further
        # down says the same thing with numbers against it.
        (tr("E-mail", "Email"), person["email"]),
    ]
    meta_table = Table(
        [[Paragraph(k, S["small"]), Paragraph(v, S["body"])] for k, v in meta],
        colWidths=[0.22 * width, 0.78 * width],
    )
    meta_table.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(meta_table)

    story.append(Paragraph(tr("Sur la période", "In the period"), S["h2"]))
    kpis = [
        (tr("Complétions", "Completions"), now["completions"], before["completions"]),
        (tr("Heures", "Hours"), now["hours"], before["hours"]),
        (tr("Certificats", "Certificates"), now["certificates"], before["certificates"]),
    ]
    cells = [
        [
            Paragraph(name, S["small"]),
            Paragraph(str(value), S["kpi"]),
            Paragraph(tr("vs préc. : ", "vs prev: ") + delta(value, previous), S["small"]),
        ]
        for name, value, previous in kpis
    ]
    band = Table(
        [[Table([[line] for line in cell], style=TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ])) for cell in cells]],
        colWidths=[width / 3] * 3,
    )
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F6FAFA")),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor(RULE)),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor(RULE)),
        ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(band)

    # Cumulative position, against the two benchmarks that make it readable:
    # "12 hours" says nothing; "12 hours against a unit median of 3" does.
    story.append(Paragraph(tr("Depuis le début", "Cumulative"), S["h2"]))
    story.append(table(
        ["",
         tr("Ce collaborateur", "This person"),
         tr(f"Médiane {bench['unit_label']}", f"{bench['unit_label']} median"),
         tr("Médiane organisation", "Organisation median")],
        [
            [tr("Heures", "Hours"), totals["hours"], bench["unit_median_hours"], bench["org_median_hours"]],
            [tr("Taux de complétion", "Completion rate"), f"{totals['completion_rate']}%",
             f"{bench['unit_median_rate']:.0f}%", f"{bench['org_median_rate']:.0f}%"],
        ],
        [0.34, 0.22, 0.22, 0.22],
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(tr(
        f"{totals['enrollments']} inscriptions : {totals['completed']} terminées, "
        f"{totals['in_progress']} en cours, {totals['never_opened']} jamais ouvertes. "
        f"{totals['certificates']} certificat(s), {totals['man_days']} jour-homme.",
        f"{totals['enrollments']} enrolments: {totals['completed']} completed, "
        f"{totals['in_progress']} in progress, {totals['never_opened']} never opened. "
        f"{totals['certificates']} certificate(s), {totals['man_days']} person-days."), S["small"]))

    if commentary:
        story.append(Paragraph(tr("Lecture", "Reading"), S["h2"]))
        for paragraph in [p.strip() for p in commentary.split("\n") if p.strip()]:
            story.append(Paragraph(paragraph, S["body"]))
            story.append(Spacer(1, 4))
        story.append(Paragraph(tr(
            f"Commentaire rédigé par {author} à partir des chiffres de cette fiche.",
            f"Commentary written by {author} from the figures on this card."), S["small"]))

    if data["findings"]:
        story.append(Paragraph(tr("Points d'attention", "Points to note"), S["h2"]))
        for item in data["findings"]:
            story.append(Paragraph(f"• {item}", S["body"]))

    # What kind of thing they did, before the line-by-line: a specialisation is
    # several courses' worth of work, and a flat list of titles hid that.
    story.append(Paragraph(tr("Par type de contenu", "By content type"), S["h2"]))
    story.append(table(
        [tr("Type", "Type"), tr("Inscriptions", "Enrolments"), tr("Terminées", "Completed"),
         tr("Complétion", "Completion"), tr("Certificats", "Certificates"), tr("Heures", "Hours")],
        [[CONTENT_TYPES.get(k["label"], {}).get("fr" if fr else "en", k["label"]),
          k["enrollments"], k["completed"], f"{k['rate']}%", k["certificates"], k["hours"]]
         for k in data["by_type"]],
        [0.34, 0.15, 0.14, 0.13, 0.14, 0.10],
    ))

    if len(data["by_program"]) > 1:
        story.append(Paragraph(tr("Par programme", "By programme"), S["h2"]))
        story.append(table(
            [tr("Programme", "Programme"), tr("Inscriptions", "Enrolments"),
             tr("Terminées", "Completed"), tr("Complétion", "Completion"), tr("Heures", "Hours")],
            [[p["label"], p["enrollments"], p["completed"], f"{p['rate']}%", p["hours"]]
             for p in data["by_program"]],
            [0.40, 0.16, 0.16, 0.14, 0.14],
        ))

    # Everything, not a first page of it. This used to stop at 26 rows and say
    # "and 12 more", which is exactly where the specialisations sat — they
    # carry no progress, so they sorted last and fell off the card.
    story.append(Paragraph(tr("Détail des contenus", "Content in detail"), S["h2"]))
    story.append(table(
        [tr("Contenu", "Content"), tr("Type", "Type"), tr("Programme", "Programme"),
         tr("Avancement", "Progress"), tr("Note", "Grade"), tr("Heures", "Hours"),
         tr("Terminé le", "Completed"), tr("Cert.", "Cert.")],
        [
            [item["title"],
             CONTENT_TYPES.get(item["type"], {}).get("fr" if fr else "en", item["type"]),
             item["program"], f"{item['progress']}%",
             f"{item['grade']}%" if item["grade"] is not None else "—",
             item["hours"], item["completed_on"] or "—", "✓" if item["certificate"] else ""]
            for item in data["items"]
        ],
        [0.27, 0.13, 0.17, 0.10, 0.08, 0.08, 0.11, 0.06],
    ))
    story.append(Paragraph(tr(
        f"{len(data['items'])} contenus, soit la totalité du dossier sur la période.",
        f"{len(data['items'])} items — the whole record for this period."), S["small"]))

    # The other half of the same person: what they did on AIDA itself.
    KINDS = {
        "training": {"fr": "Formation", "en": "Training"},
        "course": {"fr": "Cours", "en": "Course"},
        "pathway": {"fr": "Parcours", "en": "Pathway"},
        "lab": {"fr": "Lab", "en": "Lab"},
        "session": {"fr": "Session", "en": "Session"},
        "declared": {"fr": "Déclaré", "en": "Declared"},
    }
    STATUS = {
        "completed": {"fr": "Terminé", "en": "Completed"},
        "in_progress": {"fr": "En cours", "en": "In progress"},
        "not_started": {"fr": "Non commencé", "en": "Not started"},
    }
    aida_items = data.get("aida_items") or []
    if aida_items:
        story.append(Paragraph(tr("Contenus UpSkill", "UpSkill content"), S["h2"]))
        story.append(table(
            [tr("Contenu", "Content"), tr("Type", "Type"), tr("Avancement", "Progress"),
             tr("Statut", "Status"), tr("Heures", "Hours"), tr("Terminé le", "Completed")],
            [[i["title"],
              KINDS.get(i["kind"], {}).get("fr" if fr else "en", i["kind"]),
              f"{i['percent']}%",
              STATUS.get(i["status"], {}).get("fr" if fr else "en", i["status"]),
              i["hours"], i["completed_on"] or "—"]
             for i in aida_items],
            [0.34, 0.14, 0.12, 0.17, 0.10, 0.13],
        ))

    certificates = data.get("aida_certificates") or []
    if certificates:
        story.append(Paragraph(tr("Certifications", "Certifications"), S["h2"]))
        story.append(table(
            [tr("Certification", "Certification"), tr("Émetteur", "Issuer"),
             tr("Obtenue le", "Obtained"), tr("Expire le", "Expires")],
            [[c["title"], c["issuer"] or "—", c["obtained_on"] or "—", c["expires_on"] or "—"]
             for c in certificates],
            [0.42, 0.24, 0.17, 0.17],
        ))

    story.append(Paragraph(tr("Méthode", "Method"), S["h2"]))
    story.append(Paragraph(tr(
        "Tous les contenus du dossier sont listés. Coursera ne rapporte les spécialisations "
        "que lorsqu'elles sont inscrites comme telles : les cours qui en font partie figurent "
        "individuellement, avec leur certificat. "
        "Heures telles que rapportées par Coursera. Les médianes comparent cette personne aux "
        f"{bench['unit_people']} collaborateurs de son entité et aux {bench['org_people']} de "
        "l'organisation présents sur la plateforme. Document destiné au collaborateur et à son "
        "manager.",
        "Every item on the record is listed. Coursera reports a specialization only where it "
        "was enrolled as one; the courses inside it appear individually, each with its "
        "certificate. "
        "Hours as reported by Coursera. The medians compare this person with the "
        f"{bench['unit_people']} people in their unit and the {bench['org_people']} across the "
        "organisation who appear on the platform. Intended for the person and their manager."),
        S["small"]))

    def furniture(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor(TEAL))
        canvas.setLineWidth(3)
        canvas.line(0, A4[1] - 5 * mm, A4[0], A4[1] - 5 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(16 * mm, 10 * mm, tr(
            f"UpSkill — Fiche formation · {person['name']} · {label}",
            f"UpSkill — Learning card · {person['name']} · {label}"))
        canvas.drawRightString(A4[0] - 16 * mm, 10 * mm, str(document.page))
        canvas.restoreState()

    doc.build(story, onFirstPage=furniture, onLaterPages=furniture)
    return buffer.getvalue()
