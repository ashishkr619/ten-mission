from django.urls import path

from . import api

urlpatterns = [
    path("api/members", api.members_view),
    path("api/members/<int:member_id>", api.member_view),
    path("api/members/<int:member_id>/bookings", api.member_bookings_view),
    path("api/inventory", api.inventory_view),
    path("api/inventory/<int:item_id>", api.item_view),
    path("api/book", api.book_view),
    path("api/cancel", api.cancel_view),
    # The same two endpoints at the paths written in the brief.
    path("book", api.book_view),
    path("cancel", api.cancel_view),
]
