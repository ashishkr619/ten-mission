"""Read and check the two CSV files.

Nothing here touches the database. Each parse function returns unsaved model
objects and a list of error messages, so the caller can report every problem at
once and write nothing if there is any.

Two kinds of problem are handled differently:
  * The whole file is unusable (missing, not UTF-8, a column missing):
    a ValueError is raised.
  * One row is wrong: the problem goes into the error list and the other rows
    are still checked.

The only change ever made to the data is removing spaces around values.
Everything else is checked, never repaired.
"""
import csv
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .models import InventoryItem, Member

MEMBER_COLUMNS = ("name", "surname", "booking_count", "date_joined")
INVENTORY_COLUMNS = ("title", "description", "remaining_count", "expiration_date")


# --- Reading the file and single values ------------------------------------

def _read_rows(path, required_columns):
    """All rows as (row_number, row). The header is row 1, so data starts at row 2.

    Raises ValueError if the whole file is unusable.
    """
    path = Path(path)
    try:
        # utf-8-sig drops the hidden BOM at the start; newline="" lets a quoted cell span lines.
        with path.open(newline="", encoding="utf-8-sig") as file:
            reader = csv.DictReader(file)
            columns = reader.fieldnames or []
            missing = [column for column in required_columns if column not in columns]
            if missing:
                raise ValueError(f"{path.name}: missing column(s): {', '.join(missing)}")
            return list(enumerate(reader, start=2))
    except OSError as error:
        raise ValueError(f"{path}: cannot read file ({error.strerror})")
    except (UnicodeDecodeError, csv.Error):
        raise ValueError(f"{path.name}: not a valid UTF-8 CSV file")


def _cell(row, column):
    """The cell's text without surrounding spaces, or None if the row is too short to have it."""
    value = row.get(column)
    if value is None:
        return None
    return value.strip()


def _parse_count(text):
    """A whole number of 0 or more, or None.

    Only the digits 0-9 are accepted: int() would also accept "+3", " 3" or "٣".
    """
    if text is None or not (text.isascii() and text.isdigit()):
        return None
    return int(text)


def _parse_date_joined(text):
    """An ISO datetime such as 2024-01-02T12:10:11, or None. No time zone means UTC."""
    try:
        parsed = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _parse_expiration_date(text):
    """A date written exactly as DD/MM/YYYY, or None."""
    try:
        parsed = datetime.strptime(text, "%d/%m/%Y")
    except (TypeError, ValueError):
        return None
    if parsed.strftime("%d/%m/%Y") != text:  # strptime also accepts "1/2/2030"; the file must say "01/02/2030"
        return None
    return parsed.date()


# --- One function per file -------------------------------------------------

def parse_members(path):
    """Return (members, errors) for members.csv. Nothing is saved."""
    rows = _read_rows(path, MEMBER_COLUMNS)
    file_name = Path(path).name
    members, errors = [], []

    for row_number, row in rows:
        problems = []

        first_name = _cell(row, "name")
        last_name = _cell(row, "surname")
        if not first_name:
            problems.append("name is empty")
        if not last_name:
            problems.append("surname is empty")

        booking_count = _parse_count(_cell(row, "booking_count"))
        if booking_count is None:
            problems.append(
                "booking_count must be a whole number of 0 or more, "
                f"got {row.get('booking_count')!r}"
            )

        date_joined = _parse_date_joined(_cell(row, "date_joined"))
        if date_joined is None:
            problems.append(
                "date_joined must be an ISO datetime like 2024-01-02T12:10:11, "
                f"got {row.get('date_joined')!r}"
            )

        if problems:
            errors.extend(f"{file_name} row {row_number}: {problem}" for problem in problems)
            continue

        members.append(Member(
            first_name=first_name,
            last_name=last_name,
            active_booking_count=booking_count,
            date_joined=date_joined,
        ))

    return members, errors


def parse_inventory(path):
    """Return (items, errors) for inventory.csv. Nothing is saved."""
    rows = _read_rows(path, INVENTORY_COLUMNS)
    file_name = Path(path).name
    items, errors = [], []

    for row_number, row in rows:
        problems = []

        title = _cell(row, "title")
        if not title:
            problems.append("title is empty")

        remaining_count = _parse_count(_cell(row, "remaining_count"))
        if remaining_count is None:
            problems.append(
                "remaining_count must be a whole number of 0 or more, "
                f"got {row.get('remaining_count')!r}"
            )

        expiration_date = _parse_expiration_date(_cell(row, "expiration_date"))
        if expiration_date is None:
            problems.append(
                f"expiration_date must be DD/MM/YYYY, got {row.get('expiration_date')!r}"
            )

        if problems:
            errors.extend(f"{file_name} row {row_number}: {problem}" for problem in problems)
            continue

        items.append(InventoryItem(
            title=title,
            description=_cell(row, "description") or "",  # optional
            remaining_count=remaining_count,
            expiration_date=expiration_date,
        ))

    return items, errors


# --- Notes about the data --------------------------------------------------

def summarize_warnings(members, items, max_bookings, today):
    """Short notes about data that looks odd but is allowed. They never stop the import."""
    notes = []

    name_counts = Counter(f"{member.first_name} {member.last_name}" for member in members)
    repeated_names = [name for name, count in name_counts.items() if count > 1]
    if repeated_names:
        notes.append(
            f"{len(repeated_names)} member name(s) appear more than once: {', '.join(repeated_names)}"
        )

    title_counts = Counter(item.title for item in items)
    repeated_titles = [title for title, count in title_counts.items() if count > 1]
    if repeated_titles:
        notes.append(
            f"{len(repeated_titles)} inventory title(s) appear more than once: {', '.join(repeated_titles)}"
        )

    over_limit = sum(1 for member in members if member.active_booking_count > max_bookings)
    if over_limit:
        notes.append(f"{over_limit} member(s) already have more than {max_bookings} bookings")

    expired = sum(1 for item in items if item.expiration_date < today)
    if expired:
        notes.append(f"{expired} inventory item(s) are expired")

    out_of_stock = sum(1 for item in items if item.remaining_count == 0)
    if out_of_stock:
        notes.append(f"{out_of_stock} inventory item(s) have no remaining stock")

    return notes
