import { useState } from "react";
import { ArrowUpRight, CalendarDays, Search, ShieldCheck, Sparkles } from "lucide-react";
import { getInventory } from "../api.js";
import Availability from "../components/Availability.jsx";
import Banner from "../components/Banner.jsx";
import ContourArt from "../components/ContourArt.jsx";
import { useDebounced } from "../hooks/useDebounced.js";
import { usePagedList } from "../hooks/usePagedList.js";
import { formatDate } from "../utils/format.js";
import { statusOf } from "../utils/items.js";
import { buttonClass } from "../utils/ui.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "sold-out", label: "Fully booked" },
  { id: "expired", label: "Expired" },
];

// The API's name for each filter.
const STATUS = { all: undefined, open: "open", "sold-out": "sold_out", expired: "expired" };

// One experience: the artwork on top, then its details.
// For an open experience the whole card is a link to the booking page.
function ItemCard({ item }) {
  const status = statusOf(item);
  const open = status === "open";
  const date = formatDate(item.expiration_date);

  return (
    <li>
      <article
        className={`group relative flex h-full flex-col overflow-hidden rounded-[24px] bg-paper/95 ring-1 ring-line transition duration-300
          has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-plum
          ${open ? "hover:-translate-y-1 hover:shadow-[0_28px_60px_-32px_rgba(33,19,41,0.45)] hover:ring-line-strong" : ""}`}
      >
        <div className={`relative aspect-[16/8.7] shrink-0 overflow-hidden ${status === "open" ? "" : "opacity-60 grayscale"}`}>
          <ContourArt item={item} className="size-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-white/5" />
        </div>

        <div className="flex flex-1 flex-col p-5 sm:p-6">
          <h2 className="font-display text-[1.85rem] font-medium leading-[1.05] tracking-[-0.025em]">
            {open ? (
              // The link is stretched over the whole card by the ::after rule.
              <a href={`#/book?item=${item.id}`} aria-label={`Book ${item.title}`} className="after:absolute after:inset-0">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h2>
          <p className="mb-6 mt-3 line-clamp-2 text-sm leading-6 text-ink-soft">{item.description}</p>

          <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t border-line pt-4">
            <div className="space-y-1">
              <Availability item={item} />
              <p className="flex items-center gap-1.5 text-sm text-slate">
                <CalendarDays size={14} aria-hidden="true" />
                {status === "expired" ? `Expired ${date}` : `Available until ${date}`}
              </p>
            </div>
            {open && (
              <span className={buttonClass("primary", { size: "sm" })}>
                Reserve
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            )}
          </div>
        </div>
      </article>
    </li>
  );
}

function SkeletonCard() {
  return (
    <li aria-hidden="true">
      <div className="overflow-hidden rounded-xl bg-paper ring-1 ring-line">
        <div className="aspect-[16/9] bg-plum/[0.05] motion-safe:animate-pulse" />
        <div className="space-y-3 p-5">
          <div className="h-7 w-2/3 rounded bg-plum/[0.05] motion-safe:animate-pulse" />
          <div className="h-4 w-full rounded bg-plum/[0.05] motion-safe:animate-pulse" />
          <div className="h-4 w-1/2 rounded bg-plum/[0.05] motion-safe:animate-pulse" />
        </div>
      </div>
    </li>
  );
}

export default function InventoryPage() {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const list = usePagedList(getInventory, "items", { status: STATUS[filter], q: search }, 24);

  // The totals for the header and the filters always describe the whole inventory.
  const counts = list.extra.counts;
  const countFor = { all: counts?.all, open: counts?.open, "sold-out": counts?.sold_out, expired: counts?.expired };

  return (
    <div>
      <section className="relative overflow-hidden rounded-[28px] bg-plum-deep px-6 py-9 text-white shadow-[0_26px_80px_-38px_rgba(33,19,41,0.8)] sm:px-9 sm:py-12 lg:rounded-[36px] lg:px-12 lg:py-14">
        <div className="absolute -right-20 -top-36 size-[28rem] rounded-full bg-brass/14 blur-3xl" />
        <div className="absolute -bottom-48 left-[42%] size-96 rounded-full bg-lilac/20 blur-3xl" />
        <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-brass-light">
              <Sparkles size={14} aria-hidden="true" />
              Inventory
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-[clamp(3rem,6vw,5.3rem)] font-medium leading-[0.92] tracking-[-0.045em]">
              Experiences,
              <span className="block italic text-brass-pale">thoughtfully reserved.</span>
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-6 text-white/62 sm:text-base sm:leading-7">
              Every experience with the places left. Open ones come first; fully booked and expired ones stay visible but can't be booked.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
            <div className="bg-white/[0.055] p-5 backdrop-blur-sm">
              <p className="font-display text-3xl text-white">{counts ? counts.open : "—"}</p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/45">Open experiences</p>
            </div>
            <div className="bg-white/[0.055] p-5 backdrop-blur-sm">
              <p className="font-display text-3xl text-white">{counts ? counts.places_left : "—"}</p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/45">Places available</p>
            </div>
            <div className="col-span-2 flex items-center gap-2 bg-white/[0.055] px-5 py-3.5 text-[10px] text-white/55 backdrop-blur-sm">
              <ShieldCheck size={14} className="text-brass-light" aria-hidden="true" />
              Every booking is checked against the places left
            </div>
          </div>
        </div>
      </section>

      {list.error && !list.loaded && (
        <div className="mt-8">
          <Banner
            tone="error"
            title="The inventory couldn't be loaded"
            action={
              <button type="button" onClick={list.reload} className="text-sm font-semibold underline">
                Try again
              </button>
            }
          >
            {list.error.code === "network"
              ? "The server isn't reachable. Check that the API is running."
              : "Something went wrong on our side."}
          </Banner>
        </div>
      )}

      <div className="mt-7 flex flex-col gap-5 rounded-[22px] bg-paper/90 p-3 shadow-[0_12px_38px_-26px_rgba(33,19,41,0.3)] ring-1 ring-line md:flex-row md:items-center md:justify-between md:px-5">
        <div role="group" aria-label="Filter by availability" className="flex flex-wrap gap-x-6 gap-y-1">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`relative min-h-11 text-sm font-medium transition ${
                filter === id ? "text-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              {label}
              <span className="ml-1.5 tabular-nums text-slate">{countFor[id] ?? ""}</span>
              {filter === id && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brass" />}
            </button>
          ))}
        </div>

        <div className="relative md:w-72">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search experiences by title"
            placeholder="Search experiences"
            className="min-h-11 w-full rounded-full bg-pearl/70 py-2.5 pl-10 pr-4 text-sm ring-1 ring-line placeholder:text-slate focus:bg-paper"
          />
        </div>
      </div>

      {/* As many columns as fit, each at least 19rem wide. No breakpoints needed. */}
      <ul className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(min(100%,19.5rem),1fr))] gap-6">
        {list.loading && Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}

        {list.items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </ul>

      {list.loaded && list.items.length < list.total && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="text-sm text-ink-soft">
            Showing {list.items.length} of {list.total}
          </p>
          <button type="button" className={buttonClass("quiet")} onClick={list.loadMore} disabled={list.loadingMore}>
            {list.loadingMore ? "Loading" : "Show more experiences"}
          </button>
          {list.error && <p className="text-sm text-wine">More experiences couldn&rsquo;t be loaded. Try again.</p>}
        </div>
      )}

      {list.loaded && list.items.length === 0 && (
        <div className="mt-7 rounded-[24px] bg-paper px-6 py-16 text-center ring-1 ring-line">
          <p className="font-display text-2xl font-medium">No experiences match</p>
          <p className="mt-2 text-sm text-ink-soft">Try a different filter or search.</p>
          <button
            type="button"
            className={buttonClass("quiet", { extra: "mt-5" })}
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
