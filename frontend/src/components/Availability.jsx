import { places } from "../utils/format.js";
import { LOW_STOCK, statusOf } from "../utils/items.js";

// How many places an experience has left, as a coloured dot and a short phrase.
//   moss      plenty left       brass   only a few left
//   wine      fully booked      grey    expired
export default function Availability({ item }) {
  const status = statusOf(item);

  let dot = "bg-slate";
  let text = "text-slate";
  let label = "Expired";

  if (status === "sold-out") {
    dot = "bg-wine";
    text = "text-wine";
    label = "Fully booked";
  } else if (status === "open") {
    const low = item.remaining_count <= LOW_STOCK;
    dot = low ? "bg-brass" : "bg-moss";
    text = low ? "text-brass-text" : "text-moss";
    label = `${places(item.remaining_count)} remaining`;
  }

  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${text}`}>
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
