// The server stores dates in UTC, so they are shown in UTC too. That keeps a
// date like "19 Nov 2030" the same for everyone, wherever they are.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// Accepts "2030-11-19" or a full ISO timestamp.
export const formatDate = (value) => dateFormat.format(new Date(value));

export const fullName = (member) => `${member.first_name} ${member.last_name}`;

// "Emily Johnson" -> "EJ"
export const initials = (member) => `${member.first_name[0]}${member.last_name[0]}`.toUpperCase();

export const places = (count) => `${count} ${count === 1 ? "place" : "places"}`;

// "3f9ac2e1-...." -> "3F9A C2E1": easy to read out loud. The full reference is
// what the API needs; this is only for people.
export const shortReference = (reference) =>
  reference.slice(0, 8).toUpperCase().replace(/(.{4})(.{4})/, "$1 $2");
