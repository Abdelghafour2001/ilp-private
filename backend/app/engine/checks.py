"""The catalogue of data-check kinds a lab step can require.

This used to compile each kind into SQL and run it against a connected
database. Both halves of that are gone: the practice database went when the SQL
graders were retired, and the data-quality workbench that ran checks against
customer databases was removed as a separate product.

What survives is the catalogue itself, and it is still load-bearing. A lab step
may declare `require_kind`, the loader validates that name against this map, and
the lab editor renders the list for the author to pick from. So this is now a
vocabulary, not an engine — which is why there are no builders and nothing here
touches a connection.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CheckKind:
    name: str
    label: str
    description: str
    requires_column: bool
    # Param descriptors, for the lab editor to render and validate against.
    params: dict = field(default_factory=dict)


CHECK_KINDS: dict[str, CheckKind] = {
    "not_null": CheckKind("not_null", "Not null", "Column has no NULL values.", True),
    "unique": CheckKind("unique", "Unique", "Column values are unique.", True),
    "range": CheckKind(
        "range", "Range", "Numeric column falls within a range.", True,
        {"min": "number?", "max": "number?"},
    ),
    "regex": CheckKind(
        "regex", "Regex match", "Text column matches a pattern.", True,
        {"pattern": "string"},
    ),
    "accepted_values": CheckKind(
        "accepted_values", "Accepted values", "Column only contains allowed values.",
        True, {"values": "string[]"},
    ),
    "row_count": CheckKind(
        "row_count", "Row count", "Table row count is within bounds.", False,
        {"min": "number?", "max": "number?"},
    ),
    "freshness": CheckKind(
        "freshness", "Freshness", "Most recent timestamp is recent enough.", True,
        {"max_age_hours": "number"},
    ),
    "custom_sql": CheckKind(
        "custom_sql", "Custom SQL", "SQL returning a failing-row count.", False,
        {"sql": "string"},
    ),
}


def check_spec(kind: str) -> CheckKind:
    if kind not in CHECK_KINDS:
        raise ValueError(f"Unknown check kind: {kind!r}")
    return CHECK_KINDS[kind]


def list_check_kinds() -> list[dict]:
    return [
        {
            "name": k.name,
            "label": k.label,
            "description": k.description,
            "requires_column": k.requires_column,
            "params": k.params,
        }
        for k in CHECK_KINDS.values()
    ]
