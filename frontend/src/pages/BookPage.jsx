import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { bookItem, getItem, getMember, newIdempotencyKey } from "../api.js";
import ActiveBookings from "../components/ActiveBookings.jsx";
import Banner from "../components/Banner.jsx";
import BookingSummary from "../components/BookingSummary.jsx";
import ItemPicker from "../components/ItemPicker.jsx";
import MemberPicker from "../components/MemberPicker.jsx";
import { fullName } from "../utils/format.js";
import { statusOf } from "../utils/items.js";
import { bookingErrorMessage } from "../utils/messages.js";
import { buttonClass } from "../utils/ui.js";

// Why the Book button is switched off, or null when booking is possible.
function blockedReason(member, item, maxBookings) {
  if (!member) return "Choose a member to continue.";
  if (!item) return "Choose an experience to continue.";
  if (member.bookings_left === 0) {
    return `${fullName(member)} already holds the maximum of ${maxBookings} bookings. Cancel one to make another.`;
  }
  if (statusOf(item) === "expired") return `${item.title} has expired.`;
  if (statusOf(item) === "sold-out") return `${item.title} is fully booked.`;
  return null;
}

function Panel({ children, step }) {
  return (
    <section className="relative rounded-[24px] bg-paper/95 p-5 shadow-[0_18px_50px_-36px_rgba(33,19,41,0.4)] ring-1 ring-line sm:p-7">
      <span className="absolute right-6 top-6 text-[9px] font-semibold uppercase tracking-[0.2em] text-brass-text/70">
        Step {step}
      </span>
      {children}
    </section>
  );
}

export default function BookPage({ presetItemId }) {
  const [member, setMember] = useState(null); // the whole chosen member, so it does not depend on which page is loaded
  const [item, setItem] = useState(null);
  const [maxBookings, setMaxBookings] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { booking } after success, { error } after a failure
  const [version, setVersion] = useState(0); // goes up to make the lists and the member's bookings reload

  // One key per booking attempt. It is kept after a network failure, so pressing
  // Book again retries the same attempt and can never book twice.
  const attemptKey = useRef(null);
  const summaryRef = useRef(null);

  // Arriving from "Reserve" on the inventory page with a chosen experience.
  useEffect(() => {
    if (!presetItemId) return;
    attemptKey.current = null;
    setResult(null);
    getItem(presetItemId).then(setItem, () => setItem(null));
  }, [presetItemId]);

  const reason = blockedReason(member, item, maxBookings);
  const booking = result?.booking ?? null;

  // Changing the choice starts a new attempt and clears the last result.
  function choose(setter, chosen) {
    setter(chosen);
    attemptKey.current = null;
    setResult(null);
  }

  // The numbers on screen may have changed, so load them again.
  function refreshAll() {
    setVersion((v) => v + 1);
    if (member) getMember(member.id).then(setMember, () => {});
    if (item) getItem(item.id).then(setItem, () => {});
  }

  // Below the two-column layout the summary sits under the lists, so bring the result into view.
  function showSummary() {
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    summaryRef.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }

  async function handleBook() {
    if (reason || submitting) return;
    setSubmitting(true);
    setResult(null);
    attemptKey.current ??= newIdempotencyKey();

    try {
      const made = await bookItem(member.id, item.id, attemptKey.current);
      attemptKey.current = null;
      setResult({ booking: made });
      refreshAll();
    } catch (error) {
      // Only a network failure keeps the key: we don't know if the booking went through.
      if (error.code !== "network") attemptKey.current = null;
      setResult({ error });
      // Not found or conflict means our lists are out of date.
      if (error.status === 404 || error.status === 409) refreshAll();
    } finally {
      setSubmitting(false);
      showSummary();
    }
  }

  function bookAnother() {
    choose(setItem, null);
  }

  // The same button is shown in the summary (wide screens) and in a bar fixed
  // to the bottom of the screen (everything narrower), so it is always within reach.
  const bookButton = (
    <button
      type="button"
      className={buttonClass("primary", { extra: "w-full" })}
      onClick={handleBook}
      disabled={Boolean(reason) || submitting}
    >
      {submitting && <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
      {submitting ? "Booking" : "Book"}
    </button>
  );

  return (
    <div>
      <section className="relative overflow-hidden rounded-[28px] bg-plum-deep px-6 py-8 text-white shadow-[0_26px_80px_-38px_rgba(33,19,41,0.8)] sm:px-9 sm:py-10 lg:rounded-[36px] lg:px-12">
        <div className="absolute -right-16 -top-44 size-[28rem] rounded-full bg-brass/14 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-brass-light">
              <Sparkles size={14} aria-hidden="true" />
              Private booking desk
            </p>
            <h1 className="mt-4 font-display text-[clamp(2.8rem,5vw,4.7rem)] font-medium leading-[0.94] tracking-[-0.045em]">
              Reserve the <span className="italic text-brass-pale">remarkable.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/60 sm:text-base">
              Choose a member and an experience. The places left are checked again the moment you press Book.
            </p>
          </div>
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.055] p-5 text-[11px] text-white/60 backdrop-blur-sm">
            <p className="flex items-center gap-2.5">
              <RotateCcw size={15} className="text-brass-light" aria-hidden="true" />
              Cancelling gives the place back straight away
            </p>
            <p className="flex items-center gap-2.5">
              <ShieldCheck size={15} className="text-brass-light" aria-hidden="true" />
              A maximum of {maxBookings} active bookings per member
            </p>
          </div>
        </div>
      </section>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-6">
          <Panel step="01">
            <MemberPicker
              selectedId={member?.id ?? null}
              onSelect={(chosen) => choose(setMember, chosen)}
              onLoaded={setMaxBookings}
              version={version}
              maxBookings={maxBookings}
            />
          </Panel>
          <Panel step="02">
            <ItemPicker selected={item} onSelect={(chosen) => choose(setItem, chosen)} version={version} />
          </Panel>
        </div>

        <aside ref={summaryRef} className="min-w-0 scroll-mt-4 space-y-4 lg:sticky lg:top-6">
          {result?.error && (
            <Banner tone="error" title="Not booked">
              {bookingErrorMessage(result.error, member, item)}
            </Banner>
          )}

          <BookingSummary member={member} item={item} booking={booking} maxBookings={maxBookings} />

          {/* Read out by screen readers when the booking is made. */}
          <p className="sr-only" role="status">
            {booking ? `Booked ${item?.title} for ${fullName(member)}.` : ""}
          </p>

          {booking ? (
            <button type="button" className={buttonClass("quiet", { extra: "w-full" })} onClick={bookAnother}>
              Book another experience
            </button>
          ) : (
            <>
              <div className="hidden lg:block">{bookButton}</div>
              {reason && <p className="text-sm text-ink-soft">{reason}</p>}
            </>
          )}

          {member && (
            <ActiveBookings key={member.id} member={member} version={version} onChanged={refreshAll} />
          )}
        </aside>
      </div>

      {/* Narrower than the two-column layout: the Book button stays at the bottom of the screen. */}
      {!booking && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 lg:hidden">
          <div className="mx-auto max-w-6xl">
            {reason && <p className="mb-2 text-center text-xs text-ink-soft">{reason}</p>}
            {bookButton}
          </div>
        </div>
      )}
    </div>
  );
}
