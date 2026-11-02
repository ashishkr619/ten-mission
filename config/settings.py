# Every setting below has a default for local use and
# can be changed with an environment variable.

import os
from pathlib import Path

from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent


# Nothing is signed or stored between restarts, so a random key is safe locally; set one in production.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or get_random_secret_key()
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = os.environ.get(
    "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,backend").split(",")

# A JSON API with no login, sessions, templates or static files, so no contrib apps are needed.
INSTALLED_APPS = ["bookings"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# HTTPS is off by default so the site works on http://localhost; set DJANGO_HTTPS=1 in production.
HTTPS = os.environ.get("DJANGO_HTTPS", "0") == "1"
SECURE_SSL_REDIRECT = HTTPS
if HTTPS:
    # set by the proxy in front
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000 if HTTPS else 0  # one year
SECURE_HSTS_INCLUDE_SUBDOMAINS = HTTPS
SECURE_HSTS_PRELOAD = HTTPS
CSRF_COOKIE_SECURE = True

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# The defaults match docker-compose.yml.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "bookings"),
        "USER": os.environ.get("DB_USER", "bookings"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "bookings"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "4712"),
        # reuse connections between requests
        "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "60")),
        "CONN_HEALTH_CHECKS": True,  # replace a dead connection instead of failing the request
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True

MAX_BOOKINGS = 2  # active bookings one member may hold

DATA_DIR = BASE_DIR / "data"  # the CSV files, also read by the loader tests
