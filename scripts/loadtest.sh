#!/bin/sh
# Load test in one command:
#
#     sh scripts/loadtest.sh
#
# It starts an empty database in Docker and the API, then repeats the real CSV data K times
# (K = 1, 5, 10, 20, ...) and lets every member visit the site (scripts/realistic.js).
# After each step it checks that the database stayed consistent. It stops at the first step that
# fails: that is the limit of this machine and this code. It saves k6's chart report of the last step.
#
# Needs Docker running, k6 (brew install k6) and the project's Python environment.
# Change the steps with STEPS=1,5,10 and the most simulated users with MAX_VUS=800.
# It replaces the demo data; the next `docker compose up` loads it again.
set -e
cd "$(dirname "$0")/.."

if ! command -v k6 >/dev/null; then
    echo "k6 is not installed. Install it with: brew install k6"
    exit 1
fi
if ! python -c "import gunicorn, django" 2>/dev/null; then
    echo "Run this inside the project's Python environment: pip install -r requirements.txt"
    exit 1
fi

server=""
cleanup() {
    if [ -n "$server" ]; then
        kill "$server" 2>/dev/null || true
        wait "$server" 2>/dev/null || true
    fi
    docker compose down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Empties the database and loads the real data repeated $1 times.
load_real_data() {
    python manage.py flush --noinput >/dev/null
    mkdir -p /tmp/load
    for name in members inventory; do
        {
            head -n 1 "data/$name.csv" | awk 1
            i=0
            while [ "$i" -lt "$1" ]; do
                tail -n +2 "data/$name.csv" | awk 1
                i=$((i + 1))
            done
        } > "/tmp/load/$name.csv"
    done
    python manage.py load_initial_data --members /tmp/load/members.csv --inventory /tmp/load/inventory.csv >/dev/null
}

echo "Starting an empty database..."
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --wait db
python manage.py migrate >/dev/null

echo "Starting the API..."
gunicorn config.wsgi:application --bind 127.0.0.1:4711 --worker-class gthread \
    --workers 4 --threads 8 --worker-connections 4000 --backlog 4096 >/dev/null 2>&1 &
server=$!
for _ in $(seq 1 60); do
    curl -s -o /dev/null http://127.0.0.1:4711/api/inventory && break
    sleep 0.5
done

# macOS allows only 256 open connections per terminal by default.
ulimit -n 65535 2>/dev/null || ulimit -n 10240 2>/dev/null || true

status=0
last_pass=""
header=1
echo
echo "The real data repeated K times (K=1 is 45 members and 15 items); all members arrive within 10 seconds."
for k in $(echo "${STEPS:-1,5,10,20,40,60,80,120,160,240,320}" | tr ',' ' '); do
    load_real_data "$k"
    members=$(( $(wc -l < /tmp/load/members.csv) - 1 ))
    python scripts/check_invariants.py snapshot

    k6_status=0
    HEADER=$header COPIES=$k MEMBERS=$members \
        K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_PERIOD=1s K6_WEB_DASHBOARD_EXPORT=k6-report.html \
        k6 run --quiet scripts/realistic.js > /tmp/loadtest_step.txt 2>&1 || k6_status=$?
    grep -v 'msg="thresholds on metrics' /tmp/loadtest_step.txt || true
    header=""

    # Wrong answers are a bug in the code, not a limit of the machine.
    if grep -q '^WRONG ANSWERS' /tmp/loadtest_step.txt; then
        status=1
        break
    fi

    # An error other than "a threshold failed" means the test itself broke.
    if [ "$k6_status" != 0 ] && [ "$k6_status" != 99 ]; then
        echo "k6 stopped with an error (exit code $k6_status)."
        status=1
        break
    fi
    python scripts/check_invariants.py || { status=1; break; }
    if [ "$k6_status" = 99 ]; then
        break
    fi
    last_pass="$k ($members members)"
done

echo
if [ -n "$last_pass" ]; then
    echo "Your limit: the last step that passed was K=$last_pass."
else
    echo "Even the first step failed."
fi
if [ "$status" = 0 ]; then echo "PASSED: every answer was correct and the database stayed consistent."; else echo "FAILED (see above)"; fi
exit $status
