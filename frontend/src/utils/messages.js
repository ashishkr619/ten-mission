import { fullName } from "./format.js";

// Turns an API error into a sentence that says what happened and what to do next.
export function bookingErrorMessage(error, member, item) {
  const who = member ? fullName(member) : "This member";
  const what = item ? item.title : "This experience";

  switch (error.code) {
    case "booking_limit_reached":
      return `${who} already holds the maximum number of bookings. Cancel one to make another.`;
    case "sold_out":
      return `${what} is now fully booked. Please choose another experience.`;
    case "item_expired":
      return `${what} has expired and can't be booked.`;
    case "member_not_found":
    case "item_not_found":
      return "That member or experience no longer exists. The lists have been refreshed, so please choose again.";
    case "network":
      return "The server can't be reached. Check the connection and press Book again. Trying again won't make a second booking.";
    case "invalid_request":
      return Object.values(error.fields ?? {}).join(" ") || "Some details are missing. Choose a member and an experience.";
    default:
      return "Something went wrong on our side. Please try again in a moment.";
  }
}

export function cancelErrorMessage(error) {
  switch (error.code) {
    case "booking_not_found":
      return "That booking no longer exists.";
    case "network":
      return "The server can't be reached. Check the connection and try again.";
    default:
      return "Something went wrong on our side. Please try again in a moment.";
  }
}
