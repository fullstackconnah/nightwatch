"use client";

/* The appearance picker for the elevated kiosk: layout (2 options) + theme
   (16 options). Rebuilt from the impeccable layout assessment, which found
   the old version's failures in order of severity: an unwrappable 16-button
   row (guaranteed horizontal overflow), no panel anchoring between two real
   panels, sixteen identical text pills carrying zero visual information
   about radically different identities, the catalog's own four-family
   taxonomy flattened away, and an active state too quiet to pick out of 16
   siblings at kiosk distance.

   Answers, in the same order: chips wrap inside each family row; the whole
   control lives in one .panel (DESIGN.md's segmented-control idiom for the
   layout pair — padded panel-2 track, not per-button borders); every theme
   chip leads with a swatch of its real ground + accent (KIOSK_THEME_SWATCHES);
   the KIOSK_THEME_GROUPS families become microlabel-headed rows (tight gap-2
   inside a family, roomier gap-4 between families — rhythm, not monotony);
   the active chip gets a full-strength accent ring on top of the tint.

   redesign-06 §5 repurposes the stored "glance"/"standard" pair rather than
   replacing it: the device-local choice still decides between a merged,
   auto-returning surface and a pinned one, it just isn't a straight layout
   swap anymore (kiosk-surface.tsx handles both from one component). "Auto"
   is the new default meaning of "glance" — the surface rests as the wall
   clock and animates to the full view on any touch, then idles back —
   while "Always full" ("standard") opts a bench/desk device permanently
   into the compact view with no auto-return. Same two-option segmented
   control, same stored values, just relabelled so the copy matches what
   picking each one now actually does. */

import { cn } from "@/lib/utils";
import {
  KIOSK_THEME_GROUPS,
  KIOSK_THEME_LABELS,
  KIOSK_THEME_SWATCHES,
  setKioskTheme,
  useKioskTheme,
  type KioskTheme,
} from "@/components/kiosk-theme";

export type KioskLayoutChoice = "standard" | "glance";

function ThemeChip({ theme, active }: { theme: KioskTheme; active: boolean }) {
  const swatch = KIOSK_THEME_SWATCHES[theme];
  return (
    <button
      type="button"
      onClick={() => setKioskTheme(theme)}
      aria-pressed={active}
      className={cn(
        "flex h-11 items-center gap-2 rounded-md border px-3 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
        active
          ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
          : "border-line text-ink-dim hover:border-line-bright hover:text-ink",
      )}
    >
      {/* The chip's one job: show the identity before it's applied. Ground
          disc with the accent as a setting-sun dot; hairline keeps light
          swatches visible on the dark panel. */}
      <span
        aria-hidden
        className="relative h-5 w-5 shrink-0 rounded-full border border-line-bright"
        style={{ backgroundColor: swatch.bg }}
      >
        <span
          className="absolute bottom-0 right-0 h-2 w-2 rounded-full"
          style={{ backgroundColor: swatch.accent }}
        />
      </span>
      {KIOSK_THEME_LABELS[theme]}
    </button>
  );
}

export function KioskAppearance({
  layout,
  onLayoutChange,
}: {
  layout: KioskLayoutChoice;
  onLayoutChange: (next: KioskLayoutChoice) => void;
}) {
  const theme = useKioskTheme();

  return (
    <section className="panel flex w-full flex-col gap-4 p-4">
      {/* Layout: the binary decision gets the system's real segmented
          control — a padded panel-2 track — visually distinct from the
          16-way chip field below. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="microlabel">appearance</span>
        <div className="flex rounded-lg bg-panel-2 p-1" role="group" aria-label="Kiosk auto-return">
          {(["glance", "standard"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onLayoutChange(option)}
              aria-pressed={layout === option}
              className={cn(
                "h-11 rounded-md px-5 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-accent",
                layout === option ? "bg-panel text-ink shadow-sm ring-1 ring-line-bright" : "text-ink-dim hover:text-ink",
              )}
            >
              {option === "glance" ? "Auto" : "Always full"}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-1 text-2xs text-ink-faint">
        Auto rests as the wall clock and wakes to the full view on a touch. Always full stays on the
        full view and never returns on its own — for a bench or desk device.
      </p>

      <div aria-hidden className="h-px bg-line" />

      <div className="flex flex-col gap-4">
        {KIOSK_THEME_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <span className="microlabel">{group.label}</span>
            <div className="flex flex-wrap gap-2">
              {group.themes.map((t) => (
                <ThemeChip key={t} theme={t} active={theme === t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
