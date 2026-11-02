import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { cancelBooking, getMemberBookings } from "../api.js";
import { useLoad } from "../hooks/useLoad.js";
import { formatDate, fullName } from "../utils/format.js";
import { cancelErrorMessage } from "../utils/messages.js";
import { buttonClass } from "../utils/ui.js";
import Banner from "./Banner.jsx";
import ContourArt from "./ContourArt.jsx";

// The member's bookings that can still be cancelled. Cancelling takes two
// clicks so nobody cancels by accident.
//   version    goes up whenever something changed elsewhere, to reload the list
//   onChanged  called after a cancel, so the parent can refresh its numbers
// Render with key={member.id}, so each member starts with a clean state.
export default function ActiveBookings({ member, version, onChanged }) {
  const loader = useCallback(() => getMemberBookings(member.id), [member.id]);
  const { data, error, loading, reload } = useLoad(loader);

  const [confirming, setConfirming] = useState(null); // reference waiting for "Yes, cancel"
  const [busy, setBusy] = useState(null); // reference being cancelled right now
  const [notice, setNotice] = useState(null); // { tone, text }

  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current !== version) {
      seenVersion.current = version;
      reload();
    }
  }, [version, reload]);

  async function confirmCancel(booking) {
    setBusy(booking.reference);
    setNotice(null);
    try {
      await cancelBooking(member.id, booking.reference);
      setNotice({ tone: "success", text: `Booking for ${booking.item_title} cancelled.` });
      onChanged();
    } catch (failure) {
      setNotice({ tone: "error", text: cancelErrorMessage(failure) });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const bookings = data?.bookings ?? [];
  // Bookings that came from the imported file have no reference, so they can't be cancelled here.
  const imported = Math.max(0, member.active_booking_count - bookings.length);

  return (
    <section aria-labelledby="active-bookings-heading" className="rounded-[24px] bg-paper p-5 shadow-[0_18px_50px_-38px_rgba(33,19,41,0.4)] ring-1 ring-line sm:p-6">
      <h2 id="active-bookings-heading" className="font-display text-2xl font-medium tracking-[-0.02em]">
        Active bookings
      </h2>
      <p className="text-sm text-ink-soft">{fullName(member)}</p>

      {notice && (
        <div className="mt-3">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </div>
      )}

      <div className="mt-4">
        {loading && <div className="h-16 rounded-lg bg-plum/[0.05] motion-safe:animate-pulse" />}

        {error && !data && (
          <p className="text-sm text-ink-soft">
            The bookings couldn&rsquo;t be loaded.{" "}
            <button type="button" onClick={reload} className="font-semibold underline">
              Try again
            </button>
          </p>
        )}

        {data && bookings.length === 0 && <p className="text-sm text-ink-soft">No bookings made here yet.</p>}

        <ul className="space-y-2">
          {bookings.map((booking) => (
            <li
              key={booking.reference}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-pearl/35 p-3 ring-1 ring-line"
            >
              <div className="h-11 w-14 shrink-0 overflow-hidden rounded-xl">
                <ContourArt item={{ title: booking.item_title, id: booking.item_id }} className="size-full" />
              </div>
              <div className="min-w-0 flex-1 basis-32">
                <p className="truncate font-display text-lg font-medium leading-snug">{booking.item_title}</p>
                <p className="text-sm text-ink-soft">Booked {formatDate(booking.booked_at)}</p>
              </div>

              {confirming === booking.reference ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass("quiet", { size: "sm" })}
                    onClick={() => setConfirming(null)}
                    disabled={busy === booking.reference}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className={buttonClass("dangerSolid", { size: "sm" })}
                    onClick={() => confirmCancel(booking)}
                    disabled={busy === booking.reference}
                  >
                    {busy === booking.reference && (
                      <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
                    )}
                    Yes, cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={buttonClass("danger", { size: "sm" })}
                  onClick={() => {
                    setNotice(null);
                    setConfirming(booking.reference);
                  }}
                  aria-label={`Cancel booking for ${booking.item_title}`}
                >
                  <X size={14} aria-hidden="true" />
                  Cancel booking
                </button>
              )}
            </li>
          ))}
        </ul>

        {data && imported > 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            {imported} earlier {imported === 1 ? "booking" : "bookings"} came from the imported data and can&rsquo;t be
            cancelled here.
          </p>
        )}
      </div>
    </section>
  );
}
