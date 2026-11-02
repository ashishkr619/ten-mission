"""Small helpers that create test data. Shared by every test file."""
from datetime import timedelta

from django.utils import timezone

from bookings.models import InventoryItem, Member

# A well-formed booking reference that no booking has.
UNKNOWN_REFERENCE = "00000000-0000-0000-0000-000000000000"


def make_member(first="Test", last="Member", count=0):
    """A member holding `count` active bookings."""
    return Member.objects.create(
        first_name=first, last_name=last, date_joined=timezone.now(), active_booking_count=count,
    )


def make_item(title="Trip", stock=2, days=30):
    """An item with `stock` places, expiring `days` from today (negative = already expired)."""
    return InventoryItem.objects.create(
        title=title, description="A test experience.", remaining_count=stock,
        expiration_date=timezone.localdate() + timedelta(days=days),
    )
