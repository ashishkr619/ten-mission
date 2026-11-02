"""Helpers for the API views: reading and checking requests, and building JSON responses.

Every error response has the same shape:
    {"error": {"code": "sold_out", "message": "...", "fields": {...}}}
`fields` appears only when the input was invalid (422) and says which field is wrong.
"""
import json
import uuid

from django.conf import settings
from django.http import JsonResponse

from . import services

LARGEST_ID = 2**63 - 1  # the largest number a Postgres bigint id can hold

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_OFFSET = 10**9
MAX_SEARCH_LENGTH = 100

# How each refusal from services.py is answered: (code, message, HTTP status).
SERVICE_ERRORS = {
    services.ItemNotFound: ("item_not_found", "Inventory item not found.", 404),
    services.MemberNotFound: ("member_not_found", "Member not found.", 404),
    services.BookingNotFound: ("booking_not_found", "Booking not found.", 404),
    services.ItemExpired: ("item_expired", "This item has expired.", 409),
    services.BookingLimitReached: (
        "booking_limit_reached", f"A member can hold at most {settings.MAX_BOOKINGS} bookings.", 409,
    ),
    services.SoldOut: ("sold_out", "This item is sold out.", 409),
    services.IdempotencyKeyConflict: (
        "idempotency_key_conflict", "This Idempotency-Key was already used for a different item.", 409,
    ),
}


# --- Error responses -------------------------------------------------------

def error_response(code, message, status, fields=None):
    body = {"error": {"code": code, "message": message}}
    if fields:
        body["error"]["fields"] = fields
    return JsonResponse(body, status=status)


def service_error_response(error):
    """The response for a refusal raised by services.py."""
    code, message, status = SERVICE_ERRORS[type(error)]
    return error_response(code, message, status)


def invalid_input_response(problems):
    """422 listing every field or parameter that is wrong, so the client can fix them all at once."""
    return error_response("invalid_request", "Some input is invalid.", 422, problems)


# --- Reading and checking requests -----------------------------------------

def read_json_body(request):
    """The request body as a dict. Raises ValueError if it is not a JSON object."""
    try:
        data = json.loads(request.body)
    except ValueError:
        raise ValueError("Body must be valid JSON.")
    if not isinstance(data, dict):
        raise ValueError("Body must be a JSON object.")
    return data


def is_valid_id(value):
    """True for a whole number from 1 to LARGEST_ID.

    True and False count as numbers in Python, so they are ruled out explicitly.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return False
    return 1 <= value <= LARGEST_ID


def parse_reference(value):
    """The booking reference as a UUID, or None if it is not a valid one."""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):  # bad text, or not text at all
        return None


def is_whole_number(text, smallest, largest):
    """True if the text is a plain whole number from smallest to largest.

    The length check comes first, so a huge input is never turned into a number.
    """
    if len(text) > 12 or not (text.isascii() and text.isdigit()):
        return False
    return smallest <= int(text) <= largest


def read_list_params(request):
    """The ?limit=, ?offset= and ?q= of a list request, and a dict of any problems with them."""
    limit, offset, problems = DEFAULT_LIMIT, 0, {}

    limit_text = request.GET.get("limit")
    if limit_text is not None:
        if is_whole_number(limit_text, 1, MAX_LIMIT):
            limit = int(limit_text)
        else:
            problems["limit"] = f"Must be a whole number from 1 to {MAX_LIMIT}."

    offset_text = request.GET.get("offset")
    if offset_text is not None:
        if is_whole_number(offset_text, 0, MAX_OFFSET):
            offset = int(offset_text)
        else:
            problems["offset"] = f"Must be a whole number from 0 to {MAX_OFFSET}."

    search = request.GET.get("q", "").strip()
    if len(search) > MAX_SEARCH_LENGTH:
        problems["q"] = f"Must be {MAX_SEARCH_LENGTH} characters or fewer."

    return limit, offset, search, problems


# --- JSON shapes -----------------------------------------------------------

def booking_json(booking):
    return {
        "reference": str(booking.reference),
        "member_id": booking.member_id,
        "item_id": booking.inventory_item_id,
        "item_title": booking.inventory_item.title,
        "booked_at": booking.booked_at.isoformat(),
        "cancelled_at": booking.cancelled_at.isoformat() if booking.cancelled_at else None,
        "status": "active" if booking.is_active else "cancelled",
    }


def member_json(member):
    return {
        "id": member.id,
        "first_name": member.first_name,
        "last_name": member.last_name,
        "date_joined": member.date_joined.isoformat(),  # tells duplicate names apart
        "active_booking_count": member.active_booking_count,
        "bookings_left": max(0, settings.MAX_BOOKINGS - member.active_booking_count),
    }


def item_json(item, today):
    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "remaining_count": item.remaining_count,
        "expiration_date": item.expiration_date.isoformat(),
        "is_expired": item.expiration_date < today,
        "is_available": item.remaining_count > 0 and item.expiration_date >= today,
    }
