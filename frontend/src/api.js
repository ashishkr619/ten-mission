// Everything the app says to the Django API lives in this file.

// Every failure is thrown as an ApiError, so screens only handle one kind of error.
//   code    "sold_out", "member_not_found", ... (from the API), or
//           "network" (no answer) or "server_error" (answer that is not our JSON)
//   fields  per-field messages for a 422, e.g. { member_id: "Required. ..." }
export class ApiError extends Error {
  constructor(code, message, { status, fields } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError("network", "Can't reach the server.");
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // The server sent something that is not JSON (for example a crash page).
  }

  if (!response.ok) {
    const error = body?.error;
    throw new ApiError(error?.code ?? "server_error", error?.message ?? "Unexpected server error.", {
      status: response.status,
      fields: error?.fields,
    });
  }
  return body;
}

function postJson(path, data, headers = {}) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
}

// Turns { q: "rome", limit: 24 } into "?q=rome&limit=24", leaving out empty values.
function queryString(params) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(name, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// The two lists come in pages: { limit, offset, q } and, for the inventory, { status }.
export const getMembers = (params = {}) => request(`/api/members${queryString(params)}`);
export const getMember = (id) => request(`/api/members/${id}`);
export const getInventory = (params = {}) => request(`/api/inventory${queryString(params)}`);
export const getItem = (id) => request(`/api/inventory/${id}`);
export const getMemberBookings = (memberId) => request(`/api/members/${memberId}/bookings`);

// A new random key for one booking attempt (the fallback is for old browsers).
export const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// The idempotency key makes a retry safe: sending the same key again returns the
// first booking instead of making a second one.
export const bookItem = (memberId, itemId, idempotencyKey) =>
  postJson("/api/book", { member_id: memberId, item_id: itemId }, { "Idempotency-Key": idempotencyKey });

export const cancelBooking = (memberId, reference) =>
  postJson("/api/cancel", { member_id: memberId, reference });
