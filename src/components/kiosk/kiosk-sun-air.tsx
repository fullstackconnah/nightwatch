"use client";

/* THESIS: the glance band's `sun-air` pane (direction A "Figure"): today's peak
   UV as the forecast rail's own glance figure, plus the air word beside it.
   Presentational only — kiosk-sun-air.ts decides every word, tone and whether
   the pane exists; the widget in kiosk-widgets.tsx reports the drop. No role,
   button or handler: a press on the pane promotes glance to Standard like any
   other pane. Meaning is never colour alone: the tone figure and air word sit beside a band word kept in ink. */

import { SIZE } from "@/components/kiosk/kiosk-forecast";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import type { SunAirTone, SunAirView } from "@/lib/kiosk-sun-air";

const TONE: Record<SunAirTone, string> = { none: "text-ink", warn: "text-warn", bad: "text-bad" };

function Caption({ text, stale }: { text: string; stale: boolean }) {
  // h-6 holds the row so the sunroom stale pill (24 px) shifts nothing.
  return (
    <div className="flex h-6 items-center justify-center gap-2">
      <span className="microlabel">{text}</span>
      {stale && <StaleTag />}
    </div>
  );
}

export function KioskSunAir({ glance, sr, stale }: { glance: NonNullable<SunAirView["glance"]>; sr: string; stale: boolean }) {
  const sunroom = useKioskTheme() === "sunroom";
  const { uv, air } = glance;
  const fade = sunroom ? "sr-fade-in" : "";
  const [airLead, airNum] = air?.sub.split(" ") ?? [];
  return (
    <div data-sun-air="" className="flex w-full max-w-xl items-start justify-center gap-12 text-center">
      <span className="sr-only">
        {sr}
        {stale ? " Not updated recently." : ""}
      </span>
      {uv && (
        <div data-sun-col="uv" aria-hidden className="flex min-w-0 flex-col items-center gap-1">
          <Caption text={uv.caption} stale={stale} />
          <div key={sunroom ? `${uv.figure}|${uv.word}` : undefined} className={`flex min-h-8 items-baseline justify-center gap-2 ${fade}`}>
            <span data-sun-figure="" className={`font-mono leading-none tabular-nums ${SIZE.glance.temp} ${TONE[uv.tone]}`}>{uv.figure}</span>
            <span data-sun-band="" className="text-xl text-ink">{uv.word}</span>
          </div>
          <div className="text-xl text-ink-dim">{uv.sub}</div>
        </div>
      )}
      {air && (
        <div data-sun-col="air" aria-hidden className="flex min-w-0 flex-col items-center gap-1">
          <Caption text={air.caption} stale={stale && !uv} />
          <div key={sunroom ? air.word : undefined} className={`flex min-h-8 items-baseline justify-center ${fade}`}>
            {/* Zero-width strut in the figure's font so this row shares the UV row's line box and baseline. */}
            <span aria-hidden className={`font-mono leading-none ${SIZE.glance.temp}`}>{"​"}</span>
            <span data-sun-air-word="" className={`text-xl ${TONE[air.tone]}`}>{air.word}</span>
          </div>
          <div className="text-xl text-ink-dim">
            {airLead} <span className="font-mono">{airNum}</span>
          </div>
        </div>
      )}
    </div>
  );
}
