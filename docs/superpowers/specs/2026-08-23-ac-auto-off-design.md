# AC Auto-Off (Nightly Sweep) — Design

**Date:** 2026-08-23
**Status:** Approved by user (brainstorming session)

## Purpose

A recurring nightly rule on the kiosk: at a configured time, sweep every
Home Assistant `climate.*` entity and turn off any that are still running.
Prevents ACs being left on overnight. Configured from the kiosk itself,
covers all ACs, with a pre-sweep warning and a "skip tonight" escape hatch.

## Behavior

- At the scheduled time (default suggestion 23:00, user-configurable), the
  kiosk sends `set_hvac_mode: "off"` to every climate entity whose
  `hvacMode !== "off"`.
- **One volley per night.** If the user deliberately turns an AC back on
  after the sweep, it stays on until the next night. No re-off nagging loop.
- **Warning banner:** 5 minutes before the sweep, the kiosk shows a
  dismissible banner: "AC auto-off at 23:00 — 2 on — Skip tonight?".
  Tapping skip cancels tonight only; the schedule stays enabled.
- If no ACs are on at sweep time: mark the night as done, show nothing.

## Architecture (Approach A — kiosk-tab client-side)

The always-open kiosk tab runs the schedule. This matches the house
pattern: no server daemons, no new runtime dependencies, all automation is
client-driven (`kiosk-timers.tsx`, `kiosk-activity.ts` idioms). The sweep
writes through the existing public kiosk HA action route, where
`climate` + `set_hvac_mode` are already allowlisted.

Accepted trade-off: if the kiosk tab is down for the entire catch-up
window, that night's sweep is missed. A brief outage at the scheduled time
is covered by the catch-up window (below).

## Data & API

New optional block on `AppConfig` (`src/lib/config.ts`), persisted in
`data/config.json` via the existing `writeJsonAtomic`:

```ts
climateAutoOff?: {
  enabled: boolean;
  time: string;        // "HH:MM" 24h
  skipDate?: string;   // "YYYY-MM-DD" — skip the sweep whose window starts this date
  lastRunDate?: string;// "YYYY-MM-DD" — sweep already fired for this date
  updatedAt: string;   // ISO timestamp
}
```

New **public** kiosk route `src/app/kiosk/api/climate-auto-off/route.ts`:

- `GET` — returns the block (or defaults if absent).
- `POST` — updates it. Strict allowlist validation, same discipline as
  `/kiosk/api/ha/action`'s `PUBLIC_ACTIONS`: `enabled` must be boolean,
  `time` must match `^([01]\d|2[0-3]):[0-5]\d$`, `skipDate`/`lastRunDate`
  must match `^\d{4}-\d{2}-\d{2}$`. Unknown keys rejected. No other config
  surface is reachable from this route.

`skipDate` and `lastRunDate` live **server-side** (not localStorage) so
multiple kiosk devices cannot double-fire and a mid-night tab reload
cannot re-sweep.

## Client engine

`src/lib/kiosk/climate-auto-off.ts` — module-level store + shared interval
started on first subscriber, stopped on last (the `kiosk-timers.tsx` /
`kiosk-activity.ts` idiom). Checks once a minute.

Fire condition (all must hold):
1. `enabled` is true.
2. Current time is within the **60-minute catch-up window** starting at
   the scheduled time.
3. `lastRunDate` ≠ the window's date.
4. `skipDate` ≠ the window's date.

Window-date rule: the sweep's identity date is the calendar date on which
its window *starts* (relevant if a schedule near midnight spills over).

On fire:
1. Read climates from the current `useKioskHa` data (7s poll).
2. Send one off-volley via the existing `runAction` (with optimistic
   entity updates, consistent with manual taps).
3. On a successful volley, immediately `POST lastRunDate` for the
   window's date.
4. If the HA action calls fail (network/HA down), retry the volley up to
   10 minutes (once per minute), then give up and surface a quiet notice
   in the banner area. `lastRunDate` is only set on a successful volley
   or when the retry budget is exhausted.

Race-safety notes:
- The 7.6s IR round-trip lag (measured in `climate-controls.ts`) cannot
  cause loops because the sweep is a single volley, never a converge-loop.
- Two kiosks racing on the same minute is benign: `set_hvac_mode: "off"`
  is idempotent and `lastRunDate` closes the window for everyone.

## UI

All kiosk-world ("OWN-WORLD") vocabulary — no shared dashboard components.

- **Entry point:** small pill in the Climate section header — moon glyph +
  scheduled time (e.g. "☾ 23:00"), or a muted "off" state when disabled.
- **Settings sheet:** opens from the pill with the house overlay shape
  (`containerExpand`/`containerCollapse` FLIP from `kiosk-motion.ts`,
  `fixed inset-0 z-50 bg-bg/90 backdrop-blur-sm` scrim, `.panel` shell,
  `role="dialog" aria-modal="true"`, manual focus trap, Escape via one
  `requestClose()`). Contents:
  - Enable toggle.
  - Touch-friendly time picker (44px/`h-11` minimum targets).
  - Status line: "Next sweep: tonight 23:00" / "Skipped tonight" /
    "Done for tonight".
- **Warning banner:** rendered by `KioskHub` (not the read-only alerts
  system). Appears 5 minutes before the sweep when at least one AC is on:
  count of ACs on, sweep time, and a "Skip tonight" action (POSTs
  `skipDate`). Dismissing the banner without skipping lets the sweep
  proceed.
- **Theming:** any new colors/status text must clear 4.5:1 contrast on all
  16 kiosk themes via `scripts/kiosk-overlay-contrast.mjs`.

## Error handling

- HA unreachable at sweep time → retry volley ≤10 min, then notice.
- Config route validation failures → 400 with reason; client keeps prior
  state and shows nothing destructive.
- Absent `climateAutoOff` block → feature reads as disabled; the pill
  shows the muted "off" state.

## Testing & verification

- Schedule math (next-fire computation, catch-up window membership,
  window-date identity, skip/lastRun guards) implemented as pure
  functions and unit-tested, following the repo's existing test setup.
- Contrast sweep across kiosk themes for new UI.
- Manual verification on the **test stack (port 3006)** against real HA
  before any prod deploy, per CLAUDE.md's deploy discipline. Note: the
  dev checkout's `data/config.json` has no `homeassistant` block — HA
  verification must happen on the test/prod stack.

## Out of scope (YAGNI)

- Per-AC exclusions (user chose all-ACs).
- Ad-hoc one-shot sleep timers.
- Server-side scheduler / instrumentation daemon.
- Multiple schedules per day.
