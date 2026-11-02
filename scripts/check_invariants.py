"""Checks that the database stayed consistent during a load test.

    python scripts/check_invariants.py snapshot    before the test: remember every member's count and every item's stock
    python scripts/check_invariants.py             after the test: compare, and exit with an error if anything is off

Each active booking row must account for exactly one place: a member's count is the count they
started with plus their active bookings, and an item's stock is the stock it started with minus
its active bookings. Stock is never negative, and nobody ends above the limit unless they
started above it (the real data has members who already hold 3 bookings).
Run it with the same DB_* environment variables as the app.
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.conf import settings
from django.db import connection

SNAPSHOT = Path("/tmp/invariants_before.json")


def read_state():
    with connection.cursor() as cursor:
        cursor.execute("SELECT id, active_booking_count FROM bookings_member")
        members = dict(cursor.fetchall())
        cursor.execute("SELECT id, remaining_count FROM bookings_inventoryitem")
        items = dict(cursor.fetchall())
        cursor.execute(
            "SELECT member_id, inventory_item_id, count(*) FROM bookings_booking "
            "WHERE cancelled_at IS NULL GROUP BY member_id, inventory_item_id"
        )
        active_by_member, active_by_item = Counter(), Counter()
        for member_id, item_id, count in cursor.fetchall():
            active_by_member[member_id] += count
            active_by_item[item_id] += count
    return members, items, active_by_member, active_by_item


def snapshot():
    members, items, _, _ = read_state()
    SNAPSHOT.write_text(json.dumps({"members": members, "items": items}))


def verify():
    before = json.loads(SNAPSHOT.read_text())
    members, items, active_by_member, active_by_item = read_state()
    problems = []

    for member_id, started in before["members"].items():
        member_id = int(member_id)
        expected = started + active_by_member[member_id]
        if members.get(member_id) != expected:
            problems.append(f"member {member_id}: count is {members.get(member_id)}, should be {expected}")
        if members.get(member_id, 0) > max(started, settings.MAX_BOOKINGS):
            problems.append(f"member {member_id}: holds {members[member_id]} bookings, above the limit")

    for item_id, started in before["items"].items():
        item_id = int(item_id)
        expected = started - active_by_item[item_id]
        if items.get(item_id) != expected:
            problems.append(f"item {item_id}: stock is {items.get(item_id)}, should be {expected}")
        if items.get(item_id, 0) < 0:
            problems.append(f"item {item_id}: negative stock")

    if problems:
        print(f"DATABASE CHECK FAILED: {len(problems)} problem(s), for example:")
        for problem in problems[:5]:
            print("  -", problem)
        sys.exit(1)
    print(f"Database check passed: {len(members):,} members and {len(items):,} items all add up.")


if __name__ == "__main__":
    if sys.argv[1:] == ["snapshot"]:
        snapshot()
    else:
        verify()
