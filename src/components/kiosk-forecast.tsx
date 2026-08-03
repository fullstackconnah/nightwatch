"use client";

/* THESIS: the forecast used to be a labelled block of its own — a
   "5-Day Forecast" microlabel sitting on its own line, then a grid of
   bordered boxes underneath (kiosk-display.tsx's old ForecastStrip) —
   which is exactly the chrome-down/type-up redesign is removing: ~110px
   of vertical space and a box per day nobody needs to touch. This is one
   row. The caption is the row's first cell, not a heading stacked above
   it, so the "5-Day" line disappears as a line and reappears as 40px of
   width instead. Separation between days comes from `divide-x` hairlines
   (spacing + a rule, never a bg tint or a border box), and emphasis (the
   evening's "tomorrow" column) is ink colour only — the old
   `border-accent/40 bg-accent/10` treatment is exactly the tinted-box
   pattern the redesign contract bans.

   Narrow widths drop columns via plain min-width variants (`hidden` →
   `min-[Npx]:flex`) rather than wrapping or scrolling — the row either
   fits or a column disappears, decided by CSS at layout time, never
   measured in JS. The caption + Today + the next day are unconditional
   (that trio is what's left once nothing else fits); the 3rd/4th/5th
   columns reveal at breakpoints wide enough for what's already on screen
   to actually fit alongside them — measured empirically in a real
   browser across 390–1440px (min-content, not estimated from font
   metrics), because `document.documentElement.scrollWidth` doesn't catch
   overflow here: on the full-mode call site the rail sits inside a
   `position: sticky` ancestor, and sticky subtrees don't propagate into
   document scroll width even when their own content is clipped. */

import { cn } from "@/lib/utils";
import { WEATHER_ICON, type WeatherDay } from "@/components/kiosk-display";

const DAY_FMT = new Intl.DateTimeFormat("en-AU", { weekday: "short" });

function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : DAY_FMT.format(d);
}

type RailSize = "full" | "glance";

/* Two type ramps, not a runtime scale factor — but only from 480px up.
   `size="glance"` steps every figure ~25% bigger than `size="full"`'s
   floor (the glance board is read from further across the room), using
   arbitrary values rather than the next Tailwind step so the ratio stays
   the specific number the redesign contract names. Below 480px both
   sizes render at `full`'s own floor: that's the phone-width regression
   check, not the primary (iPad) target, and measurement showed even the
   floor size only just fits two columns + the caption at 390px — glance's
   bigger glyphs have no room to spare there. `min-[480px]:` variants on
   the label/temp/rain spans carry the jump; nothing about `full`'s own
   sizing changes at any width. Each size also carries its own column
   breakpoints, offset to match where its *current* type (floor below
   480px, the 25%-bigger ramp above it) actually has room — measured in a
   real browser, not estimated from font metrics. */
const SIZE: Record<
  RailSize,
  {
    label: string;
    temp: string;
    rain: string;
    icon: string;
    revealThird: string;
    revealFourth: string;
    revealFifth: string;
  }
> = {
  full: {
    label: "text-sm", // 0.875rem — the spec's label floor
    temp: "text-lg", // 1.125rem — the spec's temp floor
    rain: "text-2xs",
    icon: "h-3 w-3",
    revealThird: "hidden min-[560px]:flex",
    revealFourth: "hidden min-[720px]:flex",
    revealFifth: "hidden min-[900px]:flex",
  },
  glance: {
    label: "text-sm min-[480px]:text-[1.09375rem]", // floor below 480px, 0.875rem * 1.25 above it
    temp: "text-lg min-[480px]:text-[1.40625rem]", // floor below 480px, 1.125rem * 1.25 above it
    rain: "text-2xs min-[480px]:text-[0.875rem]", // floor below 480px, 0.7rem * 1.25 above it
    icon: "h-3 w-3 min-[480px]:h-[1.125rem] min-[480px]:w-[1.125rem]",
    revealThird: "hidden min-[660px]:flex",
    revealFourth: "hidden min-[840px]:flex",
    revealFifth: "hidden min-[1010px]:flex",
  },
};

export function KioskForecastRail({
  days,
  emphasizeIndex,
  size,
}: {
  days: WeatherDay[];
  emphasizeIndex: number | null;
  size: RailSize;
}) {
  const s = SIZE[size];

  return (
    <div data-testid="kiosk-forecast-rail" className={cn("flex items-center divide-x divide-line", "overflow-hidden")}>
      {/* The caption always fits (measured, including at 390px) — only the
          3rd/4th/5th day columns ever need to hide for room. */}
      <h3 className="microlabel shrink-0 pr-1">5-Day</h3>
      {days.map((day, i) => {
        const Icon = WEATHER_ICON[day.code];
        const emphasized = i === emphasizeIndex;
        // Only Today + the next day are unconditional. The 3rd/4th/5th
        // columns reveal at widths wide enough for what's already on
        // screen to actually fit alongside them (measured, not guessed) —
        // "5 → 4 → 3" from the wide end, "→ 2" is the floor at phone width.
        const visibility = i === 2 ? s.revealThird : i === 3 ? s.revealFourth : i === 4 ? s.revealFifth : "flex";
        return (
          <div key={day.date} className={cn(visibility, "shrink-0 items-center gap-x-[1px] pl-1")}>
            <span className={cn(s.label, emphasized ? "text-accent" : "text-ink-dim")}>
              {dayLabel(day.date, i)}
            </span>
            <Icon className={cn(s.icon, emphasized ? "text-accent" : "text-ink-dim")} aria-hidden />
            <span className={cn("font-mono leading-none text-ink", s.temp)}>
              {Math.round(day.maxC)}°<span className="text-ink-faint">/{Math.round(day.minC)}°</span>
            </span>
            {/* Visually just a number — the old per-day Droplets icon is
                gone (the spec's one icon per day is the weather icon), so
                the percentage needs its own aria-label to still read as a
                rain probability rather than a bare "20%" to a screen
                reader. */}
            <span className={cn(s.rain, "text-ink-faint")} aria-label={`${day.rainPct}% chance of rain`}>
              {day.rainPct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
