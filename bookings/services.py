"""The booking rules. The only code that changes stock, member counts or bookings.

How double booking is prevented:
  * Taking a place is a conditional UPDATE: the member's count goes up only if it
    is below the limit, and the item's stock goes down only if it is above zero.
    The database checks the condition at the moment it writes, and makes a second
    request for the same row wait for the first. So two requests can never both
    take the last place.
  * All the writes of one booking are in one transaction: all of them happen, or none.
  * Booking and cancelling both update the member before the item, so they can
    never wait on each other in a circle (a deadlock).
"""
from dataclasses import dataclass

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .models import Booking, InventoryItem, Member

# Name of the database rule "one booking per (member, idempotency key)", from models.py.
IDEMPOTENCY_CONSTRAINT = "unique_member_idempotency_key"


# --- Errors ----------------------------------------------------------------
# Each is one way the rules can say no; api.py turns each into an HTTP error.

class BookingError(Exception):
    """Base class for every expected refusal."""


class MemberNotFound(BookingError):
    """No member with that id."""


class ItemNotFound(BookingError):
    """No inventory item with that id."""


class BookingNotFound(BookingError):
    """No such booking for this member."""


class ItemExpired(BookingError):
    """The item is past its expiration date."""


class BookingLimitReached(BookingError):
    """The member already holds MAX_BOOKINGS active bookings."""


class SoldOut(BookingError):
    """The item has no places left."""


class IdempotencyKeyConflict(BookingError):
    """The member already used this key to book a different item."""


@dataclass(frozen=True)
class BookResult:
    booking: Booking
    created: bool  # True for a new booking, False when an earlier one is returned


# --- Book ------------------------------------------------------------------

def book(member_id, item_id, idempotency_key=None):
    """Book one place on an item for a member. Returns a BookResult.

    A repeat of the same request (same member, same idempotency key) returns
    the first booking instead of booking again.

    When several things are wrong at once, the error is always the first of:
    item not found, item expired, member not found, booking limit, sold out.
    """
    # 1. A repeat of a request we already handled? Return that booking.
    previous = _find_previous_booking(member_id, item_id, idempotency_key)
    if previous is not None:
        return BookResult(previous, created=False)

    # 2. Make a new booking.
    try:
        booking = _create_booking(member_id, item_id, idempotency_key)
    except (BookingLimitReached, SoldOut, IntegrityError) as error:
        # 3. It failed. If an identical request won the race, this one is a repeat: return that booking.
        if isinstance(error, IntegrityError) and not _is_same_key_twice(error):
            raise  # some other database problem
        previous = _find_previous_booking(member_id, item_id, idempotency_key)
        if previous is None:
            raise  # no winner: the refusal is real
        return BookResult(previous, created=False)

    return BookResult(booking, created=True)


def _find_previous_booking(member_id, item_id, idempotency_key):
    """The booking this member already made with this key, or None.

    Raises IdempotencyKeyConflict if that key was used for a different item.
    """
    if idempotency_key is None:
        return None

    previous = (
        Booking.objects.select_related("inventory_item")
        .filter(member_id=member_id, idempotency_key=idempotency_key)
        .first()
    )
    if previous is not None and previous.inventory_item_id != item_id:
        raise IdempotencyKeyConflict()
    return previous


def _create_booking(member_id, item_id, idempotency_key):
    """Check the item, take one place from the member and one from the item, and save the booking."""
    item = InventoryItem.objects.filter(pk=item_id).first()
    if item is None:
        raise ItemNotFound()
    if item.expiration_date < timezone.localdate():  # the last day is still bookable
        raise ItemExpired()

    # One transaction: if any step below raises, every write in it is undone.
    with transaction.atomic():
        # Member count +1, only if below the limit; F() lets the database check and add in one step.
        members_updated = Member.objects.filter(
            pk=member_id, active_booking_count__lt=settings.MAX_BOOKINGS,
        ).update(active_booking_count=F("active_booking_count") + 1)

        if members_updated == 0:
            if Member.objects.filter(pk=member_id).exists():
                raise BookingLimitReached()
            raise MemberNotFound()

        # Item stock -1, only if places are left.
        items_updated = InventoryItem.objects.filter(
            pk=item_id, remaining_count__gt=0,
        ).update(remaining_count=F("remaining_count") - 1)

        if items_updated == 0:
            raise SoldOut()  # this also undoes the member's +1 above

        return Booking.objects.create(
            member_id=member_id, inventory_item=item, idempotency_key=idempotency_key,
        )


def _is_same_key_twice(error):
    """True if the database refused the booking because this member already used this key."""
    return error.__cause__.diag.constraint_name == IDEMPOTENCY_CONSTRAINT


# --- Cancel ----------------------------------------------------------------

def cancel(member_id, reference):
    """Cancel a member's booking and give the place back. Returns the Booking.

    Safe to repeat: cancelling an already cancelled booking changes nothing and
    returns it as it is. A booking that belongs to another member is "not found".
    """
    this_booking = Booking.objects.filter(
        reference=reference, member_id=member_id)

    with transaction.atomic():
        # Mark it cancelled, only if still active: of several cancels at once, exactly one changes the row.
        bookings_cancelled = this_booking.filter(cancelled_at__isnull=True).update(
            cancelled_at=timezone.now(),
        )

        # Only that one gives the place back: member first, then item, as in book().
        if bookings_cancelled == 1:
            booking = this_booking.select_related("inventory_item").get()
            Member.objects.filter(pk=member_id).update(
                active_booking_count=F("active_booking_count") - 1,
            )
            InventoryItem.objects.filter(pk=booking.inventory_item_id).update(
                remaining_count=F("remaining_count") + 1,
            )
            return booking

    # Nothing changed: it was already cancelled, or this member has no such booking.
    booking = this_booking.select_related("inventory_item").first()
    if booking is None:
        raise BookingNotFound()
    return booking
