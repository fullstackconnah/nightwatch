# Kiosk redesign — space efficiency, distance legibility, merged views

Date: 2026-08-03. Status: **shipped**, with one gap named at the bottom. This file
was the contract the build was written against; it now records what was actually
verified. Read it before touching kiosk code.

## Why

The kiosk is a wall tablet read from 2–3 m. It currently spends its screen on
chrome: `.panel` boxes around things that need no box, 10–12px type on a surface
nobody stands close to, a 5-day forecast eating ~110px of vertical space, an
alert card permanently occupying the top of the column, and two mutually
exclusive layouts (Glance / Standard) chosen by a stored device preference so
half the design is never seen.

## The five changes

1. **Alerts move off the page.** Floating alert button + full-screen takeover on
   arrival + a notification tray. No standing alert card.
2. **Chrome down, type up.** Borders and boxes only where they mark a touch
   target or an alert; everything else is open ground with type and space doing
   the grouping. Every reading gets bigger.
3. **Climate simplifies.** One row per room: current temp, target, −/+. Advanced
   controls (HVAC modes, dual setpoint) move to a full-screen modal.
4. **Forecast goes inline.** One horizontal rail, header inline as the first
   cell, bigger text, ≤64px tall.
5. **Glance and Standard merge into one surface.** Glance is the resting state;
   any touch animates to the full view; 30s idle animates back. Shared elements
   (clock, temperature, forecast) are the *same DOM nodes* and travel between
   positions.

## Invariants (all agents)

- **No new runtime dependencies.** PRODUCT.md forbids them. Motion is WAAPI
  (`Element.animate`) + CSS. No motion/gsap/framer.
- **All 16 kiosk themes must survive.** Never hardcode a hex; use the token
  classes (`text-ink`, `text-ink-dim`, `bg-panel-2`, `border-line`, …) or
  `var(--color-*)`. Don't change token values — the theme×role contrast sweep
  (128 pairs, AA-clearing as of 2026-08-03) has almost no headroom.
- **Keep every non-happy state.** Loading skeletons, hatch-textured unconfigured
  panels, `StaleTag`, unreachable lines, `unavailable` badges, optimistic-update
  + rollback contracts in `useKioskHa`. Redesigning the happy path must not
  quietly delete the others.
- **Touch floor 56px** for kiosk controls (up from the 44px app-wide floor —
  this is a wall panel). Focus rings stay: `focus-visible:ring-1 ring-accent`.
- **Reduced motion is not optional.** Every animation added here needs a
  `prefers-reduced-motion: reduce` path — crossfade or instant, never "nothing
  appears".
- **Headings stay semantic.** Section captions that are `h2`/`h3` today stay
  headings even when they lose their box.
- Bans: no side-stripe borders, no gradient text, no decorative glassmorphism,
  no nested cards.
- Gate: `npx tsc --noEmit` clean. **Never run `npm run build` while the dev
  server is running** (shared `.next`).

## Motion tokens

Defined once in `src/lib/kiosk-motion.ts` (agent A creates it):

```ts
export const KIOSK_MOVE_MS = 420;   // shared-element travel between views
export const KIOSK_FADE_MS = 180;   // content entering/leaving a view
export const KIOSK_POP_MS  = 260;   // takeover / modal entrance
export const KIOSK_EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)"; // ease-out-expo
export const KIOSK_REDUCED_MS = 120; // the reduced-motion crossfade
export function prefersReducedMotion(): boolean;
```

Stagger inside one list: ≤60ms per item, ≤5 items deep. No orchestrated
page-load sequence — the kiosk boots into a task.

## Shared-element (FLIP) contract

`src/lib/kiosk-motion.ts` also exports the FLIP primitive (agent A):

```ts
// Registry keyed by a stable string id. Nodes register themselves; the surface
// captures rects before a mode change and plays the inverse transform after
// React commits the new layout.
export function useFlipGroup(key: string | number): {
  register: (id: string) => (node: HTMLElement | null) => void;
};
```

Implementation rules:

- Capture `getBoundingClientRect()` for every registered node in a
  `useLayoutEffect` cleanup / ref snapshot **before** the mode changes, then in
  a `useLayoutEffect` after commit measure again and animate
  `transform: translate(dx, dy) scale(sx, sy)` → `none`, `transformOrigin: "top left"`.
- **Never animate `font-size`, `width`, `height`, `top`, `left`.** The element
  takes its final font-size instantly and is scaled from the old box; scale is
  `oldRect.width / newRect.width` (use a single uniform scale from width for
  text so glyphs don't skew).
- Cancel in-flight animations on the node before starting a new one; store the
  live `Animation` so a rapid mode flip mid-travel reverses instead of jumping.
- Under `prefers-reduced-motion`, `register` still works but no animation plays.
- Guard SSR: everything runs in effects, nothing during render.

Shared ids used by the surface: `clock`, `temp`, `forecast`, `server-line`.

## The mode model (agent D owns)

```ts
type KioskViewMode = "glance" | "full";
```

- Runtime state in `page.tsx`. **Not persisted** — the device always rests in
  glance.
- Any `pointerdown` / `keydown` on the surface → `full`.
- `KIOSK_IDLE_MS = 30_000` with no interaction → back to `glance`.
- **Auto-return is suspended** while: the surface is elevated, the PIN pad is
  open, the climate modal is open, the alert takeover is showing, or the alert
  tray is open. (A person mid-task must never be yanked back to a clock.)
- The existing `kiosk-layout` localStorage value keeps its key and its
  `?layout=` override but changes meaning:
  - `"glance"` (default) → merged behaviour above.
  - `"standard"` → pinned to `full`, never auto-returns (bench/desk opt-out).
  `KioskAppearance`'s copy must say that.
- Night overlay (22:00–05:00, unelevated) is unchanged and still owns the
  screen; a wake tap enters `full` for `NIGHT_WAKE_MS`.

### What each mode shows

| element | glance | full |
|---|---|---|
| clock | huge, centred | small, top-left of the status line |
| current temp + condition | large, under the clock | inline in the weather line |
| forecast rail | visible, centred, one row | inside the weather band |
| server sentence | one quiet line | expanded into the status line's counters |
| glance control tiles (4) | visible | replaced by the full hub |
| hub / elevated tools / briefing | hidden | visible |
| alert button | visible | visible |

Content that is not shared fades/translates out (`KIOSK_FADE_MS`) before the
shared elements land, and fades in after. Total perceived transition ≤ 600ms.

### Structural rule that makes the transition possible

FLIP only animates a node that **survives** the mode change. A shared element
rendered inside the status strip in one mode and inside a centred stack in the
other is two different nodes: React unmounts one and mounts the other, and there
is nothing to animate. So the shared elements live in **one container that
changes shape**, not in two competing subtrees:

```
KioskSurface (owns mode)
├─ KioskAlerts                         fixed overlay, outside the flow
├─ <header data-mode>                  THE shared container
│   ├─ clock          (id="clock")     same node in both modes
│   ├─ temp+condition (id="temp")      same node in both modes
│   ├─ forecast rail  (id="forecast")  same node in both modes
│   ├─ server line    (id="server-line")
│   └─ full-only strip content         vitals, running count, admin — fade in
├─ glance-only        GlanceTiles, briefing sentence — fade out
└─ full-only          KioskDisplay, elevated tools, KioskHub — fade in
```

- glance: `header` is `flex-col items-center justify-center` filling the
  viewport, huge type.
- full: `header` is `flex-row items-center` + `sticky top-0` + `.panel`, compact
  type, with the strip's own extras revealed beside the clock.

Consequence: **the forecast rail leaves the weather band.** `KioskDisplay` keeps
the current reading, rain nowcast/ribbon and briefing; the rail is owned by the
shared header in both modes. This supersedes the "inside the weather band" row
of the table above.

Consequence: **the status strip's dead/unhealthy severity chip is removed.**
`src/lib/attention.ts` already probes both conditions (`probeContainerDeath`,
`probeUnhealthy`), so the chip now duplicates the alert surface. The strip keeps
the running count, vitals and admin.

### Known API mismatch: alerts are single-valued

`getAttention()` returns the **first** hit in priority order — never several
conditions at once. `useKioskAlerts()` is list-shaped anyway (so the badge and
tray need no rework if the route grows), but today the badge never reads >1. To
make the tray worth opening, it also holds **recently resolved** alerts from the
current session, explicitly labelled as resolved with the time they cleared.
That is presentation of things the probes really reported, not fabrication — the
honesty rules in `attention.ts` still hold.

## Ownership map (do not edit files you don't own)

| agent | creates | edits |
|---|---|---|
| A alerts | `src/lib/kiosk-motion.ts`, `src/components/kiosk-alerts.tsx` | — |
| B climate | `src/components/kiosk-climate.tsx` | `kiosk-hub.tsx` (climate region only) |
| C forecast | `src/components/kiosk-forecast.tsx` | `kiosk-display.tsx` (forecast + weather band) |
| D merge | `src/components/kiosk-surface.tsx` (if needed) | `kiosk/page.tsx`, `kiosk-glance.tsx`, `kiosk-clock.tsx`, `kiosk-status-strip.tsx`, `kiosk-appearance.tsx`; deletes `kiosk-attention.tsx` |
| E density | — | `globals.css` (kiosk scope only), `kiosk-hub.tsx`, `kiosk-display.tsx`, `kiosk-status-strip.tsx` |

## Component specs

### A — alerts (`kiosk-alerts.tsx`)

Source stays `/kiosk/api/attention` (`AttentionResult`, 30s poll, honesty rules
in `src/lib/attention.ts`). Exports:

- `useKioskAlerts()` — active alerts + unseen detection. Identity key is stable
  across polls (headline + severity + `since`), so a 30s re-poll of the same
  condition is **not** a new alert.
- `<KioskAlertTakeover>` — full-screen, `z-(--z-modal)` over a
  `z-(--z-modal-backdrop)` scrim. Headline at `clamp(2rem, 6vw, 4rem)`, detail
  at ~1.5rem, severity ink (`text-bad` / `text-warn`), `aria-live="assertive"`.
  Entrance: fade + scale 0.96→1 over `KIOSK_POP_MS`. Dismisses on tap/Escape or
  automatically after `TAKEOVER_MS = 8_000`, and **FLIP-minimises into the alert
  button** (shared id `alert-<key>`) over `KIOSK_MOVE_MS`.
- `<KioskAlertButton>` — fixed top-right, `min-h-14 min-w-14`, safe-area inset
  baked into its own offsets (`env(safe-area-inset-*)`; the theme scope's
  padding does not reach `fixed` children — see `kiosk-glance.tsx`). Count badge
  + severity tint. Rendered only when ≥1 active alert; fades out when the last
  one clears. `aria-label` states the count and worst severity.
- `<KioskAlertTray>` — anchored under the button, `z-(--z-toast)`. One row per
  alert: headline (≥1rem), detail (`text-ink-dim`), "for <uptime>" tag reusing
  `formatUptime`. Slide+fade in 220ms. Auto-closes after
  `TRAY_AUTO_CLOSE_MS = 20_000`, timer **reset by any interaction inside it**.
  Escape closes; focus moves to the first row on open and returns to the button
  on close. `role="dialog" aria-modal="false"`.

The takeover must not fire for an alert that was already active when the page
loaded (a reload is not a new alert) — seed `seen` on first successful poll.

### B — climate (`kiosk-climate.tsx`)

- `<KioskClimateRow>` replaces `ClimateCard`'s box. One line, no border:
  `name · current (mono, text-3xl) · target (mono, text-xl, "target" microlabel) · [−] [+] [advanced]`.
  Buttons are 56px, borderless, hairline ring on hover/active only.
- `<KioskClimateModal>` — full-screen `role="dialog" aria-modal="true"`,
  `z-(--z-modal)` + backdrop, Escape + backdrop click close, focus trapped,
  focus returns to the advanced button. Contains: room name, big current +
  target, 72px −/+, the HVAC mode segmented control (moved out of the row),
  dual-setpoint low/high when `targetTempLow`/`targetTempHigh` are set, and the
  existing per-entity error line.
- `NUDGE_STEP`, `HVAC_LABEL`, the optimistic `next` payloads and
  `ha.isPending` / `ha.actionErrors` behaviour carry over **unchanged**.
- `unavailable` entities keep their badge and their disabled controls.

### C — forecast (`kiosk-forecast.tsx`)

- `<KioskForecastRail days emphasizeIndex size>` — one horizontal row. The
  "5-day" caption is the row's first cell (inline `h3.microlabel`), not a line
  above it. Per day, on one line: label · icon · `max°/min°` · rain %.
- No per-day boxes or borders. Separation is spacing; at most a hairline
  vertical divider (`border-line`) between cells.
- Type: day label ≥0.875rem, temps mono ≥1.125rem (`size="glance"` scales up
  ~25%). Total height ≤64px.
- Emphasis = accent ink on the label + icon, never a tinted box.
- Narrow widths drop days (5 → 4 → 3) rather than wrapping or scrolling. No
  horizontal overflow at 390px.
- Exported for both `kiosk-display.tsx` (full view) and the glance surface.

### E — density pass

- Add a `.kiosk-dense` scope in `globals.css` applied at the kiosk root —
  kiosk-only overrides (`.microlabel` to 0.6875rem/0.1em tracking, minimum body
  0.875rem). Do **not** change the app-wide `.microlabel`; the dashboard uses it.
- Drop `.panel` from anything that isn't a touch target or an alert: the weather
  band, the briefing card, the sensors block, the hub's section wrappers. Use a
  hairline top rule or plain spacing instead.
- Vertical rhythm: page `gap-6` → `gap-4`, `panel p-4` → `p-3`, forecast/weather
  stacking collapses into rows wherever the data is one line long.
- Raise data type in the full view: mono figures ≥ `text-lg`, labels ≥ 11px.
- Re-check: 0 horizontal overflow at 1440 and 390px; 56px touch targets intact;
  contrast unchanged (no token edits).

## What was verified (2026-08-03)

Gates: `npx tsc --noEmit` clean, `npm run build` clean (16/16 static pages).

Local browser pass (dev server, no Docker socket):

- Shared elements are genuinely the same DOM nodes across a mode change —
  tagged pre-transition, all four survived. They travel; they don't remount.
- Glance content fades rather than vanishing; 6 rapid flips at 80ms left no
  ghost and nothing stuck invisible; reduced motion fully arrives.
- 30s idle auto-return, night overlay, wake-to-full, 3 themes.
- Forecast rail **28px** (ceiling 64, was ~110).

Test stack (port 3006, live Docker socket, real alerts):

- Full alert lifecycle against a real container death: takeover on arrival,
  auto-minimise at 7.45s (`TAKEOVER_MS` 8000), FLIP into the button, `bad` =
  solid fill + a confirmed-running pulse vs `warn` = tint and no animation,
  tray auto-close at 20.19s (`TRAY_AUTO_CLOSE_MS` 20000), timer reset by
  interaction inside the tray, resolved row rendering with `cleared HH:MM`.
- Seeding: a standing alert does **not** replay its takeover on load or
  reload; a genuinely new alert mid-session does fire one.
- Forecast rail: 0 overflow at 390 and 1440 in both sizes, measured per cell
  against the rail's own box.

### Two defects the browser found that code review had not

1. **The forecast rail clipped its own content at 390px.** The three
   unconditionally-rendered columns never fit; `overflow-hidden` hid it. It
   passed `document.documentElement.scrollWidth <= clientWidth` because the
   rail sits inside a `position: sticky` ancestor, and sticky subtrees don't
   propagate overflow into document scroll width. **Do not trust that metric
   for anything inside the sticky header.** Fixed by dropping the base tier to
   2 days with measured reveal breakpoints.
2. **The takeover replayed on every load.** `seededRef.current` was read
   *inside* a `setState` updater while the effect body had already set it to
   `true` — the updater is lazy, so `seen` always evaluated false and every
   first poll fired a takeover. Fixed by moving `seeded` into the state object
   so it is read and written by the same pure updater. **Never read a mutable
   ref inside a lazy updater.**
3. **The alert button was unclickable in full view.** It carried
   `z-(--z-sticky)` — the same index as the sticky header — so DOM order
   decided, and the header swallowed the clicks. Now `z-(--z-toast)`.

### Known gap

**Climate has never run against real Home Assistant entities.** Neither the dev
environment nor the test stack has an HA config block, so only the unconfigured
state was exercised. The row layout, the −/+ optimistic nudge, and the advanced
modal are typecheck-and-code-review verified only. Exercise them on a kiosk with
HA connected before trusting them.
