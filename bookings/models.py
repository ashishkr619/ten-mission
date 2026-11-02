import uuid

from django.db import models
from django.db.models import F, Q


class Member(models.Model):
    """A customer from members.csv. Not a Django login user."""

    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    date_joined = models.DateTimeField()

    # Starts at the CSV booking_count; the limit is checked when booking, as some members start above it.
    active_booking_count = models.IntegerField(default=0)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(active_booking_count__gte=0),
                name="member_booking_count_non_negative",
            ),
        ]

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class InventoryItem(models.Model):
    """An experience that can be booked, with the number of places left.

    Titles are not unique: the CSV has two "London" items with different
    stock and expiry dates.
    """

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    remaining_count = models.IntegerField()
    expiration_date = models.DateField()  # bookable through this day

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(remaining_count__gte=0),
                name="inventory_count_non_negative",
            ),
        ]

    def __str__(self):
        return self.title


class Booking(models.Model):
    """One place on one item, held by one member. Each place is its own row, so a
    member who books the same item twice (allowed, up to the limit) has two rows.

    Cancelling does not delete the row: it fills in `cancelled_at`, so the
    history is kept. Booking again later creates a new row with a new reference.
    """

    # What clients see and send to /cancel. The primary key stays internal.
    reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    # Lets a client repeat a booking request safely (see services.book).
    idempotency_key = models.CharField(max_length=255, null=True, blank=True)

    # PROTECT: a member or item with bookings cannot be deleted by accident.
    member = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="bookings")
    inventory_item = models.ForeignKey(InventoryItem, on_delete=models.PROTECT, related_name="bookings")

    booked_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)  # empty while the booking is active

    class Meta:
        constraints = [
            # A member can use each idempotency key once. Rows without a key are not limited.
            models.UniqueConstraint(
                fields=["member", "idempotency_key"],
                condition=Q(idempotency_key__isnull=False),
                name="unique_member_idempotency_key",
            ),
            models.CheckConstraint(
                condition=Q(cancelled_at__isnull=True) | Q(cancelled_at__gte=F("booked_at")),
                name="booking_cancelled_after_booked",
            ),
        ]

    @property
    def is_active(self):
        return self.cancelled_at is None

    def __str__(self):
        return str(self.reference)
