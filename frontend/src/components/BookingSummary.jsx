import { useState } from "react";
import { Check, CheckCircle2, Copy } from "lucide-react";
import { formatDate, fullName, shortReference } from "../utils/format.js";
import Avatar from "./Avatar.jsx";
import ContourArt from "./ContourArt.jsx";

function Allowance({ used, max }) {
  const over = used > max;
  return (
    <div className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`size-2.5 rounded-full ${i < used ? (over ? "bg-wine" : "bg-plum") : "ring-1 ring-slate/50"}`}
          />
        ))}
      </span>
      {over ? `Holds ${used} bookings, above the maximum of ${max}` : `${used} of ${max} bookings used`}
    </div>
  );
}

function EmptyArt() {
  return (
    <div className="grid h-full place-items-center bg-plum/[0.04] [background-image:radial-gradient(circle,rgba(53,32,64,0.16)_1px,transparent_1px)] [background-size:16px_16px]">
      <p className="rounded-full bg-paper px-4 py-2 text-sm text-ink-soft ring-1 ring-line">Choose an experience</p>
    </div>
  );
}

// The summary of the booking being made. Once it is booked, a confirmation
// with the reference appears at the bottom.
export default function BookingSummary({ member, item, booking, maxBookings }) {
  const [copied, setCopied] = useState(false);

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(booking.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked by the browser: the full reference is on screen to select.
    }
  }

  return (
    <section aria-label="Booking summary" className="overflow-hidden rounded-[24px] bg-paper shadow-[0_22px_65px_-40px_rgba(33,19,41,0.55)] ring-1 ring-line">
      <div className="relative aspect-[16/7] overflow-hidden">
        {item ? <ContourArt item={item} className="size-full" /> : <EmptyArt />}
        {item && (
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/35 to-transparent px-5 py-4 text-white">
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/75">Selected experience</span>
          </div>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate">Experience</p>
          <p className={`mt-1.5 font-display text-3xl font-medium leading-tight tracking-[-0.025em] ${item ? "" : "text-slate/60"}`}>
            {item ? item.title : "Not yet chosen"}
          </p>
          {item && <p className="mt-1 text-sm text-ink-soft">Available until {formatDate(item.expiration_date)}</p>}
        </div>

        <hr className="border-line" />

        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate">Member</p>
          {member ? (
            <>
              <div className="mt-2 flex items-center gap-3">
                <Avatar member={member} className="size-11 text-xl" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{fullName(member)}</p>
                  <p className="text-sm text-ink-soft">Joined {formatDate(member.date_joined)}</p>
                </div>
              </div>
              <Allowance used={member.active_booking_count} max={maxBookings} />
            </>
          ) : (
            <p className="mt-1 font-display text-2xl font-medium text-slate/60">Not yet chosen</p>
          )}
        </div>
      </div>

      {booking ? (
        // key: a new booking remounts this, so it settles into place again.
        <div
          key={booking.reference}
          className="border-t border-white/10 bg-plum-deep px-5 py-6 text-white motion-safe:animate-settle sm:px-6"
        >
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-brass-pale">
            <CheckCircle2 size={18} aria-hidden="true" />
            Booking confirmed
          </p>
          <p className="mt-5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">Booking reference</p>
          <div className="flex items-center justify-between gap-3">
            <p className="mt-1 font-display text-3xl font-medium tabular-nums tracking-[0.08em] text-white sm:text-4xl">
              {shortReference(booking.reference)}
            </p>
            <button
              type="button"
              onClick={copyReference}
              aria-label={copied ? "Reference copied" : "Copy full reference"}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/8 text-white ring-1 ring-white/20 transition hover:bg-white/15 hover:ring-white/35"
            >
              {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
            </button>
          </div>
          <p className="mt-2 select-all break-all text-[10px] text-white/35">{booking.reference}</p>
        </div>
      ) : (
        <div className="border-t border-line bg-pearl/65 px-5 py-4 sm:px-6">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate">Booking reference</p>
          <p className="mt-1 text-sm text-ink-soft">Shown here once the booking is made.</p>
        </div>
      )}
    </section>
  );
}
