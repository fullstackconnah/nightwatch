# Accessibility Audit — Tools/Integrations Half (`/dash`)

Audit only. No source files were modified. Scope: `/resources`, `/networks`, `/logs`,
`/settings`, `/smarthome`, `/proxy`, `/git`, `/gpu` (redirect), `/hermes`, and every
component listed in the assignment. Contrast figures below are computed (WCAG relative
luminance formula, sRGB→linear, alpha-compositing where a background uses `/NN`
opacity), not eyeballed — script and raw output available on request, current tokens
read from `src/app/globals.css:8-25` (base dashboard dark theme; the kiosk's 16-theme
catalog is out of scope for this half).

## Score

**2 / 4**

The surface has real, deliberate accessibility engineering in most places — see
"Already correct" — but one systemic P0 (every text/password field in Settings has no
programmatic label) and several P1s (async action results never announced, one data
table with zero header cells, an inconsistent expand/collapse pattern on the app's
biggest page) are severe enough, and wide enough in blast radius, to hold this to a 2.

## Coverage table

| Item | Covered | Notes |
|---|---|---|
| `(dash)/resources/page.tsx` | Yes | ContainerRow expand button, disk-row pattern, totals strip, treemap host |
| `(dash)/networks/page.tsx` | Yes | Uplink band, bridge rows, footprint compare chips |
| `(dash)/logs/page.tsx` | Yes | Error/redirect states only — body lives in `log-console.tsx` |
| `(dash)/settings/page.tsx` | Yes | Section shell, scroll-spy nav wiring |
| `(dash)/smarthome/page.tsx` | Yes | |
| `(dash)/proxy/page.tsx` | Yes | |
| `(dash)/git/page.tsx` | Yes | |
| `(dash)/gpu/page.tsx` | Yes | Pure `redirect()` to `/resources?metric=gpu` — nothing to audit |
| `(dash)/hermes/page.tsx` | Yes | |
| `process-table.tsx` | Yes | Best-in-class sort-header pattern in this half |
| `log-track.tsx` | Yes | `role="log"` + separate sr-only announcer — exemplary |
| `log-console.tsx` | Yes | |
| `ansi.tsx` | Yes | Contrast-checked the SGR→token colour map incl. `dim` opacity |
| `drive-health.tsx` | Yes | |
| `settings-integrations.tsx` | Yes | Source of the `SecretField`/`Label` pattern audited across all settings files |
| `settings-hermes.tsx` | Yes | |
| `settings-access.tsx` | Yes | |
| `settings-widgets.tsx` | Yes | |
| `settings-reference.tsx` | Yes | |
| `settings-section-nav.tsx` | Yes | |
| `gpu-view.tsx` | Yes | |
| `resource-overview.tsx` | Yes | Incl. `MetricHistoryPanel`/`HistoryChart`/`ContainerHistoryPicker` |
| `disk-contents.tsx` | Yes | |
| `disk-scan-jobs.tsx` | Yes | |
| `disk-growth.tsx` | Yes | |
| `disk-pinned.tsx` | Yes | |
| `treemap.tsx` | Yes | |
| `thermal-gauge.tsx` | Yes | |
| `net-compare.tsx` | Yes | |
| `net-connections.tsx` | Yes | |
| `net-throughput.tsx` | Yes | |
| `listening-ports.tsx` | Yes | |
| `proxy-routes.tsx` | Yes | |
| `proxy-certificates.tsx` | Yes | |
| `proxy-status.tsx` | Yes | |
| `ha-lights.tsx` | Yes | |
| `ha-switches.tsx` | Yes | |
| `ha-climate.tsx` | Yes | |
| `ha-locks.tsx` | Yes | |
| `ha-sensors.tsx` | Yes | |
| `ha-status.tsx` | Yes | |
| `ha-toggle.tsx` | Yes | Shared `HaSwitchControl` |
| `git-status-panel.tsx` / `git-branches-panel.tsx` / `git-commit-stream.tsx` / `git-mirror-panel.tsx` | Yes | All 4 |
| `hermes-status.tsx` / `hermes-status-band.tsx` / `hermes-actions.tsx` / `hermes-activity.tsx` / `hermes-ask.tsx` / `hermes-voice-mic.tsx` | Yes | All 6 |
| Also read (not on the list, needed for citations) | — | `ui/input.tsx`, `ui/badge.tsx`, `ui/segment-button.tsx`, `charts.tsx`, `sparkline.tsx`, `settings-widgets.tsx`'s siblings |

Every assigned item was covered.

## Findings

### P0

**Every text/password field across all four Settings panels has no programmatic
label.** `src/components/ui/input.tsx:31-33` — `Label` is a bare `<label>` with no
`htmlFor` support wired through, and every call site (`grep -rn "htmlFor" src/components
src/app` returns exactly one hit in the whole app, `login-form.tsx:84`, which is outside
this half) renders `<Label>Text</Label>` as a **sibling**, not a wrapper, of the
following `<Input>`/`<Select>`/`<textarea>` — e.g. `settings-access.tsx:100-101`
(Current/New/Confirm password), `settings-integrations.tsx:307-308,388-392` (URL, Admin
email, Client secret, GitHub PAT), `settings-hermes.tsx:407-413,436-454` (Channel ID,
Allowed user IDs, Digest hour/minute), `settings-widgets.tsx:39-71` (Container, Type,
Service URL, API key, Username, Password), `settings-access.tsx:319-333` (Issuer, Client
ID). A screen reader tabbing through any of these panels hears "edit text" / "combo box"
with **no accessible name** — it cannot distinguish "Current password" from "New
password" from "Confirm new password" in the same form. This blocks a blind user from
configuring any integration, rotating the admin password, or setting the MCP token/kiosk
PIN — i.e. most of `/settings`, one of the nine routes in this half. Fix is mechanical
(`useId()` in `Label`/`Input`, or thread `htmlFor`/`id`) but touches dozens of call
sites.

### P1

**`listening-ports.tsx:111-117` renders a 4-column data table with zero header
cells.** `<table>` → `<tbody>` directly, no `<thead>`, no `<th>` anywhere in the file.
Port, protocol/family, addresses and owner are conveyed only by column position; a
screen reader has no way to announce what a given cell means. Contrast this with the
correct pattern one file over in `proxy-routes.tsx` (headers present, just missing
`scope`, see P2) and the exemplary one in `process-table.tsx`.

**Async action results are never announced to assistive tech**, across every
"trigger a job, watch it finish" surface in this half:
- `hermes-actions.tsx:93-113` — digest/test-alert run result (success body, or the
  `run failed` error block) renders with no `aria-live` region. A screen reader user who
  presses "Run digest now" gets no notification when it completes or fails; they have to
  guess-and-re-explore the DOM.
- `hermes-ask.tsx:95-112` — same gap for the ask answer/error band. Compounded by the
  `<textarea>` itself (`hermes-ask.tsx:65-75`) having **no accessible name at all** —
  no `<label>`, no `aria-label`; only a `placeholder`, which screen readers do not treat
  as a reliable name and which disappears once text is typed.
- `disk-scan-jobs.tsx:115-122,198-205` (`LargestFilesSection`/`DuplicatesSection`) —
  "N entries scanned…" progress and the eventual result table land with no live region.
- `git-mirror-panel.tsx:56-70` (`SyncButton`) — "sync requested" / error message after
  pressing "sync now" is silent to AT.

This is the mirror image of the log console's SSE stream, which gets this exactly right
(`log-track.tsx:795-806`, `role="log" aria-live="off"` on the scrollback + a separate
sr-only `aria-live="polite"` announcer that only speaks for genuine arrivals) — the
pattern exists in this codebase, it just wasn't carried to these four surfaces.

**`ContainerRow`'s expand/collapse trigger has no `aria-expanded`/`aria-controls`,
inconsistent with its own page's other expandable row.** `resources/page.tsx:427-454` —
the button that expands a container's CPU/Memory/Disk detail (the primary interaction on
the app's single largest screen, 1083 lines) carries neither attribute, so a screen
reader announces it as a plain button with no indication it toggles a panel or what
that panel's current state is. Seven lines later in the same file, the **host-disk**
row's identical expand button does this correctly — `resources/page.tsx:887-892`
(`aria-expanded={isDiskExpanded} aria-controls={...}`) — proving the pattern is known
and simply wasn't applied to the higher-traffic control. `drive-health.tsx:290-294`
(`DriveRow`) and `hermes-activity.tsx:41-46` (`ActivityRow`) also do it correctly, so
this is the outlier, not the norm.

**Treemap cells narrower than 72px have no accessible name.** `treemap.tsx:130-164` —
`canLabel = r.w >= 72` gates the *only* text content the button ever renders; below that
width the `<button>` has empty content and relies solely on its `title` attribute, which
(a) is not a reliable accessible-name source across AT/browser combinations when a
`<button>` has genuinely empty content in some computation orders, and (b) is invisible
to a sighted keyboard user — no browser shows a `title` tooltip on `:focus`, only on
mouse `:hover`. On `/resources`' 24-cell treemap this is a real, frequent case (small
containers routinely render under 72px). Partial mitigation: the same data is repeated,
fully accessibly, in the ranked-row list directly beneath the treemap
(`resources/page.tsx:996-1013`), so no information is exclusively locked behind the
chart — but the treemap's own interactivity (click-to-scroll-to-row) is unreachable by
keyboard/SR for those cells.

### P2

**`--color-ink-faint` (microlabel colour) fails AA 4.5:1 against `panel-2`, including
every alpha-blended `bg-panel-2/NN` variant used in this half — computed, not
eyeballed.** The token was deliberately raised to `#657f9e` to clear 4.5:1 against `bg`
and `panel` (`globals.css:15-19`, and reconfirmed by this audit: 4.77:1 / 4.51:1), but
nobody re-checked it against the app's *third* ground, `panel-2`, which several
surfaces in this half sit their microlabels on:
  - `resources/page.tsx:1016` — `<div className="microlabel px-3 py-2 bg-panel-2/40">idle / no data</div>` → **4.40:1**
  - `resources/page.tsx:457` (`ContainerRow`'s expanded detail, `bg-panel-2/30`) — every microlabel inside it (`CPU` 460, `Memory` 464, `Disk` 471, `pids` 492, `60s trend` 501) → **4.43:1**
  - Solid `panel-2` (used for skeletons/sticky headers elsewhere in the app) → **4.23:1**

  All three sit just under the 4.5:1 line (script: WCAG relative-luminance contrast,
  alpha-composited against `panel` at 30/40/100%). This is small — 0.07–0.27 below
  threshold — but real, and the CLAUDE.md note that the token "has almost no headroom"
  is exactly right: it was tuned against two of three grounds, not the third.

**Table headers exist but skip `scope="col"`**, so a screen reader in table-navigation
mode can't associate a cell with its column header on first pass: `proxy-routes.tsx:167-170`,
`gpu-view.tsx:321,426` (both the per-process VRAM table and the transcode-streams
table), `git-mirror-panel.tsx:92`. `process-table.tsx:262` does this correctly
(`scope="col"` on every `SortHeader`) — worth matching everywhere else in this half.

**`process-table.tsx:547`'s row-count `aria-live="polite"`** (`{processes.length}
processes` / `{containerCount} containers + other`) sits on a value that changes on
every 2-second poll (`useProcesses(2000)`) whenever a process count so much as ticks —
this is exactly the "live region on a high-frequency stream" failure the brief calls
out. It's polite (queues rather than interrupts) so it won't be as disruptive as an
assertive region would, but a screen reader user filtering the table will periodically
hear an unrelated count announcement mid-task.

**Treemap's "others" cell is a plain, non-interactive `<div>`**
(`treemap.tsx:144-152`, deliberate per its own comment — "not focusable, not clickable")
whose aggregate value and item count (`others (N)`) are exposed only via a `title`
tooltip. On a box with more than 24 active containers this cell can represent a
non-trivial share of the treemap and is completely invisible to keyboard/SR users.

### P3

- **`ha-locks.tsx`'s 4-second arm/confirm window** (`CONFIRM_WINDOW_MS`,
  `ha-locks.tsx:13,96-99`) silently reverts "Confirm lock/unlock" back to
  "Lock/Unlock" with no live-region notice. The button's own accessible name does
  update correctly if refocused, so this only matters for a screen reader user who
  doesn't immediately re-query the button — low likelihood, worth a one-line
  `aria-live="polite"` note if this pattern is touched again.
- **External links lack a visually-hidden "opens in new tab" cue** — a widespread,
  minor pattern across this half: `git-branches-panel.tsx:32-36`,
  `git-commit-stream.tsx:30-34`, `settings-integrations.tsx:458-467,622-630`,
  `settings-access.tsx:456-463`. Not a WCAG failure (2.4.4/3.2.5 don't strictly require
  it), but a cheap, common courtesy this codebase doesn't do anywhere in scope.
- **Stale code comment**, not a live bug: `log-track.tsx:750-753` still says
  "`ink-faint`, which measures 3.1:1 here" and defensively uses `ink-dim` instead — but
  the token was raised to `#657f9e` (now 4.51:1 on `panel`) after that comment was
  written, so the cited number is now wrong. The workaround is harmless (ink-dim is
  strictly better), just worth a comment update if anyone touches this file.

## Already correct

- **`log-track.tsx`'s live-region architecture is exemplary**: the scrollback itself is
  `role="log" aria-live="off"` (`log-track.tsx:687-690`) so a 200-line seed on connect
  never gets read aloud, paired with a genuinely separate sr-only `aria-live="polite"`
  announcer (`log-track.tsx:799-806`) that only fires for real arrivals — counted and
  grouped by level, never the raw message text (which reaches 549 chars on this host's
  worst offender). A zero-width-space parity trick even handles two identical
  consecutive announcements. This is the reference pattern the P1 async-action findings
  above should be brought up to.
- **`ansi.tsx`'s SGR→token colour bending** keeps every log-level/ANSI foreground at or
  above 4.23:1 on `panel` even with the `dim` (opacity 0.75) modifier applied, with two
  exceptions computed by this audit: `black`→`ink-faint` at 3.06:1 and `red`→`bad` at
  4.23:1 both fail 4.5:1 once dimmed. These are rare in practice (ANSI dim+black or
  dim+red on this host's actual log output) but are a real, computed gap — flagged here
  rather than under Findings because it's a two-cell edge case in an otherwise
  carefully-designed system, not a structural problem.
- **`charts.tsx`'s `Meter`** (`charts.tsx:56-91`) is the right way to do a progress
  bar: `role="progressbar"` with `aria-valuenow/min/max`, an opt-in `aria-label`, and a
  redundant `sr-only` percentage text node.
- **`thermal-gauge.tsx`** (`thermal-gauge.tsx:96-102`) wraps its SVG in
  `role="img" aria-label="core temperature 61°C of 95°C maximum"` (full sentence, not
  just a number) with the SVG itself `aria-hidden` — exactly right, and the one
  genuinely interactive-looking chart in this half's GPU page that a screen reader user
  can fully consume.
- **`drive-health.tsx`**'s `LifeTrack` (`drive-health.tsx:126-171`) and its hatched
  "no wear telemetry" state both carry `role="img"` with a descriptive `aria-label`
  rather than rendering as a bare, silent bar; `DriveRow`'s expand button correctly
  pairs `aria-expanded`/`aria-controls` (`drive-health.tsx:290-294`).
- **HA domain panels** (`ha-lights.tsx`, `ha-switches.tsx`, `ha-climate.tsx`,
  `ha-locks.tsx`, `ha-sensors.tsx`) consistently use `role="alert"` for per-row action
  errors with a dismiss button carrying its own `aria-label` (e.g.
  `ha-lights.tsx:96-106`), and the shared `HaSwitchControl` (`ha-toggle.tsx:14-52`) is a
  correct `role="switch"` + `aria-checked` with the visual pill track marked
  `aria-hidden` so AT sees exactly one control. **`ha-locks.tsx`'s two-step arm/confirm**
  for lock/unlock (`ha-locks.tsx:85-99`) is the one genuinely destructive, irreversible
  action in the HA domain and it's keyboard-reachable with a live `aria-label` that
  updates to "Confirm lock/unlock" — see the one P3 nit above.
- **`process-table.tsx`'s `SortHeader`** (`process-table.tsx:242-290`) is the best
  sortable-column pattern in this half: `scope="col"`, `aria-sort`, a focus-visible
  ring, and the sort direction chevron is `aria-hidden` with the state carried by
  `aria-sort` instead. `ViewSwitch` (`process-table.tsx:298-333`) is a correct
  `role="switch"`.
- **Segmented controls** throughout (`SegmentButton`, used in resources' metric tabs,
  the disk STORAGE/I/O toggle, log level pills, HVAC mode, Hermes tier, history range)
  consistently pair `aria-pressed` with a `label` prop carrying the unabbreviated name,
  matching DESIGN.md's own stated contract.
- **Every chart SVG that is purely decorative is correctly `aria-hidden`** with the
  meaning carried in adjacent text: `net-throughput.tsx` (`ThroughputChart`),
  `net-compare.tsx`, `resource-overview.tsx` (`HistoryChart`), `disk-growth.tsx`
  (`GrowthChart`), `sparkline.tsx`. None of these attempt to be independently
  screen-reader-navigable, which is correct given the data is always duplicated in
  adjacent mono text/legends.
- **44px touch targets** are honoured consistently across every interactive element
  checked in this half (`h-11 md:h-*` pairing) — spot-checked in `process-table.tsx`,
  `log-track.tsx`, `drive-health.tsx`, `disk-contents.tsx`, `disk-pinned.tsx`,
  `hermes-voice-mic.tsx` — no violations found.
- **Destructive-action confirmation**: `log-console.tsx`'s archive purge
  (`log-console.tsx:438-471`) and `settings-integrations.tsx`'s `ClearControl`
  (`settings-integrations.tsx:179-208`) both use the app's inline two-step confirm
  idiom rather than a browser `confirm()`, and both are fully keyboard-reachable.
