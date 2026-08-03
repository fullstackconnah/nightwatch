"use client";

/* THESIS: five days, five distinct objects. The previous rail put every day
   on one horizontal line — `Today🌧13°/7°87% │ Tue🌧11°/5°100%` — so the eye
   had no way to chunk one day from the next at 2-3m: the dividers were doing
   all the separating work and a hairline is not enough separation for a wall.
   Each day is now a small stack (identifier / condition+high / low+rain), and
   the stack itself is the boundary — whitespace and a shared column rhythm,
   never a BORDER, because on this surface a border is reserved for a touch
   target or an alert. Each cell does now carry a few-percent wash of its own
   weather (DAY_TINT below), added later: that gives the week a readable shape
   at 3m before any number is parsed, and a wash is not a box — it has no edge
   to mistake for a control.

   ONLY WHAT'S REQUIRED: high, low and the icon always earn their place. Rain
   probability does not — a row of `87% 100% 86% 38% 7%` makes five numbers
   compete when at most one of them changes anyone's behaviour. It appears
   only at RAIN_THRESHOLD_PCT and above, so a dry day reads as dry by the
   absence of a figure, and a wet one is the only percentage on screen. The
   `5-Day` caption is gone too: the first column says "Today" and the rest say
   weekdays, which is the caption, spelled out.

   Narrow widths still drop whole columns via plain min-width variants rather
   than wrapping or scrolling. Note that `document.documentElement.scrollWidth`
   does NOT catch overflow at the full-mode call site: the rail sits inside a
   `position: sticky` ancestor, and sticky subtrees don't propagate their
   overflow into document scroll width even when clipped — so the reveal
   breakpoints below were measured per-cell in a real browser
   (getBoundingClientRect against the rail's own box), never estimated. */

import { cn } from "@/lib/utils";
import { WEATHER_ICON, type WeatherDay } from "@/components/kiosk-display";

const DAY_FMT = new Intl.DateTimeFormat("en-AU", { weekday: "short" });

/** Below this, a rain probability is noise on a glance surface: it doesn't
 *  change whether anyone takes a coat, and printing it costs the same visual
 *  weight as the figure that would. Chosen (rather than 20 or 50) because it
 *  is roughly where a forecast stops reading as "dry" — low enough to still
 *  flag a genuinely uncertain day, high enough that a settled week shows no
 *  percentages at all. */
const RAIN_THRESHOLD_PCT = 30;

/* DAY TINTS: each cell carries a wash of its own weather, so the week reads
   as a gradient of sky before any number is read — a run of grey with one
   blue Friday is a shape you take in at 3m, which five identical cells are
   not.

   These are token references, never literals, for the reason DESIGN.md gives:
   a hex that matches today desyncs the moment the token moves, and this rail
   renders under all 16 themes plus sunroom's live solar palette, where the
   ground beneath it is a different colour every hour. `color-mix` toward
   `transparent` means each tint is a fraction of a colour the active theme
   already chose, so it can never fight its own background.

   Kept at a few percent on purpose. This is a backdrop for the temperature
   sitting on top of it: the moment a tint is strong enough to notice as a
   colour, it is too strong to read a number through. */
/* Typed against WeatherDay["code"] rather than `string`: the first draft of
   this table keyed a storm as `thunder` when the real code is
   `thunderstorm`, which a string-keyed record accepts silently and renders as
   an untinted cell. With the union as the key, a wrong or missing code is a
   compile error. */
const DAY_TINT: Record<WeatherDay["code"], string> = {
  clear: "color-mix(in srgb, var(--color-blue) 10%, transparent)",
  cloudy: "color-mix(in srgb, var(--color-ink-faint) 9%, transparent)",
  "partly-cloudy": "color-mix(in srgb, var(--color-ink-faint) 5%, transparent)",
  fog: "color-mix(in srgb, var(--color-ink-faint) 11%, transparent)",
  drizzle: "color-mix(in srgb, var(--color-blue) 13%, transparent)",
  rain: "color-mix(in srgb, var(--color-blue) 17%, transparent)",
  showers: "color-mix(in srgb, var(--color-blue) 15%, transparent)",
  snow: "color-mix(in srgb, var(--color-ink) 8%, transparent)",
  thunderstorm: "color-mix(in srgb, var(--color-warn) 12%, transparent)",
};

function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : DAY_FMT.format(d);
}

type RailSize = "full" | "glance";

/* Two type ramps rather than a runtime scale factor. `glance` steps up from
   480px (the wall board is read from further back); below that both sizes sit
   on `full`'s floor, since 390px is the phone regression check and glance's
   bigger glyphs have no room to spare there. Each size carries its own column
   reveal points, offset to where its own type actually fits. */
const SIZE: Record<
  RailSize,
  { day: string; temp: string; low: string; icon: string; gap: string; revealFourth: string; revealFifth: string }
> = {
  full: {
    day: "text-xs",
    temp: "text-xl",
    low: "text-xs",
    icon: "h-4 w-4",
    gap: "gap-x-5",
    revealFourth: "hidden min-[560px]:flex",
    revealFifth: "hidden min-[680px]:flex",
  },
  glance: {
    day: "text-xs min-[480px]:text-sm",
    temp: "text-xl min-[480px]:text-3xl",
    low: "text-xs min-[480px]:text-base",
    icon: "h-4 w-4 min-[480px]:h-6 min-[480px]:w-6",
    gap: "gap-x-5 min-[480px]:gap-x-8",
    revealFourth: "hidden min-[640px]:flex",
    revealFifth: "hidden min-[820px]:flex",
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
    <div
      data-testid="kiosk-forecast-rail"
      className={cn("flex items-start overflow-hidden", s.gap)}
    >
      {days.map((day, i) => {
        const Icon = WEATHER_ICON[day.code];
        const emphasized = i === emphasizeIndex;
        const wet = day.rainPct >= RAIN_THRESHOLD_PCT;
        // Today and the next two are unconditional — that trio is what
        // survives at phone width. The 4th and 5th reveal where they measurably
        // fit alongside what's already on screen.
        const visibility = i === 3 ? s.revealFourth : i === 4 ? s.revealFifth : "flex";
        return (
          <div
            key={day.date}
            /* The tint needs a box to sit in, and the cells had none — they
               were bare flex columns separated by gap alone, which was the
               right call when there was nothing to paint. `-mx-1 px-1` widens
               the painted area back over half the gap so the wash reads as a
               column of sky rather than a label with a highlight behind it,
               without changing where anything actually sits. */
            className={cn(visibility, "shrink-0 flex-col items-center rounded-md -mx-1 px-1 py-0.5")}
            style={{ backgroundColor: DAY_TINT[day.code] }}
          >
            <span
              className={cn(
                s.day,
                "font-semibold uppercase tracking-wider",
                emphasized ? "text-accent" : "text-ink-dim",
              )}
            >
              {dayLabel(day.date, i)}
            </span>

            <span className="mt-0.5 flex items-center gap-1.5">
              <Icon className={cn(s.icon, emphasized ? "text-accent" : "text-ink-dim")} aria-hidden />
              <span className={cn("font-mono leading-none text-ink", s.temp)}>{Math.round(day.maxC)}°</span>
            </span>

            <span className={cn("mt-0.5 flex items-baseline gap-1.5 font-mono leading-none", s.low)}>
              <span className="text-ink-faint">{Math.round(day.minC)}°</span>
              {/* Below the threshold this renders nothing at all — the absence
                  IS the reading. `text-blue` (not ink) so the one percentage on
                  a settled week is unmistakably the wet day. */}
              {wet && (
                <span className="text-blue" aria-label={`${day.rainPct}% chance of rain`}>
                  {day.rainPct}%
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
