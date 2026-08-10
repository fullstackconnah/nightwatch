/**
 * Formatters and control-surface class strings shared by the climate tile
 * (kiosk-climate.tsx) and its modal (kiosk-climate-modal.tsx).
 *
 * Extracted so the modal can be its own module without importing back from
 * the tile — that direction would close a cycle, since the tile is what
 * renders the modal.
 */

export const NUDGE_STEP = 0.5;

export const HVAC_LABEL: Record<string, string> = {
  off: "Off",
  heat: "Heat",
  cool: "Cool",
  heat_cool: "Range",
  auto: "Auto",
  dry: "Dry",
  fan_only: "Fan",
};

export function formatTemp(v: number | null, unit: string | null): string {
  if (v == null) return "—";
  // HA's unit_of_measurement for a climate entity is typically already the
  // full "°C"/"°F" (confirmed against a real HA response, not just a bare
  // letter) — unconditionally prepending our own "°" on top of that rendered
  // "21.5°°C" everywhere. Production's own climate entities happen to report
  // no unit at all, which is why that doubling never showed up there; the
  // fix has to hold for both a populated and an empty/null unit. Trim stray
  // whitespace HA sometimes includes, and only add the degree ourselves when
  // the unit doesn't already carry one.
  const unitTrimmed = (unit ?? "").trim();
  const degree = unitTrimmed.startsWith("°") ? "" : "°";
  return `${v.toFixed(1)}${degree}${unitTrimmed}`;
}

/** A heat_cool range is ONE reading, not two. Rendering the low and high as
 *  separate stacked lines dropped the relationship between them entirely —
 *  "19.0°C" above "22.0°C" scans as two unrelated numbers rather than a band.
 *  One line, an en dash, and the unit stated once at the end. */
export function formatTempRange(low: number | null, high: number | null, unit: string | null): string {
  // Either bound missing means this isn't really a range — fall back to
  // whichever value exists rather than rendering a half-open "19.0–—".
  if (low == null || high == null) return formatTemp(low ?? high, unit);
  const unitTrimmed = (unit ?? "").trim();
  const degree = unitTrimmed.startsWith("°") ? "" : "°";
  return `${low.toFixed(1)}–${high.toFixed(1)}${degree}${unitTrimmed}`;
}

/** HA's fan/preset/swing mode strings ("Level 2", "eco", "on") arrive in
 *  whatever case the integration chose — HVAC_LABEL is a hand-picked map
 *  because there are only 7 hvac modes total, but fan/preset/swing are
 *  per-unit and open-ended, so this just capitalizes the first letter
 *  ("eco" -> "Eco") rather than hardcoding a table for values this app has
 *  no fixed list of. */
export function titleCase(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Shared visual for the 56px −/+ nudge buttons — borderless at rest, a
// hairline ring only on hover/active/focus so the cluster reads as open
// ground rather than a boxed control pair (redesign-06 ban on decorative
// chrome).
// kiosk-press replaces the bare active:scale-[0.98] this used to carry —
// leaving both would have meant two competing `transform` rules fighting
// over the same press (see globals.css's own comment on `.kiosk-press`'s
// cascade-layer reasoning).
export const NUDGE_BUTTON =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-tile font-mono text-lg text-ink-dim outline-none ring-1 ring-transparent transition hover:ring-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent kiosk-press disabled:pointer-events-none disabled:opacity-40";

// The corner expand button is still a real 56px hit target (touch floor
// invariant holds regardless of where a control sits), but it visually reads
// small — deliberately offset outside the tile's own padding box on two
// edges (see its `-top-1.5 -right-1.5` below) so its footprint doesn't eat
// into the name row's line height, and so it's unambiguously NOT part of the
// −/target/+ cluster beneath it (the owner's ask: don't let it compete with
// the nudge controls). The gap between the two is a full row of content
// (name, then current-temp), not just a few px — the strongest possible
// separation short of moving it off the tile entirely.
//
// FIX (2026-08-04): that negative offset used to sit on the <button> itself,
// so its 56px ring/hover box visibly crossed the tile's own rounded border on
// hover/focus/active, and the glyph sat proud of the corner. The 56px target
// still has to overhang the tile — the name row only reserves px-8 (32px)
// either side, less than half the button's width — so the fix keeps the
// offset on the button but strips it of any visible chrome (no ring, no
// background, no rounding) and moves the actual affordance onto a smaller
// centred `<span>` (`*_CHIP` below, ~36px) that lands well inside the tile
// edge at this offset. `group`/`group-*` threads hover/focus-visible/active
// from the real interactive element (the button — a11y and click target)
// onto that inner chip, since CSS can't apply `:focus-visible` styling to a
// non-ancestor element directly.
// FIX (2026-08-05), the sunroom half of the same story: stripping the ring and
// background off this button was enough for the 15 flat themes, but sunroom
// styles `button` itself — a raised soft-UI box-shadow on :active and a warmth
// bloom on [aria-pressed="true"] (globals.css). Those landed on this 56px
// overhanging hit area, so the power button on a RUNNING unit painted a 56×56
// lit box crossing the tile's own rounded border on two sides — measured on
// production's Office AC tile: button box x641/y187.5 against a tile starting
// at x646/y192.5. `kiosk-hitarea` is the opt-out: globals.css suppresses those
// two shadows on the button and re-hangs the bloom on the inner chip, which
// sits fully inside the tile at this offset.
export const EXPAND_BUTTON =
  "kiosk-hitarea group absolute -top-1.5 -right-1.5 flex h-14 w-14 items-center justify-center text-ink-dim outline-none transition hover:text-ink disabled:pointer-events-none disabled:opacity-40";

// Same kiosk-press swap as NUDGE_BUTTON above, in place of the
// group-active:scale-[0.98] this chip used to carry — the chip is the actual
// visible affordance (EXPAND_BUTTON itself is deliberately chromeless), so
// its own :active is what kiosk-press now answers to.
export const EXPAND_BUTTON_CHIP =
  "flex h-9 w-9 items-center justify-center rounded-tile ring-1 ring-transparent transition group-hover:ring-line-bright group-focus-visible:ring-1 group-focus-visible:ring-accent kiosk-press";

/** Mirrors EXPAND_BUTTON on the opposite corner. Same 56px touch target, same
 *  negative offset so it overhangs the tile's own padding rather than stealing
 *  a column from the two rows of text between them, and the same invisible
 *  hit-area / inner-chip split (see EXPAND_BUTTON's comment). */
export const POWER_BUTTON =
  "kiosk-hitarea group absolute -top-1.5 -left-1.5 flex h-14 w-14 items-center justify-center outline-none disabled:pointer-events-none disabled:opacity-40";

// Same kiosk-press swap, mirrored from EXPAND_BUTTON_CHIP above.
export const POWER_BUTTON_CHIP =
  "flex h-9 w-9 items-center justify-center rounded-tile ring-1 ring-transparent transition group-hover:ring-line-bright group-focus-visible:ring-1 group-focus-visible:ring-accent kiosk-press";
