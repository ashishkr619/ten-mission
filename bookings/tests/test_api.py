"""Tests for the JSON API: status codes, the error shape, and input checking."""
import json
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from bookings import services, utils
from bookings.models import Booking, Member
from bookings.tests.factories import UNKNOWN_REFERENCE, make_item, make_member


class ApiTestCase(TestCase):
    def post(self, path, body, headers=None):
        """POST a body as JSON. A string is sent as it is, to test broken JSON."""
        if isinstance(body, str):
            data = body
        else:
            data = json.dumps(body)
        return self.client.post(path, data=data, content_type="application/json", headers=headers or {})

    def book(self, member_id, item_id, key=None, path="/api/book"):
        headers = {"Idempotency-Key": key} if key else None
        return self.post(path, {"member_id": member_id, "item_id": item_id}, headers)

    def cancel(self, member_id, reference, path="/api/cancel"):
        return self.post(path, {"member_id": member_id, "reference": reference})

    def assertError(self, response, status, code):
        self.assertEqual(response.status_code, status, response.content)
        self.assertEqual(response.json()["error"]["code"], code)


class BookApiTests(ApiTestCase):
    def test_book_returns_201_and_a_reference(self):
        """A new booking answers 201 with its reference."""
        member, item = make_member(), make_item(title="Rome")

        response = self.book(member.id, item.id)

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["status"], "active")
        self.assertEqual(body["item_title"], "Rome")
        self.assertTrue(Booking.objects.filter(reference=body["reference"]).exists())

    def test_the_brief_paths_work_too(self):
        """POST /book and POST /cancel work, as written in the brief."""
        member, item = make_member(), make_item()

        booked = self.book(member.id, item.id, path="/book")
        cancelled = self.cancel(member.id, booked.json()["reference"], path="/cancel")

        self.assertEqual((booked.status_code, cancelled.status_code), (201, 200))

    def test_repeating_a_request_with_the_same_key_returns_200_and_the_same_booking(self):
        """A repeat with the same key answers 200 with the first booking."""
        member, item = make_member(), make_item()

        first = self.book(member.id, item.id, key="k1")
        again = self.book(member.id, item.id, key="k1")

        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.json()["reference"], again.json()["reference"])
        self.assertEqual(Booking.objects.count(), 1)

    def test_key_reused_for_a_different_item_is_409(self):
        """Reusing a key for a different item answers 409."""
        member, item, other_item = make_member(), make_item(), make_item()
        self.book(member.id, item.id, key="k")

        response = self.book(member.id, other_item.id, key="k")

        self.assertError(response, 409, "idempotency_key_conflict")

    def test_refusals_map_to_404_and_409(self):
        """Each refusal from the rules has its documented status and code."""
        member, sold_out = make_member(), make_item(stock=0)
        expired = make_item(days=-1)
        over_limit = make_member(count=3)

        self.assertError(self.book(999999, sold_out.id), 404, "member_not_found")
        self.assertError(self.book(member.id, 999999), 404, "item_not_found")
        self.assertError(self.book(member.id, sold_out.id), 409, "sold_out")
        self.assertError(self.book(member.id, expired.id), 409, "item_expired")
        self.assertError(self.book(over_limit.id, make_item().id), 409, "booking_limit_reached")

    def test_bad_input_gives_422_naming_every_wrong_field(self):
        """Invalid input answers 422 and names every wrong field at once."""
        response = self.post("/api/book", {"member_id": "x", "item_id": True})
        self.assertError(response, 422, "invalid_request")
        self.assertEqual(set(response.json()["error"]["fields"]), {"member_id", "item_id"})

        # Missing, zero, and absurdly large ids are all refused.
        for body in ({}, {"member_id": 0, "item_id": 1}, {"member_id": 10**30, "item_id": 1}):
            self.assertError(self.post("/api/book", body), 422, "invalid_request")

        # An over-long key is reported like any other wrong field.
        response = self.book(1, 1, key="k" * 256)
        self.assertError(response, 422, "invalid_request")
        self.assertIn("Idempotency-Key", response.json()["error"]["fields"])

    def test_broken_json_gives_400(self):
        """A body that is not a JSON object answers 400."""
        for body in ("{not json", "[1, 2]", ""):
            self.assertError(self.post("/api/book", body), 400, "invalid_json")

    def test_every_refusal_from_the_rules_has_an_http_answer(self):
        """Every error class in services.py has an HTTP answer, so none becomes a 500."""
        for error_class in services.BookingError.__subclasses__():
            self.assertIn(error_class, utils.SERVICE_ERRORS)

    def test_wrong_method_gives_405(self):
        """The wrong method answers 405 in the JSON error shape, with the Allow header."""
        response = self.client.get("/api/book")
        self.assertError(response, 405, "method_not_allowed")
        self.assertEqual(response["Allow"], "POST")
        response = self.post("/api/inventory", {})
        self.assertError(response, 405, "method_not_allowed")
        self.assertEqual(response["Allow"], "GET")

    def test_unknown_address_gives_json_404(self):
        """An address that doesn't exist answers in the JSON error shape, not an HTML page."""
        self.assertError(self.client.get("/api/nope"), 404, "not_found")
        self.assertError(self.client.post("/nope"), 404, "not_found")

    def test_a_crash_gives_json_500(self):
        """An unexpected error answers 500 in the JSON error shape, without details."""
        self.client.raise_request_exception = False  # behave like a real server: return the 500, don't re-raise
        member, item = make_member(), make_item()
        with patch("bookings.services.book", side_effect=RuntimeError("boom")):  # force a crash inside the view
            response = self.book(member.id, item.id)
        self.assertError(response, 500, "server_error")
        self.assertNotIn("boom", response.content.decode())


class CancelApiTests(ApiTestCase):
    def setUp(self):
        self.member, self.item = make_member(), make_item(stock=1)
        self.reference = self.book(self.member.id, self.item.id).json()["reference"]

    def test_cancel_returns_the_cancelled_booking_and_gives_the_place_back(self):
        """Cancelling answers 200 with the cancelled booking and returns the place."""
        response = self.cancel(self.member.id, self.reference)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "cancelled")
        self.item.refresh_from_db()
        self.assertEqual(self.item.remaining_count, 1)

    def test_cancelling_again_is_200_and_gives_nothing_more_back(self):
        """Cancelling again answers 200 and returns nothing more."""
        self.cancel(self.member.id, self.reference)

        again = self.cancel(self.member.id, self.reference)

        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()["status"], "cancelled")
        self.item.refresh_from_db()
        self.assertEqual(self.item.remaining_count, 1)  # not 2

    def test_wrong_member_or_unknown_reference_is_404(self):
        """Someone else's booking, or an unknown reference, answers 404."""
        other_member = make_member()

        self.assertError(self.cancel(other_member.id, self.reference), 404, "booking_not_found")
        self.assertError(self.cancel(self.member.id, UNKNOWN_REFERENCE), 404, "booking_not_found")

    def test_bad_reference_is_422(self):
        """A reference that is not a UUID answers 422."""
        for bad_reference in ("nope", 123, None):
            response = self.cancel(self.member.id, bad_reference)
            self.assertError(response, 422, "invalid_request")
            self.assertIn("reference", response.json()["error"]["fields"])


class ReadApiTests(ApiTestCase):
    def test_members_are_sorted_and_show_bookings_left(self):
        """Members come sorted by name, with bookings left never below zero."""
        make_member("Zed", "Adams", count=1)
        make_member("Amy", "Adams", count=3)  # already above the limit

        body = self.client.get("/api/members").json()

        self.assertEqual(body["max_bookings"], 2)
        self.assertEqual([member["first_name"] for member in body["members"]], ["Amy", "Zed"])
        self.assertEqual([member["bookings_left"] for member in body["members"]], [0, 1])  # never negative
        self.assertEqual(
            set(body["members"][0]),
            {"id", "first_name", "last_name", "date_joined", "active_booking_count", "bookings_left"},
        )

    def test_inventory_flags(self):
        """Each item says whether it can be booked and whether it has expired."""
        make_item("Open", stock=2)
        make_item("Empty", stock=0)
        make_item("Old", stock=5, days=-1)

        items = {item["title"]: item for item in self.client.get("/api/inventory").json()["items"]}

        self.assertEqual((items["Open"]["is_available"], items["Open"]["is_expired"]), (True, False))
        self.assertEqual(items["Empty"]["is_available"], False)
        self.assertEqual((items["Old"]["is_available"], items["Old"]["is_expired"]), (False, True))

    def test_members_come_in_pages_with_a_total(self):
        """Members come one page at a time, with the total."""
        for number in range(5):
            make_member(first=f"M{number}", last="Same")

        first = self.client.get("/api/members?limit=2").json()
        second = self.client.get("/api/members?limit=2&offset=2").json()
        last = self.client.get("/api/members?limit=2&offset=4").json()

        self.assertEqual((first["total"], first["limit"], first["offset"]), (5, 2, 0))
        names = [member["first_name"] for page in (first, second, last) for member in page["members"]]
        self.assertEqual(names, ["M0", "M1", "M2", "M3", "M4"])
        self.assertEqual(len(last["members"]), 1)

    def test_a_list_without_a_limit_returns_the_first_50(self):
        """Without ?limit= a list returns 50 rows."""
        Member.objects.bulk_create([
            Member(first_name=f"M{number:03}", last_name="Same", date_joined=timezone.now())
            for number in range(55)
        ])

        body = self.client.get("/api/members").json()

        self.assertEqual((len(body["members"]), body["total"], body["limit"]), (50, 55, 50))

    def test_member_search_needs_every_word_in_the_first_or_last_name(self):
        """Every search word must match the first or the last name."""
        make_member(first="Emily", last="Johnson")
        make_member(first="Emily", last="Davis")
        make_member(first="Sophie", last="Johnson")

        def matches(text):
            return self.client.get("/api/members", {"q": text}).json()["total"]

        self.assertEqual(matches("emily"), 2)
        self.assertEqual(matches("emily john"), 1)
        self.assertEqual(matches("johnson emily"), 1)  # the order of the words does not matter
        self.assertEqual(matches("nobody"), 0)

    def test_inventory_is_ordered_filtered_searched_and_counted(self):
        """The inventory is sorted by status, can be filtered and searched, and counts the whole inventory."""
        make_item(title="B open", stock=3)
        make_item(title="A open", stock=1)
        make_item(title="C full", stock=0)
        make_item(title="D old", stock=2, days=-1)
        make_item(title="E old and full", stock=0, days=-1)

        def titles(query=None):
            body = self.client.get("/api/inventory", query or {}).json()
            return [item["title"] for item in body["items"]]

        # Open first, then fully booked, then expired (expired wins even when the item is also full).
        self.assertEqual(titles(), ["A open", "B open", "C full", "D old", "E old and full"])
        self.assertEqual(titles({"status": "open"}), ["A open", "B open"])
        self.assertEqual(titles({"status": "sold_out"}), ["C full"])
        self.assertEqual(titles({"status": "expired"}), ["D old", "E old and full"])
        self.assertEqual(titles({"q": "OLD"}), ["D old", "E old and full"])  # search ignores case

        searched = self.client.get("/api/inventory", {"q": "OLD"}).json()
        self.assertEqual(searched["total"], 2)
        # The counts always describe the whole inventory, whatever the search.
        self.assertEqual(
            searched["counts"], {"all": 5, "open": 2, "sold_out": 1, "expired": 2, "places_left": 4},
        )

    def test_inventory_comes_in_pages(self):
        """Items come one page at a time, and a page past the end is empty."""
        for number in range(5):
            make_item(title=f"T{number}")

        page = self.client.get("/api/inventory?limit=2&offset=3").json()
        beyond = self.client.get("/api/inventory?offset=50").json()

        self.assertEqual([item["title"] for item in page["items"]], ["T3", "T4"])
        self.assertEqual((page["total"], page["limit"], page["offset"]), (5, 2, 3))
        self.assertEqual((beyond["items"], beyond["total"]), ([], 5))

    def test_bad_list_parameters_are_422_and_name_the_field(self):
        """Wrong list parameters answer 422 and name the parameter."""
        cases = [
            ("/api/members?limit=0", "limit"),
            ("/api/members?limit=201", "limit"),
            ("/api/members?limit=abc", "limit"),
            ("/api/members?offset=-1", "offset"),
            ("/api/members?offset=99999999999999999999", "offset"),
            ("/api/inventory?status=nope", "status"),
            ("/api/inventory?q=" + "x" * 101, "q"),
        ]
        for path, field in cases:
            with self.subTest(path[:45]):
                response = self.client.get(path)
                self.assertError(response, 422, "invalid_request")
                self.assertIn(field, response.json()["error"]["fields"])

    def test_one_member_and_one_item_by_id(self):
        """One member and one item can be fetched by id."""
        member = make_member(first="Emily", last="Johnson", count=1)
        item = make_item(title="Rome", stock=3)

        member_body = self.client.get(f"/api/members/{member.id}").json()
        item_body = self.client.get(f"/api/inventory/{item.id}").json()

        self.assertEqual((member_body["first_name"], member_body["bookings_left"]), ("Emily", 1))
        self.assertEqual(
            (item_body["title"], item_body["remaining_count"], item_body["is_available"]), ("Rome", 3, True),
        )

    def test_unknown_or_too_large_ids_are_404(self):
        """Unknown ids, and ids too large for the database, answer 404."""
        too_large = 10**30  # bigger than the database can hold
        for member_id in (999999, too_large):
            self.assertError(self.client.get(f"/api/members/{member_id}"), 404, "member_not_found")
            self.assertError(self.client.get(f"/api/members/{member_id}/bookings"), 404, "member_not_found")
        for item_id in (999999, too_large):
            self.assertError(self.client.get(f"/api/inventory/{item_id}"), 404, "item_not_found")

    def test_member_bookings_lists_only_active_ones_newest_first(self):
        """A member's bookings list shows only their active bookings, newest first."""
        member, other_member, item = make_member(), make_member(), make_item(stock=5)
        first = self.book(member.id, item.id).json()
        second = self.book(member.id, item.id).json()
        self.cancel(member.id, first["reference"])
        self.book(other_member.id, item.id)

        bookings = self.client.get(f"/api/members/{member.id}/bookings").json()["bookings"]

        # The cancelled booking and the other member's booking are not listed.
        self.assertEqual([booking["reference"] for booking in bookings], [second["reference"]])
        self.assertEqual(bookings[0]["status"], "active")
