import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getMembers } from "../api.js";
import { useDebounced } from "../hooks/useDebounced.js";
import { usePagedList } from "../hooks/usePagedList.js";
import { formatDate, fullName } from "../utils/format.js";
import { buttonClass } from "../utils/ui.js";
import Avatar from "./Avatar.jsx";
import ChoiceRow from "./ChoiceRow.jsx";
import Pill from "./Pill.jsx";

// Pick who the booking is for. Names are not unique (there are two Sophie
// Davis), so every row also shows the date the member joined.
// The list comes in pages and the search runs on the server.
//   onLoaded(maxBookings)  tells the page the booking limit
//   version                goes up after a booking, to load fresh numbers
export default function MemberPicker({ selectedId, onSelect, onLoaded, version, maxBookings }) {
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const list = usePagedList(getMembers, "members", { q: search }, 20);

  const limit = list.extra.max_bookings;
  useEffect(() => {
    if (limit) onLoaded(limit);
  }, [limit, onLoaded]);

  const reloadRef = useRef(list.reload);
  reloadRef.current = list.reload;
  useEffect(() => {
    if (version) reloadRef.current();
  }, [version]);

  return (
    // min-w-0: a fieldset refuses to shrink below its content unless it is told it may.
    <fieldset className="min-w-0">
      <legend className="font-display text-[1.7rem] font-medium tracking-[-0.02em]">Choose a member</legend>
      <p className="mt-1 text-sm text-ink-soft">
        Who is this booking for?{list.loaded && ` ${list.total} ${search ? "match" : "members"}.`}
      </p>

      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search members by name"
          placeholder="Search by name"
          className="min-h-11 w-full rounded-full bg-pearl/60 py-2.5 pl-10 pr-4 text-sm ring-1 ring-line placeholder:text-slate focus:bg-paper"
        />
      </div>

      {/* p-1 / -mx-1 leave room around the rows, so focus rings are not clipped by the scrolling list. */}
      <div className="-mx-1 mt-2 grid max-h-[min(22rem,55vh)] gap-2 overflow-y-auto p-1">
        {list.loading &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-plum/[0.05] motion-safe:animate-pulse" />
          ))}

        {list.items.map((member) => (
          <ChoiceRow
            key={member.id}
            name="member"
            checked={member.id === selectedId}
            onChange={() => onSelect(member)}
            leading={<Avatar member={member} />}
            title={fullName(member)}
            detail={`Joined ${formatDate(member.date_joined)}`}
            badge={
              member.bookings_left > 0 ? (
                <Pill>{member.active_booking_count} of {maxBookings} used</Pill>
              ) : (
                <Pill tone="bad">At limit</Pill>
              )
            }
          />
        ))}

        {list.loaded && list.items.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-soft">No member matches &ldquo;{search}&rdquo;.</p>
        )}

        {list.error && !list.loaded && (
          <p className="py-6 text-center text-sm text-ink-soft">
            The members couldn&rsquo;t be loaded.{" "}
            <button type="button" onClick={list.reload} className="font-semibold underline">
              Try again
            </button>
          </p>
        )}

        {list.loaded && list.items.length < list.total && (
          <div className="flex flex-col items-center gap-2 py-2">
            <p className="text-xs text-slate">Showing {list.items.length} of {list.total}</p>
            <button
              type="button"
              className={buttonClass("quiet", { size: "sm" })}
              onClick={list.loadMore}
              disabled={list.loadingMore}
            >
              {list.loadingMore ? "Loading" : "Show more members"}
            </button>
            {list.error && <p className="text-xs text-wine">More members couldn&rsquo;t be loaded. Try again.</p>}
          </div>
        )}
      </div>
    </fieldset>
  );
}
