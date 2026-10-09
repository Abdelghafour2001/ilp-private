"""When a certificate lapses, given the catalogue's validity period."""

import calendar
import datetime as dt


def expiry_from_validity(obtained_on: dt.date | None, months: int | None) -> dt.date | None:
    """`obtained_on` plus `months`, clamped to the end of a shorter month.

    Returns None when either side is unknown: a renewable certification with no
    date is better left blank than given an expiry the holder never had.
    """
    if not obtained_on or not months:
        return None
    year = obtained_on.year + (obtained_on.month - 1 + months) // 12
    month = (obtained_on.month - 1 + months) % 12 + 1
    day = min(obtained_on.day, calendar.monthrange(year, month)[1])
    return dt.date(year, month, day)
