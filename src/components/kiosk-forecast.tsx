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
import { KioskRadarModal, useKioskRadar } from "@/components/kiosk-radar";

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
  onTodayClick,
}: {
  days: WeatherDay[];
  emphasizeIndex: number | null;
  size: RailSize;
  /** Opens the weather-radar modal when the Today cell is tapped. Optional
   *  because kiosk-surface.tsx (the only current caller, and a file this
   *  feature cannot edit) doesn't pass one — when absent, the Today button
   *  manages its own modal via useKioskRadar()/KioskRadarModal below rather
   *  than the feature silently not working. See kiosk-radar.tsx's own THESIS
   *  for why. */
  onTodayClick?: () => void;
}) {
  const s = SIZE[size];
  const radar = useKioskRadar();
  const openRadar = onTodayClick ?? radar.open;
  // Only render the self-managed modal on the fallback path — a caller that
  // supplies its own onTodayClick is presumed to own showing a radar view
  // itself, and rendering ours too would be two modals fighting over one tap.
  const selfManaged = !onTodayClick;

  return (
    <>
      <div
        data-testid="kiosk-forecast-rail"
        className={cn("flex items-start overflow-hidden px-1 -mx-1", s.gap)}
      >
        {days.map((day, i) => {
          const Icon = WEATHER_ICON[day.code];
          const emphasized = i === emphasizeIndex;
          const wet = day.rainPct >= RAIN_THRESHOLD_PCT;
          // Today and the next two are unconditional — that trio is what
          // survives at phone width. The 4th and 5th reveal where they measurably
          // fit alongside what's already on screen.
          const visibility = i === 3 ? s.revealFourth : i === 4 ? s.revealFifth : "flex";
          const isToday = i === 0;

          /* The tint needs a box to sit in, and the cells had none — they
             were bare flex columns separated by gap alone, which was the
             right call when there was nothing to paint. `-mx-1 px-1` widens
             the painted area back over half the gap so the wash reads as a
             column of sky rather than a label with a highlight behind it,
             without changing where anything actually sits.

             That bleed is invisible on interior cells (it just eats into
             the gap either side), but the FIRST and LAST cell have no
             neighbour to bleed into on their outer side — their `-mx-1`
             instead pushes the painted, rounded box 4px past the rail's own
             edge, and the rail's `overflow-hidden` (needed below) clipped
             exactly that overhang, shaving the outer rounded corners off
             Today and the last visible day. Interior cells were never
             touched, which is why only the two ends looked wrong. The rail
             container now carries a matching `px-1 -mx-1`: the padding
             moves its clip boundary out by 4px so the overhang lands inside
             it instead of past it, and the negative margin cancels the
             padding's own footprint so the rail measures the same to
             everything around it (and so every reveal breakpoint above,
             measured against the rail's old box, still holds). Remove
             either half on its own and the clipping comes back — on the
             container if you drop `px-1`, on these cells if you ever drop
             their `-mx-1` while leaving the container's compensation in
             place. This geometry is unchanged by the Today cell becoming a
             <button> below — it carries the exact same classes, just with a
             handful of UA-default resets added (border-0/bg-transparent/
             text-left/outline-none) that touch no box-model property this
             comment depends on. */
          const cellClassName = cn(visibility, "shrink-0 flex-col items-center rounded-md -mx-1 px-1 py-0.5");

          const content = (
            <>
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
            </>
          );

          if (isToday) {
            return (
              <button
                key={day.date}
                type="button"
                onClick={openRadar}
                aria-label="Open the weather radar for today"
                // appearance-none/border-0/bg-transparent/text-left strip the
                // handful of UA <button> defaults (inset border, system font
                // sizing already handled by preflight, left-align) that a
                // <div> never had — none of them touch padding/margin, which
                // px-1/py-0.5/-mx-1 already fully specify on every side, so
                // the box this button occupies is pixel-identical to the old
                // <div>. NOTE: the rail itself is only 28-64px tall (SIZE
                // above), well under the 44px touch-floor convention this
                // codebase otherwise holds controls to — inflating the rail
                // to hit that floor would reintroduce the header FLIP-
                // measurement fragility the box-geometry comment above
                // documents, so this button is deliberately an exception
                // rather than a reason to grow the rail.
                className={cn(
                  cellClassName,
                  "appearance-none border-0 bg-transparent text-left outline-none focus-visible:ring-1 focus-visible:ring-accent",
                )}
                style={{ backgroundColor: DAY_TINT[day.code] }}
              >
                {content}
              </button>
            );
          }

          return (
            <div key={day.date} className={cellClassName} style={{ backgroundColor: DAY_TINT[day.code] }}>
              {content}
            </div>
          );
        })}
      </div>
      {selfManaged && radar.isOpen && <KioskRadarModal onClose={radar.close} />}
    </>
  );
}
