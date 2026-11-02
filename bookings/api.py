"""The JSON API views. Each view checks the request, calls the booking rules or
the database, and returns JSON. The helpers they share are in utils.py.
"""
from django.conf import settings
from django.db.models import Case, Count, IntegerField, Q, Sum, When
from django.db.models.functions import Coalesce
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from . import services
from .models import Booking, InventoryItem, Member
from .utils import (
    allow_methods, booking_json, error_response, invalid_input_response, is_valid_id, item_json, member_json,
    parse_reference, read_json_body, read_list_params, service_error_response,
)

STATUSES = ("open", "sold_out", "expired")


# --- POST /api/book --------------------------------------------------------
# csrf_exempt: CSRF attacks ride on browser cookies, which this API does not use; remove it with a login.

@csrf_exempt
@allow_methods("POST")
def book_view(request):
    try:
        data = read_json_body(request)
    except ValueError as error:
        return error_response("invalid_json", str(error), 400)

    member_id = data.get("member_id")
    item_id = data.get("item_id")
    idempotency_key = request.headers.get("Idempotency-Key", "").strip()

    problems = {}
    if not is_valid_id(member_id):
        problems["member_id"] = "Required. Must be a positive whole number."
    if not is_valid_id(item_id):
        problems["item_id"] = "Required. Must be a positive whole number."
    if len(idempotency_key) > 255:
        problems["Idempotency-Key"] = "Must be 255 characters or fewer."
    if problems:
        return invalid_input_response(problems)

    try:
        result = services.book(member_id, item_id, idempotency_key or None)
    except services.BookingError as error:
        return service_error_response(error)

    # 201 for a new booking, 200 when an earlier booking with the same key is returned.
    status = 201 if result.created else 200
    return JsonResponse(booking_json(result.booking), status=status)


# --- POST /api/cancel ------------------------------------------------------

@csrf_exempt  # see book_view
@allow_methods("POST")
def cancel_view(request):
    try:
        data = read_json_body(request)
    except ValueError as error:
        return error_response("invalid_json", str(error), 400)

    member_id = data.get("member_id")
    reference = parse_reference(data.get("reference"))

    problems = {}
    if not is_valid_id(member_id):
        problems["member_id"] = "Required. Must be a positive whole number."
    if reference is None:
        problems["reference"] = "Required. Must be a valid booking reference."
    if problems:
        return invalid_input_response(problems)

    try:
        booking = services.cancel(member_id, reference)
    except services.BookingError as error:
        return service_error_response(error)

    # Safe to repeat: cancelling an already cancelled booking also returns 200.
    return JsonResponse(booking_json(booking))


# --- GET endpoints for the pages ------------------------------------------

@allow_methods("GET")
def members_view(request):
    """One page of members, ordered by name. ?q= searches first and last names."""
    limit, offset, search, problems = read_list_params(request)
    if problems:
        return invalid_input_response(problems)

    members = Member.objects.order_by("last_name", "first_name", "id")
    for word in search.split():  # every word must appear in the first or the last name
        members = members.filter(
            Q(first_name__icontains=word) | Q(last_name__icontains=word))

    return JsonResponse({
        "max_bookings": settings.MAX_BOOKINGS,
        "total": members.count(),
        "limit": limit,
        "offset": offset,
        "members": [member_json(member) for member in members[offset:offset + limit]],
    })


@allow_methods("GET")
def member_view(request, member_id):
    member = None
    if is_valid_id(member_id):
        member = Member.objects.filter(pk=member_id).first()
    if member is None:
        return service_error_response(services.MemberNotFound())
    return JsonResponse(member_json(member))


@allow_methods("GET")
def inventory_view(request):
    """One page of items: open ones first, then fully booked, then expired.

    ?status= (open, sold_out or expired) and ?q= (title search) narrow the list.
    "counts" always describes the whole inventory, for the page header and the filters.
    """
    limit, offset, search, problems = read_list_params(request)
    status = request.GET.get("status")
    if status is not None and status not in STATUSES:
        problems["status"] = f"Must be one of: {', '.join(STATUSES)}."
    if problems:
        return invalid_input_response(problems)

    today = timezone.localdate()
    # Each state is written once as a reusable WHERE condition (Q), used below to filter, count and sort.
    can_book = Q(remaining_count__gt=0, expiration_date__gte=today)
    fully_booked = Q(remaining_count=0, expiration_date__gte=today)
    expired = Q(expiration_date__lt=today)  # expired wins over fully booked
    status_filters = {"open": can_book,
                      "sold_out": fully_booked, "expired": expired}

    # SQL if/else per row, so the database sorts before paging: open 0, fully booked 1, expired 2.
    rank = Case(
        When(expired, then=2),
        When(remaining_count=0, then=1),
        default=0,
        output_field=IntegerField(),
    )
    items = InventoryItem.objects.order_by(
        rank, "title", "expiration_date", "id")
    if status:
        items = items.filter(status_filters[status])
    if search:
        # case-insensitive "title contains"
        items = items.filter(title__icontains=search)

    # One query for the totals of the whole inventory; filter= counts only the rows that match.
    counts = InventoryItem.objects.aggregate(
        all=Count("id"),
        open=Count("id", filter=can_book),
        sold_out=Count("id", filter=fully_booked),
        expired=Count("id", filter=expired),
        # SUM of no rows is NULL, so 0
        places_left=Coalesce(Sum("remaining_count", filter=can_book), 0),
    )
    return JsonResponse({
        "total": items.count(),  # matching items on all pages
        "limit": limit,
        "offset": offset,
        "counts": counts,
        # slicing becomes LIMIT/OFFSET
        "items": [item_json(item, today) for item in items[offset:offset + limit]],
    })


@allow_methods("GET")
def item_view(request, item_id):
    item = None
    if is_valid_id(item_id):
        item = InventoryItem.objects.filter(pk=item_id).first()
    if item is None:
        return service_error_response(services.ItemNotFound())
    return JsonResponse(item_json(item, timezone.localdate()))


@allow_methods("GET")
def member_bookings_view(request, member_id):
    """A member's active bookings, newest first. These are the ones that can be cancelled."""
    member_exists = is_valid_id(
        member_id) and Member.objects.filter(pk=member_id).exists()
    if not member_exists:
        return service_error_response(services.MemberNotFound())

    bookings = (
        Booking.objects.filter(member_id=member_id, cancelled_at__isnull=True)
        .select_related("inventory_item")
        .order_by("-booked_at", "-id")
    )
    return JsonResponse({"bookings": [booking_json(booking) for booking in bookings]})
