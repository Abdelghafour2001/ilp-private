"""One branded shell for every email the platform sends.

Before this, each of the seven send sites hand-wrote its own `<p>` tags, which
is why the mail looked like a debug dump: no logo, no hierarchy, no call to
action, and a different idea of "a paragraph" in each one.

Email is not the web. The rules that shape everything below:

* Layout is tables. Flexbox, grid and even `max-width` on a `div` are
  unreliable across Outlook, and Outlook renders with Word's engine.
* Styles are inline. Most clients strip `<style>` blocks, and Gmail strips the
  whole `<head>`.
* The logo travels with the message as an inline attachment (a `cid:`
  reference), not as a URL. A hosted image is blocked by default in most
  clients and breaks entirely once the app is behind a VPN.
* Everything degrades: the plain-text alternative is built from the same
  blocks, so it says the same thing rather than being an afterthought.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape

from app.core.branding import INK, MUTED, PAPER, TEAL, TEAL_DARK
from app.core.config import settings

# The content id the mailer attaches the mark under.
LOGO_CID = "aida-logo"

# 600px is the width every client agrees on; above it Outlook starts clipping.
WIDTH = 600

FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,"
    "'Helvetica Neue',Arial,sans-serif"
)

BORDER = "#E6E4DD"
SURFACE = "#FFFFFF"


@dataclass(frozen=True)
class Button:
    label: str
    url: str


# --------------------------------------------------------------------------- #
# blocks                                                                      #
# --------------------------------------------------------------------------- #
# A block is a small tuple so call sites stay declarative and the plain-text
# version can be generated from the same input instead of being written twice.
#
#   ("p",     "some prose")
#   ("h",     "a subheading")
#   ("list",  ["one", "two"])
#   ("stats", [("Label", "Value"), ...])
#   ("code",  "JOIN-CODE")
#   ("note",  "small print")

Block = tuple


def _p(text: str) -> str:
    return (
        f'<p style="margin:0 0 14px;font:400 15px/1.6 {FONT};color:{INK};">'
        f"{text}</p>"
    )


def _h(text: str) -> str:
    return (
        f'<p style="margin:22px 0 10px;font:600 13px/1.4 {FONT};color:{MUTED};'
        f'letter-spacing:.08em;text-transform:uppercase;">{text}</p>'
    )


def _list(items: list[str]) -> str:
    rows = "".join(
        f'<tr><td width="18" valign="top" '
        f'style="font:400 15px/1.6 {FONT};color:{TEAL};">&bull;</td>'
        f'<td style="font:400 15px/1.6 {FONT};color:{INK};padding-bottom:6px;">'
        f"{item}</td></tr>"
        for item in items
    )
    return f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px;">{rows}</table>'


def _stats(pairs: list[tuple[str, str]]) -> str:
    """A label/value strip — the numbers people open the mail to see."""
    cells = "".join(
        f'<td align="center" style="padding:12px 8px;">'
        f'<div style="font:700 22px/1.2 {FONT};color:{TEAL_DARK};">{value}</div>'
        f'<div style="font:600 11px/1.4 {FONT};color:{MUTED};'
        f'letter-spacing:.06em;text-transform:uppercase;padding-top:4px;">{label}</div>'
        f"</td>"
        for label, value in pairs
    )
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="margin:4px 0 18px;background:{PAPER};border:1px solid {BORDER};'
        f'border-radius:8px;"><tr>{cells}</tr></table>'
    )


def _code(value: str) -> str:
    """A join code or reference — the one thing the reader may retype by hand."""
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:2px 0 18px;"><tr><td '
        f'style="background:{PAPER};border:1px solid {BORDER};border-radius:8px;'
        f'padding:12px 20px;font:700 24px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;'
        f'color:{INK};letter-spacing:.14em;">{value}</td></tr></table>'
    )


def _note(text: str) -> str:
    return (
        f'<p style="margin:0 0 12px;font:400 13px/1.6 {FONT};color:{MUTED};">'
        f"{text}</p>"
    )


def _render_blocks(blocks: list[Block]) -> str:
    out = []
    for kind, value in blocks:
        if kind == "p":
            out.append(_p(value))
        elif kind == "h":
            out.append(_h(value))
        elif kind == "list":
            out.append(_list(value))
        elif kind == "stats":
            out.append(_stats(value))
        elif kind == "code":
            out.append(_code(value))
        elif kind == "note":
            out.append(_note(value))
        else:  # pragma: no cover - a typo in a call site should be visible
            out.append(_p(escape(str(value))))
    return "".join(out)


def _blocks_to_text(blocks: list[Block]) -> str:
    lines: list[str] = []
    for kind, value in blocks:
        if kind in ("p", "note"):
            lines.append(_strip_tags(value))
        elif kind == "h":
            lines.append("")
            lines.append(_strip_tags(value).upper())
        elif kind == "list":
            lines += [f"  - {_strip_tags(v)}" for v in value]
        elif kind == "code":
            lines.append(f"  {value}")
        elif kind == "stats":
            lines += [f"  {_strip_tags(label)}: {_strip_tags(value)}" for label, value in value]
        lines.append("")
    return "\n".join(lines).strip()


def _strip_tags(html: str) -> str:
    """Good enough for our own markup: we only ever emit <b>, <a> and <br>."""
    import re

    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"<a [^>]*href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", r"\2 (\1)", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("&bull;", "-").replace("&nbsp;", " ").strip()


# --------------------------------------------------------------------------- #
# the shell                                                                   #
# --------------------------------------------------------------------------- #

def render_email(
    *,
    heading: str,
    blocks: list[Block],
    preheader: str = "",
    button: Button | None = None,
    footer_note: str = "",
    eyebrow: str = "",
) -> tuple[str, str]:
    """Return (html, text) for one message.

    `preheader` is the grey line clients show next to the subject in the inbox
    list. Left unset it shows whatever the first words of the body happen to
    be, which for a logo-first layout is usually nothing useful.
    """
    brand = settings.app_name
    eyebrow = eyebrow or brand
    cta = ""
    if button:
        cta = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:8px 0 6px;"><tr>'
            f'<td align="center" bgcolor="{TEAL_DARK}" style="border-radius:6px;">'
            f'<a href="{button.url}" '
            f'style="display:inline-block;padding:11px 22px;font:600 15px/1 {FONT};'
            f'color:#FFFFFF;text-decoration:none;border-radius:6px;">{button.label}</a>'
            f"</td></tr></table>"
        )

    footer = (
        f'<p style="margin:0;font:400 12px/1.6 {FONT};color:{MUTED};">{footer_note}</p>'
        if footer_note
        else ""
    )

    # The hidden preheader span: clients read it, nobody sees it. The trailing
    # non-breaking spaces stop Gmail from pulling body text in after it.
    hidden = (
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        f"{preheader}{'&nbsp;&zwnj;' * 40}</div>"
        if preheader
        else ""
    )

    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:{PAPER};">
{hidden}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:{PAPER};">
  <tr><td align="center" style="padding:28px 12px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="{WIDTH}"
           style="width:{WIDTH}px;max-width:100%;background:{SURFACE};border:1px solid {BORDER};border-radius:10px;overflow:hidden;">

      <!-- the brand rule: one 4px band, the only heavy colour in the message -->
      <tr><td style="height:4px;background:{TEAL};font-size:0;line-height:0;">&nbsp;</td></tr>

      <tr><td style="padding:24px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="34" valign="middle">
              <img src="cid:{LOGO_CID}" width="30" height="30" alt=""
                   style="display:block;border:0;width:30px;height:30px;">
            </td>
            <td valign="middle" style="padding-left:10px;font:700 14px/1.2 {FONT};
                color:{TEAL_DARK};letter-spacing:.1em;text-transform:uppercase;">{eyebrow}</td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:18px 32px 4px;">
        <h1 style="margin:0 0 14px;font:600 22px/1.3 {FONT};color:{INK};">{heading}</h1>
        {_render_blocks(blocks)}
        {cta}
      </td></tr>

      <tr><td style="padding:18px 32px 26px;">
        <div style="border-top:1px solid {BORDER};padding-top:14px;">{footer}</div>
      </td></tr>
    </table>

    <p style="margin:14px 0 0;font:400 11px/1.5 {FONT};color:{MUTED};">
      {brand}
    </p>

  </td></tr>
</table>
</body></html>"""

    text_parts = [heading, "", _blocks_to_text(blocks)]
    if button:
        text_parts += ["", f"{button.label}: {button.url}"]
    if footer_note:
        text_parts += ["", _strip_tags(footer_note)]
    return html, "\n".join(text_parts).strip()
