from django.urls import include, path

urlpatterns = [path("", include("bookings.urls"))]

# Django looks for these names in the root URL file. They make an unknown address, a bad request
# or a crash answer in the same JSON error shape as the API, instead of an HTML page.
handler400 = "bookings.utils.bad_request"
handler404 = "bookings.utils.not_found"
handler500 = "bookings.utils.server_error"
