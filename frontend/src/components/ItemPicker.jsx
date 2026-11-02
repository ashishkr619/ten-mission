import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getInventory } from "../api.js";
import { useDebounced } from "../hooks/useDebounced.js";
import { usePagedList } from "../hooks/usePagedList.js";
import { formatDate } from "../utils/format.js";
import { LOW_STOCK, statusOf } from "../utils/items.js";
import { buttonClass } from "../utils/ui.js";
import ChoiceRow from "./ChoiceRow.jsx";
import ContourArt from "./ContourArt.jsx";
import Pill from "./Pill.jsx";

function Badge({ item }) {
  const status = statusOf(item);
  if (status === "expired") return <Pill tone="muted">Expired</Pill>;
  if (status === "sold-out") return <Pill tone="bad">Fully booked</Pill>;
  return (
    <Pill tone={item.remaining_count <= LOW_STOCK ? "low" : "good"}>{item.remaining_count} left</Pill>
  );
}

// Pick what to book. The server puts experiences that can be booked first; fully
// booked and expired ones stay visible but cannot be chosen. The list comes in
// pages and the search runs on the server.
//   selected  the chosen item. It stays at the top even if it is not on a loaded page,
//             for example when you arrive from "Reserve" on the inventory page.
//   version   goes up after a booking, to load fresh numbers
// The grid fits as many columns as the width allows, so it never needs a breakpoint.
export default function ItemPicker({ selected, onSelect, version }) {
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const list = usePagedList(getInventory, "items", { q: search }, 24);

  const reloadRef = useRef(list.reload);
  reloadRef.current = list.reload;
  useEffect(() => {
    if (version) reloadRef.current();
  }, [version]);

  const pinned = selected && !search && !list.items.some((item) => item.id === selected.id) ? selected : null;
  const rows = pinned ? [pinned, ...list.items] : list.items;

  return (
    // min-w-0: a fieldset refuses to shrink below its content unless it is told it may.
    <fieldset className="min-w-0">
      <legend className="font-display text-[1.7rem] font-medium tracking-[-0.02em]">Choose an experience</legend>
      <p className="mt-1 text-sm text-ink-soft">
        What are they booking?{list.loaded && ` ${list.total} ${search ? "match" : "experiences"}.`}
      </p>

      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search experiences by title"
          placeholder="Search experiences"
          className="min-h-11 w-full rounded-full bg-pearl/60 py-2.5 pl-10 pr-4 text-sm ring-1 ring-line placeholder:text-slate focus:bg-paper"
        />
      </div>

      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
        {list.loading &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-plum/[0.05] motion-safe:animate-pulse" />
          ))}

        {rows.map((item) => {
          const status = statusOf(item);
          return (
            <ChoiceRow
              key={item.id}
              name="item"
              checked={item.id === selected?.id}
              disabled={status !== "open"}
              onChange={() => onSelect(item)}
              leading={
                <div className={`h-11 w-16 shrink-0 overflow-hidden rounded-xl ${status === "open" ? "" : "opacity-50 grayscale"}`}>
                  <ContourArt item={item} className="size-full" />
                </div>
              }
              serifTitle
              title={item.title}
              detail={`${status === "expired" ? "Ended" : "Until"} ${formatDate(item.expiration_date)}`}
              badge={<Badge item={item} />}
            />
          );
        })}
      </div>

      {list.loaded && list.items.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-soft">No experience matches &ldquo;{search}&rdquo;.</p>
      )}

      {list.error && !list.loaded && (
        <p className="py-6 text-center text-sm text-ink-soft">
          The experiences couldn&rsquo;t be loaded.{" "}
          <button type="button" onClick={list.reload} className="font-semibold underline">
            Try again
          </button>
        </p>
      )}

      {list.loaded && list.items.length < list.total && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-slate">Showing {list.items.length} of {list.total}</p>
          <button
            type="button"
            className={buttonClass("quiet", { size: "sm" })}
            onClick={list.loadMore}
            disabled={list.loadingMore}
          >
            {list.loadingMore ? "Loading" : "Show more experiences"}
          </button>
          {list.error && <p className="text-xs text-wine">More experiences couldn&rsquo;t be loaded. Try again.</p>}
        </div>
      )}
    </fieldset>
  );
}
