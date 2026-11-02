# Ten Mission

A small booking site for the Ten Group take-home challenge. Members book and cancel places on experiences with limited availability. Django and Postgres on the back, React and Tailwind on the front.

## Start it

You need Docker with Compose. From this folder:

```
docker compose up --build
```

Open **http://localhost:4710**. The API is on port 4711 and Postgres on 4712 (unusual ports, so they do not clash with other projects; change them in `.env`, see `.env.example`).

The first start creates the tables and loads `data/members.csv` and `data/inventory.csv`. Later starts keep the data. To start again from the CSV files: `docker compose down -v`.

## Run the tests

```
docker compose run --rm backend python manage.py test bookings
```

61 tests: the booking rules (7 of them fire real parallel requests at Postgres), the API and the CSV loader. GitHub Actions runs them, and the frontend build, on every push.


## What the site does

- **Inventory page:** every experience with the places left. Filter by open, fully booked or expired, and search by title.
- **Book page:** pick a member and an experience, then book. The confirmation shows the booking reference. The member's active bookings are listed below and can be cancelled (two clicks, so nobody cancels by accident).


## Extra Care

The brief suggests about two hours. The core it asks for is the CSV loader, the models, `POST /book`, `POST /cancel`, the two pages and this README.

- **Correctness under concurrency, with tests that prove it.** Booking scarce places is the heart of this business, and a double-booked place is the most expensive bug it can have.
- **Safe retries.** A double click or a network retry must never book twice.
- **Lists that load a page at a time, with search,** so both pages still work with thousands of members.
- **A considered design and copy,** more than the brief asks for.
- **A load test,** described in [docs/performance.md](docs/performance.md).




## The data

What the loader found in the two CSV files. It keeps every row and reports these notes:

- 45 members and 15 inventory items.
- **Duplicate names:** two Sophie Davis and two Grace Miller. They joined on different dates, so they are different people and separate rows. The UI shows the join date to tell them apart.
- **Duplicate title:** two "London" items with different stock and expiry dates. Also separate rows.
- **3 members already hold 3 bookings,** above the limit of 2. They are loaded as they are, and cannot book again until they are back under the limit.
- **3 items are expired and 1 has no places left.** They stay visible but cannot be booked.
- **Bad rows are never repaired silently.** The loader checks both files completely first and reports every problem; if there is any, it writes nothing.

## Decisions and assumptions

- **Limit:** a member holds at most 2 active bookings (`MAX_BOOKINGS` in `config/settings.py`).
- **Expiry:** an item can be booked through its expiration date. "Today" is the UTC date.
- **Same item twice:** allowed, up to the limit. The brief does not forbid it.
- **Bookings from the CSV:** a member's `booking_count` becomes their starting count. Those bookings have no reference, so they count toward the limit but cannot be cancelled.
- **Cancel:** gives the place back exactly once. Cancelling again is safe and returns the booking unchanged. The row is kept (with `cancelled_at`), so history is not lost.
- **Retries:** an optional `Idempotency-Key` header makes a booking safe to repeat. The same key from the same member returns the first booking. The website sends one with every attempt and reuses it after a network failure.
- **No login:** the brief does not ask for one, so the client sends `member_id`. In production the member would come from the session.
- **Paths:** the API is under `/api/...`. `POST /book` and `POST /cancel` also work, as written in the brief.

## How double booking is prevented

All the rules are in `bookings/services.py`, written with the Django ORM. A booking goes like this:

```
POST /book {member_id, item_id}
  1. Check the input                          -> 422 if invalid
  2. Same Idempotency-Key used before?        -> return that booking (200)
  3. Item exists and has not expired?         -> item_not_found / item_expired
  4. In one transaction:
       member count +1, only if below 2       -> member_not_found / booking_limit_reached
       item stock   -1, only if above 0       -> sold_out (this also undoes the +1)
       save the booking                       -> 201 with the reference
  5. Lost a race to an identical request?     -> return the winner's booking (200)
```

- **"Take one" is a conditional `UPDATE`:** `remaining_count = remaining_count - 1 WHERE remaining_count > 0`, and the same for the member with `< 2`. Postgres checks the condition against the current row and makes a second request for the same row wait for the first. So two requests can never both take the last place. There is no read-then-write in Python.
- **All or nothing:** the member, item and booking writes are in one transaction.
- **A fixed order:** booking and cancelling both update the member before the item, so a booking and a cancel can never wait on each other in a circle.
- **A second line of defence in the schema:** check constraints stop stock or a member's count going below zero, and a unique rule on `(member, idempotency_key)` stops a retry from booking twice.
- **Checked by breaking it:** I removed each rule in turn (no stock check, no member limit, expiry off by one, no transaction, cancel giving the place back twice, retry lookups removed) and confirmed that a test fails every time.

When several things are wrong at once, the error is always the first of: item not found, item expired, member not found, booking limit, sold out.

## API

All bodies are JSON. Every error has the same shape: `{"error": {"code": "sold_out", "message": "...", "fields": {...}}}`, where `fields` appears only for invalid input.

| Endpoint | Does | Success |
|---|---|---|
| `POST /api/book` | Body `{member_id, item_id}`, optional `Idempotency-Key` header | `201` new booking, `200` repeat of an earlier one |
| `POST /api/cancel` | Body `{member_id, reference}` | `200` the booking, also when it was already cancelled |
| `GET /api/inventory` | One page of items, open first, then fully booked, then expired; `total`, and `counts` for the whole inventory | `200` |
| `GET /api/inventory/<id>` | One item | `200` |
| `GET /api/members` | One page of members by name, with `bookings_left`; `total` and `max_bookings` | `200` |
| `GET /api/members/<id>` | One member | `200` |
| `GET /api/members/<id>/bookings` | The member's active bookings, newest first | `200` |

The lists take `?limit=` (1 to 200, default 50), `?offset=` and `?q=` (search), and the inventory also takes `?status=open|sold_out|expired`.

A booking looks like `{reference, member_id, item_id, item_title, booked_at, cancelled_at, status}`.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_json` | The body is not a JSON object |
| 422 | `invalid_request` | A field or parameter is missing or wrong (`fields` says which) |
| 404 | `member_not_found`, `item_not_found`, `booking_not_found` | It does not exist (someone else's booking is also "not found") |
| 409 | `item_expired`, `booking_limit_reached`, `sold_out`, `idempotency_key_conflict` | The rules say no |

```
curl -X POST localhost:4711/api/book -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: demo-1' -d '{"member_id": 1, "item_id": 1}'
```

## What this is not

This is built with production in mind, but it is not a complete production system. Left out on purpose:

- login and permissions, and rate limits;
- metrics, structured logs and alerts;
- sending confirmations (emails, notifications);
- a separate release step for migrations (the container runs them on start, which is fine for one container but not for several starting at once);
- a highly available database, and search indexes for very large lists.

## What I would do next

For the business first:

1. **A waitlist** for fully booked experiences, offering the place to the next member when someone cancels.
2. **Short holds:** keep a place for a few minutes while a member decides, then release it.
3. **Fair access to the scarcest experiences:** a queue or a draw instead of "fastest click wins".
4. **A limit per membership tier,** instead of one `MAX_BOOKINGS` for everyone.
5. **An audit trail** for the concierge team: who booked or cancelled what, for whom.

Then for scale (see [docs/performance.md](docs/performance.md)):

6. **Move booking into one Postgres function** if write traffic needs it. In an experiment, successful bookings were 2 to 3 times faster in one round trip. I kept the Django version because it is easier to read, test and change.
7. **Keyset paging and cached counts** for very large lists.
8. **One row per place, or a split counter,** for a single extremely popular item. Today every booking of one item queues on that item's row.
9. **An outbox table** for notifications, more app servers, and a read replica for the list pages.

## Layout

```
bookings/       models, services.py (the booking rules), api.py (the views), utils.py (their helpers), CSV loader, tests
config/         Django settings
data/           members.csv and inventory.csv (loaded on first start)
frontend/       React 19, Tailwind 4 (src: pages, components, hooks, utils); served by nginx, which also forwards /api
scripts/        the load test (see docs/performance.md)
docs/           performance.md
```

### Work on the frontend

```
docker compose up db backend              # the API on 4711, without the frontend container
cd frontend && npm ci && npm run dev      # http://localhost:4710, forwards /api to 4711
```
