"use client";

/* Bin night on the wall: one plain sentence ("Recycling goes out tonight") from 17:00 to 22:00 on the evening before a
   collection, nowhere else. The server decides which evening (GET /kiosk/api/bins, a date plus names); this file only
   decides whether that date is the server's `today` (the display zone's date) inside the evening period. Outside the window, on any other status, or while loading, both components return null: not an
   empty wrapper, because an empty child of the Glance stack's gap-6 or Standard's space-y-3 still costs 24 or 12 px.
   No motion: the line arrives with the period change that already re-renders the surface. No tone: a chore is not a
   crossed threshold, so it never goes warn. */

import useSWR from "swr";
import { Trash } from "lucide-react";
import { fetcher } from "@/lib/client";
import { localDateKey } from "@/lib/climate-auto-off";
import { useNow } from "@/lib/use-now";
import { binLineSegments, binsTonight, type BinsResponse } from "@/lib/bin-night";
import type { KioskPeriod } from "@/components/kiosk/kiosk-display";

const BINS_REFRESH_MS = 30 * 60_000;

/** The bin names due tonight, or null. Fetches only in the evening window (a null key stops SWR outright); focus (a wake) revalidates. */
export function useBinNight(period: KioskPeriod): string[] | null {
  const { data } = useSWR<BinsResponse>(period === "evening" ? "/kiosk/api/bins" : null, fetcher, { refreshInterval: BINS_REFRESH_MS });
  const now = useNow(true, true); // 0 until mounted: no date, nothing shown
  return period === "evening" && now ? binsTonight(data, localDateKey(new Date(now))) : null;
}

/** The sentence: names in ink, medium weight; the rest dim. */
function Sentence({ names }: { names: string[] }) {
  return (
    <>
      {binLineSegments(names).map((s, i) => (
        <span key={i} className={s.name ? "font-medium text-ink" : undefined}>
          {s.text}
        </span>
      ))}
    </>
  );
}

/** Glance: line 1 of the below-band stack, in the outlook's classes plus `truncate`; drops with the other prose on a short viewport. */
export function BinNightLine({ period }: { period: KioskPeriod }) {
  const names = useBinNight(period);
  if (!names) return null;
  return (
    // Same rain-mask zone as the rest of the centre column (same-named rects union).
    <div data-rain-zone="sentence" className="[@media(max-height:700px)]:hidden">
      <p data-bin-night="line" className="max-w-xl truncate text-center text-base text-ink-dim">
        <Trash size={16} aria-hidden className="mr-2 inline-block align-middle" />
        <Sentence names={names} />
      </p>
    </div>
  );
}

/** Standard: the row between the weather band and the briefing. */
export function BinNightRow({ period }: { period: KioskPeriod }) {
  const names = useBinNight(period);
  if (!names) return null;
  return (
    <p data-bin-night="row" className="truncate text-sm text-ink-dim">
      <Trash size={12} aria-hidden className="mr-1.5 inline-block align-middle" />
      <Sentence names={names} />
    </p>
  );
}
