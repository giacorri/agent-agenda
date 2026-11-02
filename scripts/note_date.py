#!/usr/bin/env python3
"""Detect and strip a date written at the start of a note body.

The agenda already shows each note's timestamp, so "2/11: merged the fix" repeats it.
Shared by add-note.sh / edit-note.sh (refuse) and strip-note-dates.sh (clean up).

    note_date.py check "<body>"   exit 2 with a message if the body starts with a date
"""
import re
import sys
from datetime import date

_LEAD = r"[\s*_(\[]*"
# One optional time-of-day word after the date ("31/10 sera,", "2/11 morning:").
_WORD = r"(?:\s+[^\W\d_]+)?"
_SEP = r"\s*[:,;—–-]"
_CLOSE = r"[*_)\]]*"

# A full date (with year) is unambiguous: any separator, or none, may follow.
_FULL = re.compile(
    _LEAD
    + r"(?:(?P<iy>\d{4})-(?P<im>\d{1,2})-(?P<id>\d{1,2})"
    + r"|(?P<d>\d{1,2})/(?P<m>\d{1,2})/(?P<y>\d{4}|\d{2})"
    + r"|(?P<d2>\d{1,2})-(?P<m2>\d{1,2})-(?P<y2>\d{4}))"
    + r"(?![\d/-])" + _CLOSE + r"(?:" + _WORD + _SEP + r")?\s*"
)
# A short day/month needs a separator after it, so "2/3 of the tests pass" stays legal.
_SHORT = re.compile(
    _LEAD + r"(?P<d>\d{1,2})/(?P<m>\d{1,2})(?![\d/])" + _CLOSE + _WORD + _SEP + r"\s*"
)


def date_prefix(body: str):
    """Return (match, day, month, year|None) when body starts with a plausible date."""
    for rx in (_FULL, _SHORT):
        m = rx.match(body)
        if not m:
            continue
        g = m.groupdict()
        if g.get("iy"):
            y, mo, d = int(g["iy"]), int(g["im"]), int(g["id"])
        else:
            d, mo = int(g["d"] or g["d2"]), int(g["m"] or g["m2"])
            y = g.get("y") or g.get("y2")
            y = (2000 + int(y) if len(y) == 2 else int(y)) if y else None
        if 1 <= d <= 31 and 1 <= mo <= 12:
            return m, d, mo, y
    return None


def resolve(day: int, month: int, year, ref: date) -> date:
    """The date a prefix names; without a year, the latest one not after ref."""
    if year:
        return date(year, month, day)
    y = ref.year if (month, day) <= (ref.month, ref.day) else ref.year - 1
    return date(y, month, day)


def strip(body: str) -> str:
    hit = date_prefix(body)
    if not hit:
        return body
    rest = body[hit[0].end():]
    # Capitalise a plain word only: "repo.x#70" or "`tool`" keep their spelling.
    first = re.match(r"\S*", rest).group(0)
    return rest[:1].upper() + rest[1:] if first.isalpha() else rest


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "check":
        print(__doc__.strip().splitlines()[-1].strip(), file=sys.stderr)
        sys.exit(64)
    hit = date_prefix(sys.argv[2])
    if hit:
        print(f'note refused: it starts with a date ("{hit[0].group(0).strip()}").', file=sys.stderr)
        print("The agenda already shows each note's date: drop it from the text;", file=sys.stderr)
        print("for something that happened on another day, pass --at YYYY-MM-DD.", file=sys.stderr)
        sys.exit(2)
