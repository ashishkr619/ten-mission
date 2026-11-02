// Realistic load test: the real rules and the real shape of the data.
// Run it with one command:  sh scripts/loadtest.sh   (it repeats the real CSV data K times, one step per K)
//
// Every member visits once, spread evenly over WINDOW seconds. A visit is what a person does on the site:
// browse, maybe book (often one of the scarce items everyone wants), maybe double-click, cancel and book again,
// try to go over the limit, or send something invalid. A share of all members also go for the same single place
// at the same moment. Every answer is checked against the documented status and error code.
import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";

const BASE = "http://127.0.0.1:4711";
const MEMBERS = Number(__ENV.MEMBERS); // how many members the data has (set by loadtest.sh)
const COPIES = __ENV.COPIES || "1"; // how many times the real data is repeated (for the report)
const WINDOW = Number(__ENV.WINDOW || 10); // seconds in which all members arrive
const MAX_VUS = Number(__ENV.MAX_VUS || 3000); // the most simulated users k6 may start; lower it on a small machine

// What members do: the share of members who do each thing.
const WANT_TO_BOOK = 0.7; // book one item...
const CHASE_SCARCE = 0.6; // ...and of those, this many pick one of the scarce (popular) items
const LOOK_AT_MORE = 0.2; // ask for the second page of the inventory
const LOOK_AT_BOOKINGS = 0.5;
const DOUBLE_CLICK = 0.1; // of those who booked: send the same request twice at once
const CANCEL = 0.15; // of those who booked: cancel after a moment...
const REBOOK = 0.5; // ...and of those, book the same item again
const TRY_ANOTHER = 0.1; // of those who booked: try to book one more (often over the limit)
const BAD_REQUEST = 0.03; // send something invalid
const FLASH_RACE = 0.15; // share of ALL members who go for the same single place at the same moment

// A step passes while all of these hold.
const WRITE_SLOW_MS = 2000; // 95% of bookings and cancels must be faster
const READ_SLOW_MS = 3000; // 95% of reads must be faster
const LATE_SHARE = 0.02; // at most this share of members may fail to start on time

export const options = {
  scenarios: {
    members: {
      executor: "constant-arrival-rate",
      exec: "visit",
      rate: MEMBERS,
      timeUnit: `${WINDOW}s`,
      duration: `${WINDOW}s`,
      preAllocatedVUs: Math.min(500, MAX_VUS),
      maxVUs: MAX_VUS, // running out of users means the limit is reached
    },
    flash: {
      executor: "per-vu-iterations",
      exec: "flash",
      vus: Math.min(MAX_VUS, Math.max(1, Math.round(MEMBERS * FLASH_RACE))),
      iterations: 1,
      startTime: `${WINDOW / 2}s`, // everyone starts at this moment
      maxDuration: "60s",
    },
  },
  thresholds: {
    http_req_failed: ["rate==0"], // no unexpected status, no failed connection
    checks: ["rate==1"], // every answer is exactly as documented
    "http_req_duration{kind:read}": [`p(95)<${READ_SLOW_MS}`],
    "http_req_duration{kind:book_scarce}": [`p(95)<${WRITE_SLOW_MS}`],
    "http_req_duration{kind:book_other}": [`p(95)<${WRITE_SLOW_MS}`],
    "http_req_duration{kind:cancel}": [`p(95)<${WRITE_SLOW_MS}`],
    dropped_iterations: [`count<=${Math.floor(MEMBERS * LATE_SHARE)}`], // k6 could not start a visit on time
  },
};

// --- Setup: learn which items are scarce, plentiful and expired ---------------

function allPages(path, key) {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    const body = http.get(`${BASE}${path}?limit=200&offset=${offset}`).json();
    rows.push(...body[key]);
    if (offset + 200 >= body.total) return rows;
  }
}

export function setup() {
  const items = allPages("/api/inventory", "items");
  const open = items.filter((item) => item.is_available).sort((a, b) => a.remaining_count - b.remaining_count);
  const scarce = open.slice(0, Math.max(1, Math.floor(open.length / 4))).map((item) => item.id);
  const plentiful = open.slice(scarce.length).map((item) => item.id);
  return {
    scarce,
    plentiful: plentiful.length ? plentiful : scarce,
    expired: items.filter((item) => item.is_expired).map((item) => item.id),
    flash: open[0].id, // the scarcest item: usually one place left
  };
}

// --- Small helpers -----------------------------------------------------------

const chance = (share) => Math.random() < share;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const think = () => sleep(0.05 + Math.random() * 0.35);
const newKey = () => `${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Math.random().toString(36).slice(2)}`;
const fakeUuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

function get(path) {
  const response = http.get(`${BASE}${path}`, { tags: { kind: "read" }, responseCallback: http.expectedStatuses(200) });
  answered("read", response, ["200"]);
  return response;
}

// The arguments of a POST. `statuses` are the answers that count as correct for it.
function postArgs(kind, path, body, { key, statuses, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  const params = { headers, tags: { kind }, responseCallback: http.expectedStatuses(...statuses) };
  return [`${BASE}${path}`, raw ?? JSON.stringify(body), params];
}

// Checks the answer against the documented status and error code, e.g. "409 sold_out".
function answered(label, response, allowed) {
  if (response.status === 0) return; // no answer at all: counted as a failed request, not as a wrong answer
  let code = null;
  try {
    code = response.json("error.code");
  } catch (error) {
    // not JSON, for example a crash page: it will not match anything allowed
  }
  const got = code ? `${response.status} ${code}` : String(response.status);
  const ok = allowed.includes(got);
  const where = response.request.url.replace(BASE, "").replace(/\d+/g, "N"); // for example /api/members/N/bookings
  // A wrong answer gets its own check name, so the report says which request got which answer.
  check(response, { [ok ? `${label}: answer is as documented` : `${label} ${where} answered ${got}`]: () => ok });
}

// --- What a member does ------------------------------------------------------

const BOOK_ANSWERS = ["201", "200", "409 sold_out", "409 booking_limit_reached", "409 item_expired"];

function bookArgs(member, item, scarce, key) {
  return postArgs(scarce ? "book_scarce" : "book_other", "/api/book", { member_id: member, item_id: item }, {
    key: key ?? newKey(),
    statuses: [200, 201, 409],
  });
}

// Returns the booking reference, or null if there was no booking.
function book(member, item, scarce) {
  const response = http.post(...bookArgs(member, item, scarce));
  answered("book", response, BOOK_ANSWERS);
  return response.status === 201 || response.status === 200 ? response.json("reference") : null;
}

// The same request sent twice at once: it must make one booking and answer both with it.
function bookTwice(member, item, scarce) {
  const args = bookArgs(member, item, scarce);
  const [first, second] = http.batch([["POST", ...args], ["POST", ...args]]);
  answered("book", first, BOOK_ANSWERS);
  answered("book", second, BOOK_ANSWERS);
  const references = [first, second]
    .filter((response) => response.status === 200 || response.status === 201)
    .map((response) => response.json("reference"));
  check(references, {
    "a double click makes one booking": (refs) => refs.every((reference) => reference === refs[0]),
  });
  return references[0] ?? null;
}

function cancel(member, reference) {
  const args = postArgs("cancel", "/api/cancel", { member_id: member, reference }, { statuses: [200] });
  const response = http.post(...args);
  answered("cancel", response, ["200"]);
}

// Something invalid. The API must refuse it with exactly the documented answer.
function badRequest(member, data, reference) {
  const otherMember = (member % MEMBERS) + 1;
  const NO_SUCH_ID = 10 ** 12;
  const cases = [
    { path: "/api/book", body: { member_id: NO_SUCH_ID, item_id: data.flash }, expected: "404 member_not_found" },
    { path: "/api/book", body: { member_id: member, item_id: NO_SUCH_ID }, expected: "404 item_not_found" },
    { path: "/api/book", raw: "{not json", expected: "400 invalid_json" },
    { path: "/api/book", body: {}, expected: "422 invalid_request" },
    { path: "/api/cancel", body: { member_id: member, reference: fakeUuid() }, expected: "404 booking_not_found" },
  ];
  if (data.expired.length) {
    cases.push({ path: "/api/book", body: { member_id: member, item_id: pick(data.expired) }, expected: "409 item_expired" });
  }
  if (reference && otherMember !== member) {
    // Someone else's booking: another member may not cancel it.
    cases.push({ path: "/api/cancel", body: { member_id: otherMember, reference }, expected: "404 booking_not_found" });
  }

  const chosen = pick(cases);
  const status = Number(chosen.expected.split(" ")[0]);
  const key = chosen.path === "/api/book" ? newKey() : undefined;
  const args = postArgs("bad", chosen.path, chosen.body, { key, raw: chosen.raw, statuses: [status] });
  answered("invalid request", http.post(...args), [chosen.expected]);
}

export function visit(data) {
  const member = (exec.scenario.iterationInTest % MEMBERS) + 1; // a different member each time (k6 may start one visit extra)

  get("/api/inventory?limit=24"); // the first page, as the website asks for it
  if (chance(LOOK_AT_MORE)) get("/api/inventory?limit=24&offset=24");
  if (chance(LOOK_AT_BOOKINGS)) get(`/api/members/${member}/bookings`);

  let reference = null;
  if (chance(WANT_TO_BOOK)) {
    think();
    const scarce = chance(CHASE_SCARCE);
    const item = pick(scarce ? data.scarce : data.plentiful);
    reference = chance(DOUBLE_CLICK) ? bookTwice(member, item, scarce) : book(member, item, scarce);

    if (reference && chance(CANCEL)) {
      think();
      cancel(member, reference);
      if (chance(REBOOK)) {
        think();
        book(member, item, scarce);
      }
    }
    if (reference && chance(TRY_ANOTHER)) {
      think();
      book(member, pick(data.plentiful), false);
    }
  }

  if (chance(BAD_REQUEST)) badRequest(member, data, reference);
}

// A share of all members, all at the same moment, go for the same single place.
export function flash(data) {
  book((exec.vu.idInTest % MEMBERS) + 1, data.flash, true);
}

// --- The one-line result of a step -------------------------------------------

const withCommas = (number) => String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function handleSummary(data) {
  const metrics = data.metrics;
  const value = (name, stat) => metrics[name]?.values?.[stat] ?? 0;
  const ms = (name) => `${withCommas(value(name, "p(95)"))} ms`;

  const failed = [];
  for (const [name, metric] of Object.entries(metrics)) {
    for (const [rule, result] of Object.entries(metric.thresholds ?? {})) {
      if (!result.ok) failed.push(`${name} ${rule}`);
    }
  }

  const requests = value("http_reqs", "count");
  const seconds = data.state.testRunDurationMs / 1000;
  const row =
    `${COPIES.padStart(4)} ${withCommas(MEMBERS).padStart(8)} ${withCommas(requests).padStart(9)} ` +
    `${withCommas(requests / seconds).padStart(6)} ${ms("http_req_duration{kind:book_scarce}").padStart(11)} ` +
    `${ms("http_req_duration{kind:book_other}").padStart(11)} ${ms("http_req_duration{kind:read}").padStart(10)} ` +
    `${String(value("checks", "fails")).padStart(6)} ${String(value("http_req_failed", "passes")).padStart(6)} ` +
    `${String(value("dropped_iterations", "count")).padStart(7)}   ${failed.length ? "FAIL" : "PASS"}`;

  const header = __ENV.HEADER
    ? `\n${"K".padStart(4)} ${"Members".padStart(8)} ${"Requests".padStart(9)} ${"Req/s".padStart(6)} ${"Scarce p95".padStart(11)} ` +
      `${"Other p95".padStart(11)} ${"Read p95".padStart(10)} ${"Wrong".padStart(6)} ${"Failed".padStart(6)} ${"Dropped".padStart(7)}   Result\n`
    : "";
  const reasons = failed.map((rule) => `       failed: ${rule}`);
  const failedChecks = (data.root_group.checks ?? []).filter((result) => result.fails > 0);
  for (const result of failedChecks) reasons.push(`       wrong answer, ${result.fails} time(s): ${result.name}`);
  if (failedChecks.length) reasons.push("WRONG ANSWERS: the API did not answer as documented");
  return { stdout: `${header}${row}\n${reasons.length ? reasons.join("\n") + "\n" : ""}` };
}
