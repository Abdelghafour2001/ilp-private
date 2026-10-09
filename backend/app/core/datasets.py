"""Parsing uploads and answering questions about them.

Two jobs. Turning a spreadsheet into typed columns and rows, and turning a
{group by these, measure those, filtered like this} request into an answer.

The typing pass is the part worth care. A person reads "1 200", "1,200" and
"1200" as the same number; a database reads three strings, and a column that
lands as text silently refuses to sum — the user sees a total of zero and no
error. So the type is decided once, at upload, by looking at the whole column
rather than at the first cell, and a column only becomes a number if
essentially all of it parses as one.
"""

import csv
import datetime as dt
import io
import logging
import re
from collections import defaultdict
from typing import Any, Iterable

log = logging.getLogger(__name__)

MAX_ROWS = 50_000
MAX_COLUMNS = 60

AGGREGATIONS = ("sum", "avg", "count", "min", "max", "count_distinct")
OPERATORS = ("eq", "ne", "contains", "gt", "gte", "lt", "lte", "in", "not_in", "between")

# Thousands separators people actually type, plus the decimal comma the French
# locale produces. Currency symbols and stray spaces come off too.
_STRIP = re.compile(r"[\s  '’]|(?:MAD|EUR|USD|€|\$)", re.I)
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%Y/%m/%d",
    "%d.%m.%Y",
    "%Y-%m-%dT%H:%M:%S",
)


def to_number(value: Any) -> float | None:
    """A number if the cell plausibly holds one, else None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = _STRIP.sub("", str(value)).strip()
    if not text:
        return None
    # "1,5" is one and a half in French, "1,500" is fifteen hundred in English.
    # A single comma with one or two trailing digits is a decimal mark; a comma
    # with exactly three is a thousands separator. Anything else is not a number
    # we are willing to guess at.
    if text.count(",") == 1 and text.count(".") == 0:
        whole, _, frac = text.partition(",")
        text = f"{whole}.{frac}" if len(frac) in (1, 2) else f"{whole}{frac}"
    else:
        text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def to_date(value: Any) -> str | None:
    """An ISO date string, or None. Stored as text so JSONB stays sortable."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(text[:19], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def infer_type(values: Iterable[Any]) -> str:
    """The type of a column, decided from the whole column.

    A column is a number only if essentially every non-blank cell parses as one.
    Judging from the first row is how "Matricule" becomes a number because the
    first employee happens to be MGM-0001 — and then averages get taken of it.
    """
    seen = numeric = dated = 0
    for value in values:
        if value is None or str(value).strip() == "":
            continue
        seen += 1
        if to_number(value) is not None:
            numeric += 1
        if to_date(value) is not None:
            dated += 1
    if seen == 0:
        return "text"
    # 95%: a stray "n/a" in an otherwise numeric column should not demote it.
    if numeric / seen >= 0.95:
        return "number"
    if dated / seen >= 0.95:
        return "date"
    return "text"


def _clean_header(raw: Any, index: int, used: set[str]) -> str:
    name = str(raw or "").strip() or f"Colonne {index + 1}"
    # Duplicate headers are common in exported spreadsheets and would silently
    # overwrite each other in a dict-shaped row.
    base, suffix = name, 2
    while name in used:
        name = f"{base} ({suffix})"
        suffix += 1
    used.add(name)
    return name


def parse_upload(filename: str, blob: bytes) -> tuple[list[dict], list[dict]]:
    """(columns, rows) from a CSV or XLSX upload."""
    if filename.lower().endswith((".xlsx", ".xlsm")):
        table = _read_xlsx(blob)
    else:
        table = _read_csv(blob)
    if not table:
        raise ValueError("Le fichier est vide.")

    header, *body = table
    used: set[str] = set()
    names = [_clean_header(h, i, used) for i, h in enumerate(header[:MAX_COLUMNS])]
    if not names:
        raise ValueError("Aucune colonne détectée.")

    body = body[:MAX_ROWS]
    by_column: dict[str, list] = defaultdict(list)
    for line in body:
        for i, name in enumerate(names):
            by_column[name].append(line[i] if i < len(line) else None)

    columns = [{"name": n, "type": infer_type(by_column[n])} for n in names]
    types = {c["name"]: c["type"] for c in columns}

    rows: list[dict] = []
    for line in body:
        row: dict[str, Any] = {}
        blank = True
        for i, name in enumerate(names):
            raw = line[i] if i < len(line) else None
            if types[name] == "number":
                row[name] = to_number(raw)
            elif types[name] == "date":
                row[name] = to_date(raw)
            else:
                text = "" if raw is None else str(raw).strip()
                row[name] = text or None
            if row[name] not in (None, ""):
                blank = False
        # Trailing blank lines are an artefact of every spreadsheet export and
        # would otherwise show up as real rows with null everything.
        if not blank:
            rows.append(row)
    return columns, rows


def _read_csv(blob: bytes) -> list[list]:
    # Excel on a French Windows writes cp1252 and semicolons; the same file
    # saved from a Mac is UTF-8 with commas. Both arrive here.
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = blob.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("Encodage de fichier non reconnu.")

    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return [row for row in csv.reader(io.StringIO(text), dialect)]


def _read_xlsx(blob: bytes) -> list[list]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
    sheet = workbook.active
    return [list(row) for row in sheet.iter_rows(values_only=True, max_row=MAX_ROWS + 1)]


# --------------------------------------------------------------------------- #
# querying                                                                     #
# --------------------------------------------------------------------------- #


def _matches(row: dict, clause: dict) -> bool:
    column, op = clause.get("column"), clause.get("op", "eq")
    target = clause.get("value")
    actual = row.get(column)

    if op == "in":
        return actual in (target or [])
    if op == "not_in":
        return actual not in (target or [])
    if op == "contains":
        return str(target or "").lower() in str(actual or "").lower()
    if op == "between":
        low, high = (target or [None, None])[:2]
        if actual is None:
            return False
        return (low is None or actual >= low) and (high is None or actual <= high)

    # A null never satisfies an ordering comparison. Treating it as zero is how
    # "hours < 5" quietly picks up everyone with no data at all.
    if actual is None:
        return op == "ne"
    if op == "eq":
        return actual == target
    if op == "ne":
        return actual != target
    try:
        if op == "gt":
            return actual > target
        if op == "gte":
            return actual >= target
        if op == "lt":
            return actual < target
        if op == "lte":
            return actual <= target
    except TypeError:
        return False
    return True


def aggregate(
    rows: list[dict],
    dimensions: list[str],
    measures: list[dict],
    filters: list[dict] | None = None,
    sort: dict | None = None,
    limit: int = 200,
) -> dict:
    """Group, measure, sort. Returns rows plus the totals across all of them.

    Grand totals are computed over the filtered set, not by summing the returned
    page — otherwise a `limit` silently changes the total, which is the classic
    way a dashboard and an export end up disagreeing.
    """
    for clause in filters or []:
        rows = [r for r in rows if _matches(r, clause)]

    def bucket(row: dict) -> tuple:
        return tuple(row.get(d) for d in dimensions)

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        groups[bucket(row)].append(row)

    def measure(name: str, agg: str, members: list[dict]):
        if agg == "count":
            return len(members)
        values = [r.get(name) for r in members]
        if agg == "count_distinct":
            return len({v for v in values if v is not None})
        numbers = [v for v in values if isinstance(v, (int, float))]
        if not numbers:
            return None
        if agg == "sum":
            return round(sum(numbers), 2)
        if agg == "avg":
            return round(sum(numbers) / len(numbers), 2)
        if agg == "min":
            return min(numbers)
        if agg == "max":
            return max(numbers)
        return None

    out = []
    for key, members in groups.items():
        record = {d: key[i] for i, d in enumerate(dimensions)}
        for spec in measures:
            record[spec["label"]] = measure(spec["column"], spec["agg"], members)
        record["_rows"] = len(members)
        out.append(record)

    sort = sort or {}
    sort_key = sort.get("by") or (measures[0]["label"] if measures else None)
    if sort_key:
        descending = sort.get("dir", "desc") == "desc"
        # None sorts last either way: an empty measure is not "the smallest".
        out.sort(
            key=lambda r: (r.get(sort_key) is None, r.get(sort_key) if r.get(sort_key) is not None else 0),
            reverse=descending,
        )
        if descending:
            out.sort(key=lambda r: r.get(sort_key) is None)

    totals = {
        spec["label"]: measure(spec["column"], spec["agg"], rows) for spec in measures
    }
    totals["_rows"] = len(rows)

    return {
        "rows": out[: max(1, min(limit, 1000))],
        "group_count": len(out),
        "truncated": len(out) > limit,
        "totals": totals,
    }
