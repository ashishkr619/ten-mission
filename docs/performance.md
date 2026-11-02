# Load test

The 61 tests prove the booking rules are correct, including under parallel requests. The load test checks the same rules at a larger scale, with traffic shaped like real use, and finds where one machine runs out of capacity. It is optional and not part of what the brief asks for.

## Run it

You need Docker running, [k6](https://k6.io) (`brew install k6`) and a Python environment for the project:

```
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
sh scripts/loadtest.sh
```

It replaces the demo data in Docker; the next `docker compose up` loads the CSV files again.

`STEPS=1,5,10 sh scripts/loadtest.sh` picks the steps, and `MAX_VUS=800` lowers the most simulated users (the default is 3,000, which needs a few GB of memory).

## What it does

It starts an empty database and the API, then repeats the real CSV data K times, for K = 1, 5, 10, 20, 40 and so on. K=1 is the real 45 members and 15 items, so the shares of scarce, expired and fully booked items, and of members near their limit, stay as in the real data.

In each step every member visits once, spread over 10 seconds, and does what a person does on the site:

- browses the inventory (some also ask for the second page) and looks at their bookings;
- 70% book, and 60% of those go for the scarcest items;
- some double-click, some cancel and book again, some try to go over the limit;
- a few send invalid requests (unknown member or item, broken JSON, an expired item, someone else's booking);
- and 15% of all members go for the same single place at the same moment.

## How it judges

- **Every answer** must have the documented status and error code.
- **After each step the database is checked:** every member's count and every item's stock must equal the starting value adjusted by the active bookings, no stock is below zero, and nobody is above the limit unless they started above it.
- **A step passes** while there are no wrong answers and no failed requests, 95% of bookings and cancels finish within 2 seconds (reads within 3), and at least 98% of visits start on time.

The test stops at the first step that fails. The last step that passed is the limit of that machine running this code. `k6-report.html` holds k6's charts for the last step.

## Result

On a small cloud machine with 2 CPU cores, running the API, Postgres and k6 together, with at most 800 simulated users:

| K | Members | Requests | Requests/s | Scarce bookings p95 | Other bookings p95 | Reads p95 | Wrong answers | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 45 | 124 | 12 | 47 ms | 15 ms | 12 ms | 0 | pass |
| 5 | 225 | 636 | 61 | 215 ms | 51 ms | 12 ms | 0 | pass |
| 10 | 450 | 1,228 | 118 | 337 ms | 30 ms | 24 ms | 0 | pass |
| 20 | 900 | 2,456 | 236 | 531 ms | 517 ms | 452 ms | 0 | pass |
| 40 | 1,800 | 4,003 | 261 | 3.3 s | 4.1 s | 3.9 s | 0 | too slow |

At 1,800 members the two cores were saturated at about 260 requests per second, so answers became slow and some visits could not start on time. Even then, every answer was correct and the database check passed. This is one run on one small machine, not a capacity figure; a laptop or a server with more cores goes further. Run it to measure your own.

## What the measurements changed

These choices were measured with this test while building:

- **Threaded gunicorn workers that can hold thousands of waiting connections:** plain `sync` workers dropped 6 to 7% of requests when 10,000 arrived at once.
- **Reused database connections** (`CONN_MAX_AGE`): about 3 times faster reads and 2 times faster writes.
- **Paginated lists:** each inventory read dropped from 237 KB to 6 KB, which roughly doubled the number of members a machine could serve.

One option was measured and not adopted: moving the booking rules into a single Postgres function made successful bookings 2 to 3 times faster, because it needs one database round trip instead of several. I kept the Django version because it is easier to read, test and change. In the runs above, reads slowed down as much as bookings, so the machine as a whole was the limit, not the booking queries. It is the first thing I would revisit if bookings became the bottleneck.
