"""Server-side report rendering: native Excel workbooks and PDF summaries.

The UI already exports CSV client-side, which Excel opens but cannot style,
paginate or hand to someone as a finished document. These build the real
deliverables HR asks for — a formatted `.xlsx` with one sheet per table, and a
PDF of the headline KPIs.

Both carry charts, because a table of forty programmes answers "what is the
number" and nothing else; the shape of the distribution is the part somebody
actually reads in a steering committee. The Excel charts are native openpyxl
objects rather than pasted images, so whoever receives the file can re-colour
them, change the range or drop them into a deck — a picture of a chart in a
workbook is the one thing worse than no chart.
"""

import datetime as dt
import io
import logging
from typing import Any, NamedTuple, Sequence

log = logging.getLogger(__name__)

BRAND = "0F766E"  # the app's teal, used for header fills

# Six series colours, distinguishable in print and when photocopied in grey —
# a steering-committee pack is still printed more often than anyone admits.
SERIES = ("0F766E", "4F46E5", "CA8A04", "0284C7", "BE185D", "059669")


class Chart(NamedTuple):
    """One chart to render: a title, a kind, and label/value pairs.

    Deliberately not a dict — the exporters are called from two places now, and
    a typo in a dict key would silently produce a chartless report.
    """

    title: str
    kind: str  # "bar" | "column" | "pie" | "line"
    rows: Sequence[tuple[str, float]]
    unit: str = ""


def _clip(text: str, limit: int = 22) -> str:
    text = str(text or "—")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _chart_rows(chart: Chart, cap: int = 12) -> list[tuple[str, float]]:
    """The rows a chart can actually show, biggest first.

    A bar chart with forty categories is a grey smear; the tail is folded into
    "Autres" so the total still reconciles with the table on the previous page.
    Silently dropping it would make the chart disagree with its own report.
    """
    rows = [(str(a), float(b or 0)) for a, b in chart.rows if b is not None]
    rows.sort(key=lambda r: abs(r[1]), reverse=True)
    if len(rows) <= cap:
        return rows
    head, tail = rows[: cap - 1], rows[cap - 1 :]
    return head + [(f"Autres ({len(tail)})", sum(v for _, v in tail))]


def build_xlsx(
    sheets: Sequence[tuple[str, list[str], list[list[Any]]]],
    charts: Sequence[Chart] = (),
) -> bytes:
    """Render `(sheet_name, headers, rows)` triples into a styled workbook.

    `charts` are added as native Excel charts on their own sheet, each backed by
    a small visible data range. Excel refuses to render a chart whose source
    range is hidden or on a protected sheet, so the numbers sit beside the
    picture — which also means the reader can check them.
    """
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, LineChart, PieChart, Reference
    from openpyxl.chart.label import DataLabelList
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    wb.remove(wb.active)  # drop the default sheet; every sheet is explicit

    header_fill = PatternFill("solid", fgColor=BRAND)
    header_font = Font(color="FFFFFF", bold=True)

    for name, headers, rows in sheets:
        # Excel sheet names cap at 31 chars and reject a handful of characters.
        safe = "".join(c for c in name if c not in "[]:*?/\\")[:31] or "Sheet"
        ws = wb.create_sheet(safe)
        ws.append(list(headers))
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(vertical="center")
        for row in rows:
            ws.append(list(row))

        widths = [len(str(h)) for h in headers]
        for row in rows:
            for i, value in enumerate(row):
                if i < len(widths):
                    widths[i] = max(widths[i], len(str(value if value is not None else "")))
        for i, width in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 10), 48)

        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

    if charts:
        from openpyxl.drawing.image import Image as XLImage

        from app.core.branding import logo_path

        sheet = wb.create_sheet("Graphiques", 0)  # first: it is the summary
        sheet.sheet_view.showGridLines = False
        anchor_row = 2

        mark = logo_path()
        if mark:
            try:
                image = XLImage(mark)
                # openpyxl sizes in pixels; the mark is square-ish, so one
                # dimension is enough to keep it in proportion.
                image.height = 46
                image.width = int(46 * (image.width / image.height)) if image.height else 46
                sheet.add_image(image, "B2")
                anchor_row = 6  # the first chart clears the letterhead
            except Exception:  # pragma: no cover - a missing decoder is not fatal
                log.warning("branding: could not embed the logo in the workbook")

        for chart_spec in charts:
            rows = _chart_rows(chart_spec)
            if not rows:
                continue

            # The backing range, written to the right of the plot area so the
            # charts stack down column B without colliding with their data.
            first_data_row = anchor_row
            sheet.cell(row=first_data_row, column=12, value="Catégorie").font = Font(bold=True)
            sheet.cell(row=first_data_row, column=13, value=chart_spec.title).font = Font(bold=True)
            for offset, (label, value) in enumerate(rows, start=1):
                sheet.cell(row=first_data_row + offset, column=12, value=label)
                sheet.cell(row=first_data_row + offset, column=13, value=value)

            labels = Reference(
                sheet,
                min_col=12,
                min_row=first_data_row + 1,
                max_row=first_data_row + len(rows),
            )
            values = Reference(
                sheet,
                min_col=13,
                min_row=first_data_row,
                max_row=first_data_row + len(rows),
            )

            if chart_spec.kind == "pie":
                chart = PieChart()
                chart.dataLabels = DataLabelList()
                chart.dataLabels.showPercent = True
            elif chart_spec.kind == "line":
                chart = LineChart()
            else:
                chart = BarChart()
                # Horizontal bars for categories: a BU name needs a row of
                # width, not a rotated label under a column.
                chart.type = "bar" if chart_spec.kind == "bar" else "col"
                chart.gapWidth = 45
            chart.title = chart_spec.title
            if chart_spec.unit and chart_spec.kind != "pie":
                chart.y_axis.title = chart_spec.unit
            chart.add_data(values, titles_from_data=True)
            chart.set_categories(labels)
            chart.height = 8.5
            chart.width = 19
            chart.style = 2
            sheet.add_chart(chart, f"B{anchor_row}")

            # Leave room for the plot plus a gap, and never overlap the next
            # chart's own backing rows.
            anchor_row += max(18, len(rows) + 4)

        sheet.column_dimensions["A"].width = 2
        for column in ("L", "M"):
            sheet.column_dimensions[column].width = 26

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def build_pdf(title: str, subtitle: str, kpis: list[tuple[str, str]],
              tables: Sequence[tuple[str, list[str], list[list[Any]]]],
              charts: Sequence[Chart] = ()) -> bytes:
    """Render a landscape A4 report: KPIs, charts, then one table per section.

    Charts come before the tables on purpose. The first page is the one that
    gets projected; the tables are the appendix somebody consults afterwards.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=14 * mm, bottomMargin=14 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=colors.HexColor(f"#{BRAND}"))
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.5, leading=9)

    # Letterhead: the mark on the left, the title beside it. A report that
    # leaves the building — and these do, into steering committees — should say
    # where it came from without anyone having to add a slide.
    from reportlab.platypus import Image as RLImage

    from app.core.branding import LOGO_ASPECT, logo_path

    logo = logo_path()
    heading = [Paragraph(title, h1)]
    if subtitle:
        heading.append(Paragraph(subtitle, small))
    heading.append(Paragraph(f"Généré le {dt.date.today():%d/%m/%Y}", small))

    story: list[Any] = []
    if logo:
        mark_h = 13 * mm
        header = Table(
            [[RLImage(logo, width=mark_h * LOGO_ASPECT, height=mark_h), heading]],
            colWidths=[mark_h * LOGO_ASPECT + 6 * mm, doc.width - mark_h * LOGO_ASPECT - 6 * mm],
        )
        header.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(header)
    else:
        story += heading
    story.append(Spacer(1, 3 * mm))
    # A rule under the letterhead, so the brand block reads as one object
    # instead of floating above the content.
    rule = Table([[""]], colWidths=[doc.width], rowHeights=[0.1])
    rule.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor(f"#{BRAND}"))]))
    story += [rule, Spacer(1, 6 * mm)]

    if kpis:
        kpi_table = Table(
            [[Paragraph(f"<b>{v}</b>", styles["Normal"]) for _, v in kpis],
             [Paragraph(k, small) for k, _ in kpis]],
            colWidths=[(doc.width / len(kpis))] * len(kpis),
        )
        kpi_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story += [kpi_table, Spacer(1, 8 * mm)]

    drawn = [c for c in charts if _chart_rows(c)]
    for pair_start in range(0, len(drawn), 2):
        pair = drawn[pair_start : pair_start + 2]
        cells = [_pdf_chart(c, doc.width / len(pair) - 6 * mm) for c in pair]
        holder = Table([cells], colWidths=[doc.width / len(pair)] * len(pair))
        holder.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        story += [holder, Spacer(1, 6 * mm)]

    for index, (name, headers, rows) in enumerate(tables):
        if index or drawn:
            story.append(PageBreak())
        story.append(Paragraph(name, styles["Heading3"]))
        story.append(Spacer(1, 3 * mm))
        data = [[Paragraph(f"<b>{h}</b>", cell) for h in headers]]
        for row in rows:
            data.append([Paragraph(str(v if v is not None else "—"), cell) for v in row])
        table = Table(data, repeatRows=1, colWidths=[doc.width / len(headers)] * len(headers))
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(f"#{BRAND}")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(table)

    doc.build(story)
    return buffer.getvalue()


def _pdf_chart(spec: Chart, width: float):
    """One chart as a reportlab Drawing, sized to the column it sits in."""
    from reportlab.graphics.charts.barcharts import HorizontalBarChart
    from reportlab.graphics.charts.piecharts import Pie
    from reportlab.graphics.shapes import Drawing, String
    from reportlab.lib import colors

    rows = _chart_rows(spec, cap=10)
    labels = [_clip(a) for a, _ in rows]
    values = [b for _, b in rows]

    height = 150 + (10 * len(rows) if spec.kind != "pie" else 0)
    drawing = Drawing(width, height)
    drawing.add(
        String(
            0,
            height - 12,
            spec.title,
            fontName="Helvetica-Bold",
            fontSize=9,
            fillColor=colors.HexColor(f"#{BRAND}"),
        )
    )

    if spec.kind == "pie":
        pie = Pie()
        pie.x, pie.y = 10, 18
        pie.width = pie.height = min(width * 0.55, height - 46)
        pie.data = values
        pie.labels = [f"{l} ({v:g})" for l, v in zip(labels, values)]
        pie.sideLabels = 1
        pie.slices.strokeWidth = 0.5
        pie.slices.strokeColor = colors.white
        for i in range(len(values)):
            pie.slices[i].fillColor = colors.HexColor(f"#{SERIES[i % len(SERIES)]}")
        drawing.add(pie)
        return drawing

    chart = HorizontalBarChart()
    chart.x, chart.y = 96, 22
    chart.width = max(60, width - 116)
    chart.height = height - 46
    chart.data = [values]
    chart.categoryAxis.categoryNames = labels
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.boxAnchor = "e"
    chart.categoryAxis.labels.dx = -4
    chart.valueAxis.valueMin = min(0, min(values))
    # Let reportlab choose the top; a hand-picked max is how a bar ends up
    # drawn past the edge of its own axis.
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.visibleGrid = 1
    chart.valueAxis.gridStrokeColor = colors.HexColor("#E2E8F0")
    chart.barLabels.fontSize = 7
    chart.barLabelFormat = "%0.4g"
    chart.barLabels.dx = 8
    chart.barSpacing = 2
    chart.groupSpacing = 4
    for i in range(len(values)):
        chart.bars[(0, i)].fillColor = colors.HexColor(f"#{SERIES[i % len(SERIES)]}")
    chart.bars.strokeWidth = 0
    drawing.add(chart)
    return drawing
