"""Tests for the booking rules in services.py.

ServiceTests check each rule one step at a time.
ConcurrencyTests fire real parallel requests at a real Postgres to prove that
the "take one" updates really prevent double booking.
"""
import threading
from collections import Counter
from datetime import timedelta
from functools import partial
from unittest.mock import patch

from django.db import IntegrityError, connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from bookings.models import Booking, InventoryItem
from bookings.services import (
    BookingError, BookingLimitReached, BookingNotFound, IdempotencyKeyConflict,
    ItemExpired, ItemNotFound, MemberNotFound, SoldOut, book, cancel,
)
from bookings.tests.factories import UNKNOWN_REFERENCE, make_item, make_member


class ServiceTests(TestCase):
    def test_book_success_updates_counts_and_returns_reference(self):
        """A booking takes one place from the item and one slot from the member."""
        member, item = make_member(), make_item(stock=3)
        result = book(member.id, item.id)

        self.assertTrue(result.created)
        self.assertIsNotNone(result.booking.reference)
        self.assertIsNotNone(result.booking.booked_at)
        member.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual((member.active_booking_count, item.remaining_count), (1, 2))

    def test_unknown_member_or_item(self):
        """Booking for a member or item that does not exist is refused."""
        member, item = make_member(), make_item()
        with self.assertRaises(MemberNotFound):
            book(999999, item.id)
        with self.assertRaises(ItemNotFound):
            book(member.id, 999999)

    def test_expired_item_is_refused_but_last_day_is_allowed(self):
        """An item can be booked through its expiration date, not after."""
        member = make_member()
        with self.assertRaises(ItemExpired):
            book(member.id, make_item(days=-1).id)
        self.assertTrue(book(member.id, make_item(days=0).id).created)

    def test_sold_out_changes_nothing(self):
        """A sold-out refusal leaves the member's count untouched."""
        member, item = make_member(), make_item(stock=0)
        with self.assertRaises(SoldOut):
            book(member.id, item.id)
        member.refresh_from_db()
        self.assertEqual(member.active_booking_count, 0)  # nothing was taken from the member

    def test_when_several_things_are_wrong_the_error_is_always_the_same(self):
        """The error order is fixed: item not found, expired, member not found, limit, sold out."""
        expired, sold_out = make_item(days=-1), make_item(stock=0)
        at_limit = make_member(count=2)

        with self.assertRaises(ItemNotFound):
            book(999999, 999999)
        with self.assertRaises(ItemExpired):
            book(999999, expired.id)
        with self.assertRaises(MemberNotFound):
            book(999999, sold_out.id)
        with self.assertRaises(BookingLimitReached):
            book(at_limit.id, sold_out.id)

        member = make_member()
        with self.assertRaises(SoldOut):
            book(member.id, sold_out.id)
        member.refresh_from_db()
        self.assertEqual(member.active_booking_count, 0)  # nothing was taken from the member

    def test_an_unrelated_database_error_is_not_mistaken_for_a_repeat(self):
        """Only the (member, key) rule means a repeat; any other database error surfaces."""
        member, item = make_member(), make_item(stock=3)
        first = book(member.id, item.id, "a").booking
        reference_field = Booking._meta.get_field("reference")
        with patch.object(reference_field, "get_default", lambda: first.reference):
            with self.assertRaises(IntegrityError):
                book(member.id, item.id, "b")
        item.refresh_from_db()
        self.assertEqual(item.remaining_count, 2)  # the failed booking took nothing

    def test_limit_applies_to_members_loaded_from_csv_above_it(self):
        """Members at or above the limit, as in the CSV, cannot book."""
        item = make_item(stock=5)
        for count in (2, 3):  # exactly at the limit, and above it
            with self.assertRaises(BookingLimitReached):
                book(make_member(count=count).id, item.id)
        item.refresh_from_db()
        self.assertEqual(item.remaining_count, 5)

    def test_same_member_may_book_the_same_item_twice_up_to_the_limit(self):
        """Booking the same item twice is allowed; a third booking hits the limit."""
        member, item = make_member(), make_item(stock=5)
        book(member.id, item.id)
        book(member.id, item.id)
        with self.assertRaises(BookingLimitReached):
            book(member.id, item.id)

    def test_cancel_gives_the_place_back_and_booking_again_gets_a_new_reference(self):
        """Cancelling returns the place, and booking again makes a new booking."""
        member, item = make_member(), make_item(stock=1)
        first = book(member.id, item.id).booking

        cancelled = cancel(member.id, first.reference)

        self.assertIsNotNone(cancelled.cancelled_at)
        member.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual((member.active_booking_count, item.remaining_count), (0, 1))
        second = book(member.id, item.id).booking
        self.assertNotEqual(first.reference, second.reference)

    def test_cancel_of_someone_elses_or_unknown_booking_is_not_found(self):
        """A member cannot cancel another member's booking, or one that does not exist."""
        member, other_member, item = make_member(), make_member(), make_item(stock=2)
        booking = book(member.id, item.id).booking
        with self.assertRaises(BookingNotFound):  # belongs to another member
            cancel(other_member.id, booking.reference)
        with self.assertRaises(BookingNotFound):  # no such reference
            cancel(member.id, UNKNOWN_REFERENCE)

    def test_cancelling_twice_gives_the_place_back_only_once(self):
        """A second cancel changes nothing and is not an error."""
        member, item = make_member(), make_item(stock=3)
        booking = book(member.id, item.id).booking

        first = cancel(member.id, booking.reference)
        again = cancel(member.id, booking.reference)  # a repeat is not an error

        self.assertEqual(first.cancelled_at, again.cancelled_at)
        member.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual((member.active_booking_count, item.remaining_count), (0, 3))

    def test_same_idempotency_key_returns_the_first_booking(self):
        """Repeating a request with the same key returns the first booking."""
        member, item = make_member(), make_item(stock=3)
        first = book(member.id, item.id, "abc")
        again = book(member.id, item.id, "abc")

        self.assertTrue(first.created)
        self.assertFalse(again.created)
        self.assertEqual(first.booking.pk, again.booking.pk)
        member.refresh_from_db()
        self.assertEqual(member.active_booking_count, 1)  # counted once

    def test_reusing_a_key_for_a_different_item_is_refused(self):
        """A key already used for one item cannot book a different item."""
        member, item, other_item = make_member(), make_item(stock=3), make_item(stock=3)
        book(member.id, item.id, "abc")
        with self.assertRaises(IdempotencyKeyConflict):
            book(member.id, other_item.id, "abc")
        other_item.refresh_from_db()
        self.assertEqual(other_item.remaining_count, 3)  # nothing was taken

    def test_a_repeat_gets_the_first_booking_even_when_a_new_booking_would_be_refused(self):
        """A repeat still gets its booking after the item sells out, fills up or expires."""
        member, item = make_member(count=1), make_item(stock=1)
        first = book(member.id, item.id, "last-one")
        again = book(member.id, item.id, "last-one")
        self.assertFalse(again.created)
        self.assertEqual(first.booking.pk, again.booking.pk)

        # Same after the item has expired.
        yesterday = timezone.localdate() - timedelta(days=1)
        InventoryItem.objects.filter(pk=item.id).update(expiration_date=yesterday)
        expired = book(member.id, item.id, "last-one")
        self.assertFalse(expired.created)
        self.assertEqual(first.booking.pk, expired.booking.pk)

    def test_key_conflict_is_reported_even_if_the_other_item_is_sold_out(self):
        """A reused key is reported before the other item's stock is checked."""
        member, item = make_member(), make_item(stock=3)
        book(member.id, item.id, "k")
        sold_out = make_item(stock=0)
        with self.assertRaises(IdempotencyKeyConflict):
            book(member.id, sold_out.id, "k")

    def test_the_returned_booking_is_complete(self):
        """The booking returned by book and cancel matches what is saved."""
        member, item = make_member(), make_item(stock=1)
        booking = book(member.id, item.id, "k").booking
        saved = Booking.objects.get(pk=booking.pk)
        self.assertEqual(booking.reference, saved.reference)
        self.assertEqual(booking.booked_at, saved.booked_at)
        self.assertEqual(booking.member_id, member.id)
        self.assertEqual(booking.inventory_item_id, item.id)
        self.assertEqual(booking.inventory_item.title, item.title)
        self.assertTrue(booking.is_active)

        cancelled = cancel(member.id, booking.reference)
        self.assertFalse(cancelled.is_active)
        self.assertEqual(cancelled.pk, booking.pk)
        self.assertEqual(cancelled.inventory_item.title, item.title)

    def test_same_key_from_two_different_members_is_independent(self):
        """Keys belong to one member, so two members may use the same key."""
        item = make_item(stock=3)
        first_member, second_member = make_member(), make_member()
        self.assertTrue(book(first_member.id, item.id, "abc").created)
        self.assertTrue(book(second_member.id, item.id, "abc").created)


# --- Concurrency: real threads, real Postgres, all released together -------

def run_concurrently(calls, timeout=30):
    """Run each callable in its own thread. Returns [("ok", value) | ("err", exception)].

    All threads wait at a barrier and start at the same moment, so the
    requests really overlap instead of running one after another.
    """
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)

    def worker(index, call):
        try:
            connection.ensure_connection()  # connect first, so the barrier releases real queries
            barrier.wait()
            results[index] = ("ok", call())
        except Exception as error:  # every outcome is recorded, so the test can inspect it
            results[index] = ("err", error)
        finally:
            connection.close()  # each thread opened its own database connection

    threads = [threading.Thread(target=worker, args=(index, call)) for index, call in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout)
    if any(thread.is_alive() for thread in threads):
        raise AssertionError("A request never finished: possible deadlock")
    return results


def outcomes(results):
    """Count results by kind, e.g. Counter({"ok": 1, "SoldOut": 19})."""
    return Counter("ok" if kind == "ok" else type(value).__name__ for kind, value in results)


class ConcurrencyTests(TransactionTestCase):
    # TransactionTestCase, so the data is really committed and the other threads can see it.

    def test_last_place_goes_to_exactly_one_member(self):
        """Twenty members race for the last place: exactly one gets it."""
        item = make_item(stock=1)
        members = [make_member() for _ in range(20)]

        results = run_concurrently([partial(book, member.id, item.id) for member in members])

        self.assertEqual(outcomes(results), {"ok": 1, "SoldOut": 19})
        item.refresh_from_db()
        self.assertEqual(item.remaining_count, 0)
        self.assertEqual(Booking.objects.count(), 1)

    def test_stock_is_never_oversold(self):
        """Thirty members race for five places: exactly five get one."""
        item = make_item(stock=5)
        members = [make_member() for _ in range(30)]

        results = run_concurrently([partial(book, member.id, item.id) for member in members])

        self.assertEqual(outcomes(results), {"ok": 5, "SoldOut": 25})
        item.refresh_from_db()
        self.assertEqual(item.remaining_count, 0)

    def test_one_member_cannot_pass_the_limit_in_parallel(self):
        """One member books ten items at once: only two succeed."""
        member = make_member()
        items = [make_item(stock=5) for _ in range(10)]

        results = run_concurrently([partial(book, member.id, item.id) for item in items])

        self.assertEqual(outcomes(results), {"ok": 2, "BookingLimitReached": 8})
        member.refresh_from_db()
        self.assertEqual(member.active_booking_count, 2)

    def test_parallel_cancels_give_the_place_back_only_once(self):
        """Ten cancels of one booking at once return the place once."""
        member, item = make_member(), make_item(stock=3)
        booking = book(member.id, item.id).booking

        results = run_concurrently([partial(cancel, member.id, booking.reference)] * 10)

        self.assertEqual(outcomes(results), {"ok": 10})  # a repeat is never an error
        member.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual((member.active_booking_count, item.remaining_count), (0, 3))

    def test_retries_with_the_same_key_make_one_booking(self):
        """Ten identical requests at once make one booking, and all get it."""
        member, item = make_member(), make_item(stock=5)

        results = run_concurrently([partial(book, member.id, item.id, "same-key")] * 10)

        self.assertEqual(outcomes(results), {"ok": 10})  # nobody sees an error
        self.assertEqual(len({result.booking.reference for _, result in results}), 1)
        self.assertEqual(sum(result.created for _, result in results), 1)
        member.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(
            (member.active_booking_count, item.remaining_count, Booking.objects.count()),
            (1, 4, 1),
        )

    def test_identical_requests_that_lose_the_race_still_get_the_first_booking(self):
        """Identical requests that lose the race get the winner's booking, never an error."""
        # Each loser must be handed the winner's booking, never an error.
        scenarios = {
            "unique key": dict(member_count=0, stock=5),
            "member limit": dict(member_count=1, stock=5),
            "last place": dict(member_count=0, stock=1),
        }
        for name, setup in scenarios.items():
            with self.subTest(name):
                for round_number in range(5):  # races are timing-dependent, so repeat
                    member = make_member(count=setup["member_count"])
                    item = make_item(stock=setup["stock"])
                    key = f"{name}-{round_number}"

                    results = run_concurrently([partial(book, member.id, item.id, key)] * 10)

                    self.assertEqual(outcomes(results), {"ok": 10})
                    self.assertEqual(sum(result.created for _, result in results), 1)
                    self.assertEqual(Booking.objects.filter(member=member).count(), 1)
                    member.refresh_from_db()
                    item.refresh_from_db()
                    self.assertEqual(member.active_booking_count, setup["member_count"] + 1)
                    self.assertEqual(item.remaining_count, setup["stock"] - 1)

    def test_mixed_books_and_cancels_keep_every_number_consistent(self):
        """Books and cancels in parallel keep every count equal to the active bookings."""
        items = [make_item(stock=3) for _ in range(3)]
        members = [make_member() for _ in range(12)]

        def job(number):
            """Book; on every second job, cancel straight afterwards."""
            member, item = members[number % 12], items[number % 3]
            try:
                result = book(member.id, item.id)
            except BookingError:
                return  # sold out or at the limit: expected in this stress test
            if number % 2 == 0:
                cancel(member.id, result.booking.reference)

        results = run_concurrently([partial(job, number) for number in range(36)])
        self.assertEqual(outcomes(results), {"ok": 36})  # no crash, no deadlock

        # Nothing was created or lost: stock + active bookings = starting stock.
        for item in items:
            item.refresh_from_db()
            active = item.bookings.filter(cancelled_at__isnull=True).count()
            self.assertEqual(item.remaining_count + active, 3)
        # Each member's counter matches their real active bookings.
        for member in members:
            member.refresh_from_db()
            active = member.bookings.filter(cancelled_at__isnull=True).count()
            self.assertEqual(member.active_booking_count, active)
            self.assertLessEqual(active, 2)
