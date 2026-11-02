#!/bin/sh
# Runs on every start of the backend container. Every step is safe to repeat.
set -e

python manage.py migrate --noinput

# Loads the CSV files on the first start only; prints "Skipping" once data exists.
python manage.py load_initial_data \
    --members data/members.csv \
    --inventory data/inventory.csv \
    --skip-if-loaded

# gthread workers keep serving while a request waits on the database.
# Requests handled at once = WEB_WORKERS x WEB_THREADS. Each thread holds one
# database connection, so keep that product below Postgres's max_connections (100).
# --worker-connections and --backlog let a rush of thousands of connections wait
# in line instead of being dropped (4000 per worker).
# --worker-tmp-dir keeps gunicorn's heartbeat file in memory.
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --worker-class gthread \
    --workers "${WEB_WORKERS:-4}" \
    --threads "${WEB_THREADS:-8}" \
    --worker-connections 4000 \
    --backlog 4096 \
    --worker-tmp-dir /dev/shm \
    --access-logfile -
