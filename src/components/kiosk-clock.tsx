"use client";

import { useNow } from "@/lib/use-now";

const timeFormatter = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** The one figure this whole surface exists to report from across a room —
 *  bigger than anything the logged-in dashboard ever sets, but still mono,
 *  tabular and built from the same DESIGN.md ramp (an arbitrary size, not a
 *  new token). `useNow`'s server snapshot is 0 ("not yet known"), so this
 *  renders a placeholder until the first client tick lands, same as every
 *  other ticking value in the app. */
export function KioskClock() {
  const now = useNow(true);
  const date = now === 0 ? null : new Date(now);

  return (
    <div className="text-center select-none">
      <div className="font-mono tabular-nums leading-none text-ink text-[4.5rem] min-[420px]:text-[5.5rem] md:text-[7rem]">
        {date ? timeFormatter.format(date) : "--:--:--"}
      </div>
      <div className="mt-2 text-sm md:text-base text-ink-dim">
        {date ? dateFormatter.format(date) : " "}
      </div>
    </div>
  );
}
