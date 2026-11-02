// What state an inventory item is in. Expired wins over sold out.
export function statusOf(item) {
  if (item.is_expired) return "expired";
  if (item.remaining_count === 0) return "sold-out";
  return "open";
}

// A spot count of this many or fewer is shown as "running low".
export const LOW_STOCK = 2;
