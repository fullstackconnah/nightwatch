"use client";

import { forwardRef } from "react";
import { formatWallClock } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

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
 *  other ticking value in the app.
 *
 *  `size` + the forwarded ref exist for the merged surface (redesign-06
 *  §5): this is the SAME DOM node in glance and full mode, registered by
 *  the caller via useFlipGroup(mode).register("clock") — only classes
 *  change here, never the node's identity, or FLIP has nothing to animate
 *  across (see kiosk-surface.tsx). "full" mirrors the old status strip's
 *  compact inline baseline (time + date on one line); "glance" is the
 *  original huge stacked wall-clock reading, unchanged. */
export const KioskClock = forwardRef<HTMLDivElement, { size: "glance" | "full" }>(function KioskClock(
  { size },
  ref,
) {
  const now = useNow(true);
  const date = now === 0 ? null : new Date(now);
  const full = size === "full";
  const clock = date ? formatWallClock(date) : null;

  return (
    <div ref={ref} className={cn("select-none", full ? "flex items-baseline gap-2.5" : "text-center")}>
      <div
        className={cn(
          "font-mono tabular-nums leading-none text-ink",
          full ? "text-lg md:text-xl" : "text-[4.5rem] min-[420px]:text-[5.5rem] md:text-[7rem]",
        )}
      >
        {clock ? clock.time : "--:--"}
        {/* Sized off the digits it trails rather than the ramp: the am/pm marker
            is a qualifier on the reading, and at the glance clock's scale it has
            to stay subordinate or it competes with the hour for the eye. `ml`
            replaces the locale's own space so the gap does not scale with it. */}
        {clock && (
          <span className={cn("text-ink-dim", full ? "ml-1 text-[0.7em]" : "ml-2 text-[0.32em]")}>
            {clock.period}
          </span>
        )}
      </div>
      <div
        className={cn(
          full ? "hidden text-2xs text-ink-dim sm:inline" : "mt-2 text-sm md:text-base text-ink-dim",
        )}
      >
        {date ? dateFormatter.format(date) : " "}
      </div>
    </div>
  );
});
