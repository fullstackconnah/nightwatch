# Responsive / touch audit — tools & integrations half

Scope: `/resources`, `/networks`, `/logs`, `/settings`, `/smarthome`, `/proxy`, `/git`, `/gpu`, `/hermes` and their component trees. Audit only, no source edited. Reasoned from code — no dev server or browser was available; items that need a real render are called out explicitly at the end.

## Score

**3 / 4**

The dense screens this brief calls "the real test" — `/resources`, `/networks`, `process-table.tsx` — hold up well: every wide table has an explicit `hidden md:table` / `md:hidden` card fallback, `min-w-0` + `truncate` discipline is applied almost everywhere a flex row holds variable-length text, and every hand-rolled SVG chart in scope uses `viewBox` + `preserveAspectRatio="none"` + `className="w-full"` with only the *height* fixed — the "fixed viewBox and fixed width" overflow trap this brief warned about does not occur once in this half. `/logs` wraps long lines (`white-space: pre-wrap; word-break: break-all` in `.logbox`) instead of scrolling horizontally, even for the 549-character worst-case line the code comments cite.

Docked a point for: a systemic, partially-*known* touch-target shrink at the `md` breakpoint (768px) that the team-lead's brief specifically asked about — confirmed real, and in a few places (HA toggles, dismiss-error buttons) it lands on a primary control a household member repeatedly taps on a wall tablet, not just a secondary icon action. Also one concrete overflow bug (missing `min-w-0` in `settings-widgets.tsx`) and a couple of undersized/inconsistent form controls.

## Coverage table

| File | Reviewed | Notes |
|---|---|---|
| `(dash)/resources/page.tsx` | ✅ | ContainerRow, disk toggle, volumes row — see findings |
| `(dash)/networks/page.tsx` | ✅ | UplinkBand, BridgeRow, ContainerFootprint — see findings |
| `(dash)/logs/page.tsx` | ✅ | Server error state only; delegates to LogConsole |
| `(dash)/settings/page.tsx` | ✅ | Section shell/ordering only |
| `(dash)/smarthome/page.tsx` | ✅ | Thin wrapper around ha-*.tsx panels |
| `(dash)/proxy/page.tsx` | ✅ | Thin wrapper around proxy-*.tsx |
| `(dash)/git/page.tsx` | ✅ | Thin wrapper around git-*.tsx |
| `(dash)/gpu/page.tsx` | ✅ | Now a bare `redirect("/resources?metric=gpu")` — no UI of its own |
| `(dash)/hermes/page.tsx` | ✅ | Thin wrapper around hermes-*.tsx |
| `process-table.tsx` | ✅ | Best-in-class desktop/mobile split — see "Already correct" |
| `log-track.tsx` | ✅ | See findings (icon buttons) + "Already correct" (`.logbox` wrap) |
| `log-console.tsx` | ✅ | Sticky toolbar, filter clear button — see findings |
| `ansi.tsx` | ✅ | Pure text/segment logic, no layout — nothing to flag |
| `drive-health.tsx` | ✅ | Consistent `min-h-11 md:min-h-0` rows, grids collapse cleanly |
| `settings-integrations.tsx` | ✅ | SecretField, panels — clean |
| `settings-hermes.tsx` | ✅ | See findings (OpenRouter filter clear button) |
| `settings-access.tsx` | ✅ | Clean grid stacking, no overflow risk found |
| `settings-widgets.tsx` | ✅ | **P1 overflow bug** — see findings |
| `settings-reference.tsx` | ✅ | CopyButton — part of the icon-shrink pattern |
| `settings-section-nav.tsx` | ✅ | Horizontal snap rail — see "Needs browser confirmation" |
| `gpu-view.tsx` | ✅ | Clean desktop/mobile split, `min-w-0` present throughout |
| `resource-overview.tsx` | ✅ | Fluid SVG history chart, clean |
| `disk-contents.tsx` | ✅ | Clean |
| `disk-scan-jobs.tsx` | ✅ | Clean |
| `disk-growth.tsx` | ✅ | Fluid SVG, clean |
| `disk-pinned.tsx` | ✅ | Part of the icon-shrink pattern |
| `treemap.tsx` | ✅ | ResizeObserver-driven, genuinely fluid — see "Already correct" |
| `thermal-gauge.tsx` | ✅ | Fixed 140px SVG, fits at 390px — no overflow risk |
| `net-compare.tsx` | ✅ | Fluid SVG, clean |
| `net-connections.tsx` | ✅ | Clean |
| `net-throughput.tsx` | ✅ | Fluid SVG — see "Already correct" |
| `listening-ports.tsx` | ✅ | **Finding** — search input never grows past 36px |
| `proxy-routes.tsx` | ✅ | Clean table/card split |
| `proxy-certificates.tsx` | ✅ | Clean |
| `proxy-status.tsx` | ✅ | Skeleton/error states only, no layout risk |
| `ha-climate.tsx` | ✅ | Nudge buttons + dismiss button — see findings |
| `ha-lights.tsx` | ✅ | Dismiss-error button — see findings |
| `ha-locks.tsx` | ✅ | Dismiss-error button — see findings |
| `ha-sensors.tsx` | ✅ | Read-only grid, clean |
| `ha-status.tsx` | ✅ | Copy blocks, skeletons — clean |
| `ha-switches.tsx` | ✅ | Dismiss-error button — see findings |
| `ha-toggle.tsx` | ✅ | Shared switch control — documents its own 44px→28px `md:` shrink |
| `git-branches-panel.tsx` | ✅ | Clean |
| `git-commit-stream.tsx` | ✅ | Nested `max-h-[28rem]` scroll — see "Needs browser confirmation" |
| `git-mirror-panel.tsx` | ✅ | Clean table/card split |
| `git-status-panel.tsx` | ✅ | Error states only, clean |
| `hermes-actions.tsx` | ✅ | Clean |
| `hermes-activity.tsx` | ✅ | Nested `max-h-[28rem]` scroll — same note as git-commit-stream |
| `hermes-ask.tsx` | ✅ | Clean |
| `hermes-status-band.tsx` | ✅ | Clean grid collapse |
| `hermes-status.tsx` | ✅ | Error/skeleton states, clean |
| `hermes-voice-mic.tsx` | ✅ | 44px→32px `md:` icon button, consistent with the rest of the pattern |

## Touch-target inventory (real px, by breakpoint)

Source of the systemic pattern — `ui/button.tsx`:
| size | <768px | ≥768px (`md:`) |
|---|---|---|
| `default` | 40px | **32px** |
| `sm` | 36px | **28px** |
| `lg` | 44px | 36px |
| `icon` | 40px | **32px** |
| `touch` (kiosk-only, not used in `/dash`) | 56px | 56px |

`ui/input.tsx` `Input`/`Select`: 44px tall <768px → **32px** at `md:`, text 16px → 14px.

The `icon`/`default` `md:` shrink is not an oversight — `button.tsx:21-32` contains a comment explaining that a dedicated `touch` variant (56px, no `md:` shrink) was added specifically because kiosk wall-tablets are ≥768px but touch-only, and states plainly: *"Every `/dash` call site keeps using `icon` unchanged."* That is the exact risk the team-lead's brief asked about, for the exact reason it named (viewport width as a touch/pointer proxy) — confirmed real for `/dash`, not hypothetical.

Manually-styled icon buttons repeating the same shrink (not going through `Button`, so not caught by any future fix to that component):
- `h-11 w-11 md:h-7 md:w-7` (44px → **28px**): `log-track.tsx:566,605,612,635,647,657,666`; `disk-pinned.tsx:69,127,136`; `settings-reference.tsx:33` (CopyButton, used by both Access and Reference sections)
- `h-11 w-11 md:h-6 md:w-6` (44px → **24px**, smallest found): `log-console.tsx:350` (filter clear ×); `settings-hermes.tsx:197` (OpenRouter model filter clear ×)
- `HaSwitchControl` (`ha-toggle.tsx:34`): `h-11 w-14` (44×56) → `md:h-7 w-12` (**28×48**) — used for every light/switch toggle on `/smarthome` and the Hermes dry-run/pipeline toggles in Settings
- `ContainerActions` Start/Stop/Restart (`resources/page.tsx:380-390`, `Button size="sm"`): 36px → **28px** — a destructive Stop action
- Climate nudge ±(`ha-climate.tsx:119-134`, `Button size="icon"`): 40px → **32px**, for a control meant to be tapped repeatedly for fine adjustment

**Undersized at every breakpoint (not just `md:`)** — dismiss-error "×" buttons in `ha-lights.tsx:98-105`, `ha-switches.tsx:72-79`, `ha-climate.tsx:157-164`, `ha-locks.tsx:136-143`: identical markup, `className="shrink-0 rounded px-1 ..."` around a bare "×" glyph at `text-[0.7rem]`, with **no `h-`/`w-`/`min-h-` class at all**. This is not a phone-vs-tablet trade-off — it's ~18-20px on a 390px phone too. See Findings P1.

**Inconsistent with the rest of the app** — `listening-ports.tsx:183` search input: `h-9` (36px) fixed, no `md:` variant, at every viewport including 390px. Every other text input in scope (including this same file's siblings) follows `h-11 md:h-8/9`.

## Findings

**P1 — `settings-widgets.tsx:177` missing `min-w-0`, real overflow risk at 390px.** The widget list row (`flex items-center gap-3 px-4 py-2.5`, line 174) puts a `Badge`, a container-name `span`, then `<span className="font-mono text-xs text-ink-faint flex-1 truncate">{w.url}</span>` for the service URL. That `flex-1 truncate` span has **no `min-w-0`**. In a flex row a child's default `min-width` is `auto` (its content's min-content size), so `truncate`'s `overflow:hidden` cannot actually engage until the item is allowed to shrink below that — without `min-w-0` a long value (a realistic one: `http://192.168.1.70:8989/api/some/longer/endpoint/path`) will push the row wider than its container instead of eliding, causing horizontal overflow at 390px. Every comparable truncate-in-flex row elsewhere in this half (`process-table.tsx:435`, `disk-contents.tsx:224,235`, `proxy-routes.tsx` `DomainCell`, `git-commit-stream.tsx:43`, `net-connections.tsx`, `gpu-view.tsx:347,473`) correctly pairs `truncate` with `min-w-0`, which is why this one stands out as a real, isolated bug rather than a house style question.

**P1 — dismiss-error "×" buttons have no explicit size, ~18-20px on every breakpoint.** `ha-lights.tsx:98-105`, `ha-switches.tsx:72-79`, `ha-climate.tsx:157-164`, `ha-locks.tsx:136-143` (identical each time): `className="shrink-0 rounded px-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"` wrapping a bare `×` at `0.7rem`. Every other interactive control in this app's `/smarthome`/`/hermes`/`/logs` surfaces was deliberately sized to 44px on touch (`h-11` is used well over 60 times across the files read for this audit) — these four are the one control shape that was missed. It fires after a failed HA action (a real, expected path — locks in particular can report `jammed`), on a wall-mounted touch panel.

**P2 — `Button` `icon`/`default`/`sm` sizes and their manual equivalents shrink below 44px starting at 768px, and this affects primary controls, not just secondary ones.** `HaSwitchControl` (every light/switch toggle) drops to 28×48 at `md:`; the climate ± nudge buttons drop to 32px; the resources page's Stop/Start/Restart row actions drop to 28px. For a mouse/trackpad `md:` (a laptop docked to a wide monitor) this is fine and matches "desktop ≥768px layouts are deliberate and stable" in PRODUCT.md. But `md:` is also true for an iPad in portrait (768–834px, per the team-lead's brief) or a wall tablet, where the input is a finger — exactly the scenario `button.tsx`'s own comment on the `touch` variant describes and explicitly says `/dash` was left out of. This is a known, accepted trade-off per the code's own documentation, not a fresh discovery, but it does mean any `/dash` surface used on a touch tablet in portrait inherits it — worth flagging up rather than re-litigating as a surprise.

**P2 — `listening-ports.tsx:183` search input is 36px on every viewport,** including 390px phone, where the rest of the app (including this file's own `ScopeGroup`/`PortCard` rows) uses 44px. Minor on its own; notable because it's the one input in scope that doesn't follow the shared `Input` component or the `h-11 md:h-8` idiom other hand-rolled inputs use (e.g. `settings-hermes.tsx:190`, `log-console.tsx:338`).

**P3 — nested scroll regions inside a scrolling page.** `git-commit-stream.tsx:21` and `hermes-activity.tsx:101` both use `max-h-[28rem] overflow-y-auto` (~448px) for their feed body. On a typical phone viewport that's more than half the visible height, so a touch drag starting inside the feed scrolls the feed, not the page — standard nested-scroll behavior, not a bug, but worth a real-device check since it's the same shape of interaction the brief flagged for `/logs` (where it's clearly intentional and documented) applied here without the same explicit design note. See "Needs browser confirmation."

**P3 — `settings-section-nav.tsx:86` hides its scrollbar via `style={{ scrollbarWidth: "none" }}`,** which is a Firefox-only property; WebKit/Blink (iOS Safari, Chrome) need `::-webkit-scrollbar{display:none}` and may still paint a scrollbar on the horizontal snap rail. Cosmetic only — the rail still scrolls and works as navigation either way.

## Already correct

- **Every wide table in scope has an explicit mobile card fallback** (`hidden md:table` / `md:hidden`): `process-table.tsx`, `gpu-view.tsx` (VRAM processes, transcode streams), `git-mirror-panel.tsx`, `listening-ports.tsx`, `proxy-routes.tsx`. `process-table.tsx` in particular (983 lines, the densest screen in scope) mirrors the desktop column set into a labeled-line card layout and explicitly documents which column it drops (thread count) and why (`process-table.tsx:814-816`) — nothing load-bearing (name, CPU, mem, disk I/O, container attribution) is lost at 390px.
- **No fixed-viewBox/fixed-width SVG overflow anywhere in scope.** `net-throughput.tsx`, `net-compare.tsx`, `disk-growth.tsx`, `resource-overview.tsx`'s `HistoryChart` all use `viewBox` + `preserveAspectRatio="none"` + `className="w-full"` with only height pinned — genuinely fluid width. `treemap.tsx` goes further and measures its container with a live `ResizeObserver` rather than trusting CSS at all. `thermal-gauge.tsx` is the one fixed-pixel SVG (140×140) but it's small enough to never approach 390px width regardless of layout.
- **`.logbox` (`globals.css:235-247`) wraps instead of scrolling**: `white-space: pre-wrap; word-break: break-all` — confirmed against the code comment citing a real 549-character worst-case line (`immich_postgres`). No horizontal overflow risk in `/logs` from line length.
- **`min-w-0` + `truncate` discipline is the house style and is followed almost everywhere** — dozens of correct instances were read across `resources`, `networks`, `disk-*`, `proxy-*`, `git-*`, `gpu-view.tsx`, making the one miss in `settings-widgets.tsx` legible as a real bug rather than an inconsistent convention.
- **`log-console.tsx:320`'s sticky toolbar is deliberately desktop-only** (`md:sticky md:top-0`) with an explicit comment that mobile already owns the top edge via its own bar — avoids stacking two sticky headers on a 390px-tall viewport.
- Two-line wrap fix already applied at `networks/page.tsx:438-442` for the container footprint row, with a code comment describing the exact 390px failure it fixes (two differently-named containers truncating to the same string) — evidence this file has already been through a narrow-viewport pass.

## Needs browser confirmation

- Whether the nested-scroll regions (`git-commit-stream.tsx`, `hermes-activity.tsx`, each `LogTrack`'s own `overflow-y-auto` body) actually compete with page scroll under a real touch drag, or whether momentum scrolling hands off cleanly at the region boundary — this is real device/browser behavior, not something inferable from CSS.
- Whether `HaSwitchControl`'s 28×48px `md:` hit area is actually reachable/comfortable on a real ~9-11" tablet in portrait, versus my inference from the pixel math.
- `settings-section-nav.tsx`'s hidden-scrollbar rail on WebKit (see P3) — needs an actual iOS Safari / Chrome render to see if a scrollbar paints.
- The `settings-widgets.tsx:177` overflow bug (P1) — confirmed by CSS/flexbox reasoning, but worth a quick visual check with a genuinely long widget URL to see the actual pixel overflow.
