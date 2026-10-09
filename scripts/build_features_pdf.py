"""Render docs/FEATURES.md as a branded PDF.

The feature reference is written in Markdown because that is what a repository
should hold: reviewable, diffable, one source of truth. This turns that same
file into the document you hand to somebody who is not going to open a
repository, without maintaining a second copy of the text.

Run it from the backend container, which has ReportLab and the Teal assets:

    podman cp scripts/build_features_pdf.py <backend>:/tmp/build.py
    podman cp docs/FEATURES.md <backend>:/tmp/features.md
    podman exec <backend> python /tmp/build.py /tmp/features.md /tmp/out.pdf
    podman cp <backend>:/tmp/out.pdf docs/AIDA-Feature-Reference.pdf

It handles the Markdown this document actually uses — headings, paragraphs,
bullets, pipe tables, fenced code, block quotes, rules and inline bold / code /
links. It is not a general Markdown engine and does not try to be.
"""

from __future__ import annotations

import datetime as dt
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    Image,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    TableStyle,
)

sys.path.insert(0, "/app")
from app.core.branding import INK, MUTED, TEAL, TEAL_DARK, logo_path  # noqa: E402

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
BODY_W = PAGE_W - 2 * MARGIN

TITLE = "AIDA — Feature reference"
SUBTITLE = "Every screen, what it does, and who can do what"

# The base fonts cover Latin-1 and nothing else, so the few symbols the document
# uses are translated rather than dropped silently into empty boxes. Meaning is
# kept: a tick becomes the word it stood for.
SYMBOLS = {
    "✅": "Yes",      # heavy check mark
    "◐": "Part",     # half-filled circle
    "\U0001f517": "link",  # link symbol
    "️": "",         # variation selector
}
EMOJI = re.compile("[\U0001f000-\U0001faff←-⇿☀-➿]")


def plain(text: str) -> str:
    for symbol, word in SYMBOLS.items():
        text = text.replace(symbol, word)
    return EMOJI.sub("", text).strip()


# --------------------------------------------------------------------------- #
# inline markup                                                               #
# --------------------------------------------------------------------------- #

CODE = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
ITALIC = re.compile(r"(?<![*\w])\*([^*\n]+)\*(?!\*)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def inline(text: str) -> str:
    """Markdown inline markup as ReportLab's mini-HTML."""
    text = plain(text)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def code(match: re.Match) -> str:
        return f'<font face="Courier" size="8.5" color="{TEAL_DARK}">{match.group(1)}</font>'

    def link(match: re.Match) -> str:
        label, href = match.group(1), match.group(2)
        # A repository-relative path is not clickable from a PDF, so it is shown
        # as the path it is rather than as a link that goes nowhere.
        if href.startswith("http"):
            return f'<link href="{href}" color="{TEAL_DARK}"><u>{label}</u></link>'
        return f'<font face="Courier" size="8.5" color="{TEAL_DARK}">{label}</font>'

    text = LINK.sub(link, text)
    text = CODE.sub(code, text)
    text = BOLD.sub(r"<b>\1</b>", text)
    text = ITALIC.sub(r"<i>\1</i>", text)
    return text


# --------------------------------------------------------------------------- #
# styles                                                                      #
# --------------------------------------------------------------------------- #

base = getSampleStyleSheet()
S = {
    "h1": ParagraphStyle(
        "h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=17,
        leading=21, textColor=colors.HexColor(TEAL_DARK), spaceBefore=18, spaceAfter=8,
    ),
    "h2": ParagraphStyle(
        "h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=12.5,
        leading=16, textColor=colors.HexColor(INK), spaceBefore=14, spaceAfter=5,
    ),
    "h3": ParagraphStyle(
        "h3", parent=base["Heading3"], fontName="Helvetica-Bold", fontSize=10.5,
        leading=14, textColor=colors.HexColor(TEAL_DARK), spaceBefore=10, spaceAfter=4,
    ),
    "body": ParagraphStyle(
        "body", parent=base["BodyText"], fontName="Helvetica", fontSize=9,
        leading=13, textColor=colors.HexColor(INK), alignment=TA_LEFT,
        spaceBefore=0, spaceAfter=6,
    ),
    "bullet": ParagraphStyle(
        "bullet", parent=base["BodyText"], fontName="Helvetica", fontSize=9,
        leading=13, textColor=colors.HexColor(INK), leftIndent=12,
        bulletIndent=2, spaceBefore=0, spaceAfter=3,
    ),
    "quote": ParagraphStyle(
        "quote", parent=base["BodyText"], fontName="Helvetica", fontSize=8.8,
        leading=12.5, textColor=colors.HexColor(INK), leftIndent=10, rightIndent=6,
        borderPadding=(6, 6, 6, 8), backColor=colors.HexColor("#F1F7F6"),
        spaceBefore=4, spaceAfter=8,
    ),
    "cell": ParagraphStyle(
        "cell", fontName="Helvetica", fontSize=8, leading=10.5,
        textColor=colors.HexColor(INK),
    ),
    "cellhead": ParagraphStyle(
        "cellhead", fontName="Helvetica-Bold", fontSize=8, leading=10.5,
        textColor=colors.white,
    ),
    "code": ParagraphStyle(
        "code", fontName="Courier", fontSize=8, leading=10.5,
        textColor=colors.HexColor(INK), backColor=colors.HexColor("#F4F6F6"),
        borderPadding=(5, 5, 5, 6), spaceBefore=2, spaceAfter=8,
    ),
    "coverTitle": ParagraphStyle(
        "coverTitle", fontName="Helvetica-Bold", fontSize=26, leading=31,
        textColor=colors.HexColor(TEAL_DARK), spaceAfter=6,
    ),
    "coverSub": ParagraphStyle(
        "coverSub", fontName="Helvetica", fontSize=12, leading=17,
        textColor=colors.HexColor(MUTED),
    ),
}


# --------------------------------------------------------------------------- #
# tables                                                                      #
# --------------------------------------------------------------------------- #

def widths_for(rows: list[list[str]], total: float) -> list[float]:
    """Column widths in proportion to what each column has to hold.

    Weighted by the longest cell, then squared-root-damped so one verbose column
    does not squeeze every other one down to a letter per line.
    """
    columns = len(rows[0])
    longest = [max(len(plain(r[i])) for r in rows) for i in range(columns)]
    weights = [max(3.0, value) ** 0.62 for value in longest]
    scale = total / sum(weights)
    return [w * scale for w in weights]


def table_of(rows: list[list[str]]) -> LongTable:
    head, body = rows[0], rows[1:]
    dense = len(head) > 5
    cell = S["cell"] if not dense else ParagraphStyle("dense", parent=S["cell"], fontSize=7, leading=9)
    header = S["cellhead"] if not dense else ParagraphStyle("densehead", parent=S["cellhead"], fontSize=7, leading=9)

    data = [[Paragraph(inline(c), header) for c in head]]
    data += [[Paragraph(inline(c), cell) for c in row] for row in body]

    table = LongTable(data, colWidths=widths_for(rows, BODY_W), repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(TEAL_DARK)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDE3E3")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    # Banding, so a wide row is still readable straight across.
    for index in range(1, len(data)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), colors.HexColor("#F6F9F8")))
    table.setStyle(TableStyle(style))
    return table


# --------------------------------------------------------------------------- #
# the document                                                                #
# --------------------------------------------------------------------------- #

def parse(markdown: str) -> list:
    story: list = []
    lines = markdown.split("\n")
    index = 0
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            story.append(Paragraph(inline(" ".join(paragraph)), S["body"]))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if not stripped:
            flush()
            index += 1
            continue

        if stripped.startswith("```"):
            flush()
            index += 1
            block = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                block.append(lines[index])
                index += 1
            index += 1
            story.append(Preformatted(plain("\n".join(block)), S["code"]))
            continue

        if stripped.startswith("|"):
            flush()
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                cells = [c.strip() for c in lines[index].strip().strip("|").split("|")]
                # The ---|---|--- alignment row carries no content.
                if not all(set(c) <= set("-: ") and c for c in cells):
                    rows.append(cells)
                index += 1
            if rows:
                width = max(len(r) for r in rows)
                rows = [r + [""] * (width - len(r)) for r in rows]
                story.append(Spacer(1, 3))
                story.append(table_of(rows))
                story.append(Spacer(1, 8))
            continue

        if stripped.startswith("#"):
            flush()
            level = len(stripped) - len(stripped.lstrip("#"))
            text = stripped[level:].strip()
            # A numbered part or an appendix opens a page; everything below it
            # flows, because a two-line subsection on its own sheet reads worse
            # than one that sits under the section it belongs to.
            top_level = level <= 2 and re.match(r"^(\d+\.|Appendix)", text)
            if level == 1 or top_level:
                story.append(PageBreak())
                story.append(Paragraph(inline(text), S["h1"]))
                story.append(HRFlowable(width="100%", thickness=1.1, color=colors.HexColor(TEAL), spaceAfter=8))
            else:
                story.append(Paragraph(inline(text), S[f"h{min(level, 3)}"]))
            index += 1
            continue

        if stripped.startswith(">"):
            flush()
            block = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                block.append(lines[index].strip().lstrip(">").strip())
                index += 1
            story.append(Paragraph(inline(" ".join(block)), S["quote"]))
            continue

        if set(stripped) <= {"-"} and len(stripped) >= 3:
            flush()
            story.append(Spacer(1, 2))
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#DDE3E3")))
            story.append(Spacer(1, 4))
            index += 1
            continue

        item = re.match(r"^[-*]\s+(.*)$", stripped) or re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if item:
            flush()
            ordered = stripped[0].isdigit()
            text = item.group(2) if ordered else item.group(1)
            # A wrapped bullet continues on the following indented lines.
            index += 1
            while (
                index < len(lines)
                and lines[index].strip()
                and lines[index].startswith(("  ", "\t"))
                and not re.match(r"^\s*([-*]|\d+\.)\s", lines[index])
                and not lines[index].strip().startswith("|")
            ):
                text += " " + lines[index].strip()
                index += 1
            marker = f"{item.group(1)}." if ordered else "•"
            story.append(Paragraph(inline(text), S["bullet"], bulletText=marker))
            continue

        paragraph.append(stripped)
        index += 1

    flush()
    return story


def cover() -> list:
    story: list = [Spacer(1, 42 * mm)]
    mark = logo_path()
    if mark:
        story.append(Image(mark, width=34 * mm, height=34 * mm, hAlign="LEFT"))
        story.append(Spacer(1, 14 * mm))
    story += [
        Paragraph(TITLE, S["coverTitle"]),
        Paragraph(SUBTITLE, S["coverSub"]),
        Spacer(1, 8 * mm),
        HRFlowable(width="45%", thickness=2, color=colors.HexColor(TEAL), hAlign="LEFT"),
        Spacer(1, 8 * mm),
        Paragraph(
            f"AI &amp; Data Academy &middot; {dt.date.today().strftime('%d %B %Y')}",
            S["coverSub"],
        ),
        Paragraph(
            '<font size="9">Generated from <font face="Courier">docs/FEATURES.md</font>, '
            "which stays the source of truth.</font>",
            S["coverSub"],
        ),
    ]
    return story


def decorate(canvas, doc) -> None:
    """Running head and page number. The cover carries neither."""
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#DDE3E3"))
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, PAGE_H - MARGIN + 6 * mm, PAGE_W - MARGIN, PAGE_H - MARGIN + 6 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor(MUTED))
    canvas.drawString(MARGIN, PAGE_H - MARGIN + 8 * mm, TITLE)
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 8 * mm, str(doc.page - 1))
    canvas.restoreState()


def build(source: str, target: str) -> None:
    doc = BaseDocTemplate(
        target,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=TITLE,
        author="AIDA — AI & Data Academy",
        subject=SUBTITLE,
    )
    frame = Frame(MARGIN, MARGIN, BODY_W, PAGE_H - 2 * MARGIN, id="body")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=decorate)])

    with open(source, encoding="utf-8") as handle:
        markdown = handle.read()

    # The document's own H1 becomes the cover, so it is not repeated inside.
    body = parse(markdown)
    while body and isinstance(body[0], PageBreak):
        body.pop(0)
    if body and isinstance(body[0], Paragraph) and body[0].style.name == "h1":
        body.pop(0)
        if body and isinstance(body[0], HRFlowable):
            body.pop(0)

    doc.build(cover() + [PageBreak()] + body)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
