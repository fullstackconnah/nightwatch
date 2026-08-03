# Performance audit — nightwatch dashboard (non-kiosk)

Scope: 15 routes under `src/app/(dash)/` + `/login`, 63 non-kiosk components, client hooks in
`src/lib/`. Audit only — no source files were modified.

## Score

| Dimension | Score (0–4) | Note |
|---|---|---|
| Polling budget | 3 | Every interval is deliberate and documented; SWR pauses in background tabs; two SSE streams don't. |
| `/logs` surface | 2 | No virtualisation of the line list; well-bounded buffers otherwise (rAF-coalesced, batched IndexedDB writes). |
| Heavy tables/visuals | 2 | No row virtualisation anywhere; `/resources`' container rows and treemap re-render every 1s tick regardless of tab. |
| Re-render behaviour | 2 | The `useTelemetryStream` 1Hz tick forces full re-sorts/re-renders on `/resources` and `/networks` even when values are unchanged. |
| Bundle | 3 | Lean deps (no chart lib), `d3-hierarchy` scoped to Treemap only, `lucide-react` named imports. Nothing obviously mis-imported. |
| Paint cost | 3 | Static composited background; a couple of unthrottled `box-shadow` pulse animations on rare states. |
| Long-session memory | 3 | Ring buffers and archive all have real caps; one uncapped array (`LogTrack`'s `earlier`) reachable only by repeated manual clicks. |

## Polling & timer budget

| Source | Cadence | file:line | Route(s) | Justified? |
|---|---|---|---|---|
| `useContainers` | 5s | `src/lib/client.ts:49-54` | `/`, `/containers` | Yes — primary state surface |
| `useHost` (VitalsStrip) | 5s | `src/lib/client.ts:56-61`, used at `src/components/vitals-strip.tsx:10` | `/` | Yes |
| `useWidgets` | 20s | `src/lib/client.ts:63-68` | `/`, `/resources` | Yes — 3rd-party widget data, slow-changing |
| `useResources` | 10s | `src/lib/client.ts:70-75` | `/`, `/containers`, `/resources` | Yes |
| `useTranscodes` | 5s | `src/lib/client.ts:77-82` | `/resources` (GPU tab only) | Yes |
| `useProcesses` | 2s | `src/lib/client.ts:84-92` | `/resources` (ALL tab only, null-key gated) | Yes — explicitly gated off for the other 5 tabs |
| `useSmart` | 30s | `src/lib/client.ts:97-99` | `/resources` (disk tab only) | Yes — matches 5-min collector cadence |
| `useNetwork` | 15s | `src/lib/client.ts:103-105` | `/networks` | Yes |
| `useHa` | 3s | `src/lib/use-ha.ts:36-40` | `/smarthome` (out of the 6 named routes) | Yes |
| `useHermesStatus` / `useHermesActivity` | 10s / 30s | `src/lib/use-hermes.ts:30-42` | `/hermes` | Yes |
| `useGit` | 60s | `src/lib/use-forgejo.ts:12-17` | `/git` | Yes |
| `useProxyManager` | 30s | `src/lib/use-npm.ts:16-21` | `/proxy` | Yes |
| dockerNetworks `useSWR` | 30s | `src/app/(dash)/networks/page.tsx:483-487` | `/networks` | Yes |
| `useContainers` (footprint) | 15s | `src/app/(dash)/networks/page.tsx:238` | `/networks` | Yes — a 2nd instance of the same SWR key, deduped by SWR's cache, not an extra request |
| metrics-history `useSWR` | 30s, **only when a non-LIVE range is picked** | `src/app/(dash)/resources/page.tsx:640-649` | `/resources` | Yes — costs nothing in the default state |
| `useTelemetryStream` (SSE) | continuous, 1Hz push from server | `src/lib/client.ts:153-195`, server loop `src/lib/telemetry.ts:18,247-261` | `/resources`, `/networks` | Yes, but see re-render finding below |
| `useLogStream` (SSE) | continuous, event-driven | `src/lib/use-log-stream.ts:98-266` | `/logs` | Yes |
| `useNow` shared clock | 1s, single shared timer, 0 when nothing subscribes | `src/lib/use-now.ts:21-45` | container cards with sub-minute uptime | Yes — explicitly built to avoid N timers |
| `LogTrack`/`LogConsole` rate-tick | 10s (`CLOCK_TICK_MS`) | `src/lib/log-types.ts:104`, used `src/components/log-track.tsx:250-253`, `src/components/log-console.tsx:191-196` | `/logs` | Yes — only runs while tracks are selected |
| `useLogArchive` visibilitychange flush | event-driven, not polling | `src/lib/use-log-archive.ts:80-91` | `/logs` | Yes |
| `useDiskUsage` | 0 (manual/lazy, null-key) | `src/lib/client.ts:112-118` | `/resources` disk drill-down | Yes |

**Pausing in background tabs:** every `useSWR`-based hook above pauses automatically — SWR v2's
default `refreshWhenHidden: false` skips `refreshInterval` revalidation while
`document.visibilityState !== "visible"` (confirmed in `node_modules/swr`, and called out explicitly
in `src/lib/use-ha.ts:4-8`). **The two `EventSource` streams do not pause.** `useTelemetryStream`
(`src/lib/client.ts:158`) and `useLogStream` (`src/lib/use-log-stream.ts:164`) keep receiving and
processing server-pushed events at their normal cadence in a backgrounded tab — there is no
`visibilitychange` handler anywhere in either hook. On `/resources` and `/networks` this means the
1Hz sample keeps landing and (per the re-render finding below) keeps forcing recomputation even
while the tab sits behind another window on the desktop machine this app is "left open on for days"
(`CLAUDE.md`). Bandwidth cost is trivial (a few hundred bytes/sec); the CPU/re-render cost is not
free, see Findings.

## Per-route requests/min (the six named routes)

| Route | HTTP polls/min | Persistent streams | Notes |
|---|---|---|---|
| `/` (overview) | **33** (12 containers + 12 host + 3 widgets + 6 resources) | none | `useContainers` and `useResources` are also both live on `/containers`, so navigating between `/` and `/containers` doesn't add polls — SWR dedupes the shared key. |
| `/resources` (default CPU tab) | **9** (6 resources + 3 widgets) | 1 SSE (telemetry, 1Hz) | +2/min if the DISK sub-tab is open (SMART), +30/min if the ALL tab is open (processes), replacing the treemap/rows entirely. |
| `/networks` | **10** (4 network + 2 docker-networks + 4 containers-footprint) | 1 SSE (telemetry, 1Hz) | |
| `/containers` | **18** (12 containers + 6 resources) | none | |
| `/logs` | **~0** HTTP polls (only the CLOCK_TICK 10s timer, which is local, not a request) | 1 SSE (multiplexed log stream) | Genuinely the cheapest route in request terms; all its cost is client-side render/DOM/IndexedDB, covered below. |
| `/gpu` | 0 directly — server-side `redirect()` to `/resources?metric=gpu` (`src/app/(dash)/gpu/page.tsx:6`) | — | Lands on `/resources` GPU tab: 6 (resources) + 3 (widgets) + 12 (transcodes) = **21/min** + 1 SSE. |

No route sits anywhere near a concerning request rate; the highest, `/` at 33/min, is ~1 request
every ~1.8s spread across 4 independent keys, all cheap JSON payloads. This is a well-budgeted
polling design.

## Findings

### P1 — `/resources`' container list and treemap re-render every second regardless of tab
`src/app/(dash)/resources/page.tsx:605-619` derives `active`/`idle` via `useMemo(..., [containers,
metric, latest])`, and `latest = samples[samples.length - 1]` (`page.tsx:603`) is a **new object
reference on every 1Hz telemetry tick** (`src/lib/client.ts:174-178`, `seriesFor`/subscription
appends a fresh sample). That means on the CPU/MEM/NET/DISK-IO tabs (the common case — DISK, GPU
and ALL are excluded from this code path), the full container list is re-sorted and every
`ContainerRow` (`page.tsx:396-540`, not wrapped in `React.memo`) re-renders once a second, for as
long as `/resources` is open — including in a backgrounded tab, per the SSE finding above.
`treemapItems` (`page.tsx:667-670`) recomputes on the same cadence; it's deferred via
`useDeferredValue` (`page.tsx:673`) so it can't block typing/clicking, but `Treemap`'s own
`layoutTreemap` call (`src/components/treemap.tsx:117`) is **not memoized** — it reruns the
d3-hierarchy `sum`/`sort`/squarify layout and produces a fresh `rects` array every render, moving
~20-24 absolutely-positioned cells every second even when nothing changed. Verified in code; actual
frame cost needs profiling, but the mechanism (unconditional 1Hz re-sort + re-layout + N unmemoized
row renders) is real and applies to the route this dashboard's own PRODUCT.md names as the "what is
eating this box" answer surface.
**Fix shape:** memoize `active`/`idle` on the actual `valueOf()` results (not on `latest`'s
identity), wrap `ContainerRow` in `React.memo`, and memoize `layoutTreemap`'s result on
`(items, width, height)`.

### P1 — `/logs` renders every buffered line as a real DOM node, no virtualisation
`LogTrack` (`src/components/log-track.tsx:733-742,782-790`) maps `filtered` — up to the full
`LOG_BUFFER_CAP` of 2000 lines per container (`src/lib/log-types.ts:111`) — straight into
`LogRow` elements inside a fixed-height (`11rem`/`17rem`) `overflow-y: auto` box
(`log-track.tsx:557,691-693`). With up to `MAX_TRACKS = 6` tracks on the floor
(`log-types.ts:119`), a session that has been open long enough to fill every ring — or one where the
reader clicks "load earlier" repeatedly (`log-track.tsx:343-371`, `EARLIER_PAGE = 500` lines per
click, `earlier` state has no upper cap of its own) — can mount **thousands of off-screen DOM
nodes** simultaneously. `LogRow` is not `React.memo`'d (only its child `AnsiText` is,
`ansi.tsx:350`), so a parent re-render re-invokes every visible `LogRow`'s function body. This is
mitigated in practice by `useLogStream`'s rAF-coalesced re-renders (one state bump per animation
frame no matter how many lines land in it, `use-log-stream.ts:120-126`) and by the host's genuinely
low log rate (~17 lines/min fleet-wide, per the codebase's own measurement) — so day-to-day this
never bites. It becomes real on a restart-burst (~200 lines in a few seconds, called out in
`log-track.tsx:117-119`) or on a long-lived session that has scrolled back through a lot of
archive. **Verified in code** (no `overflow-anchor`/virtualisation library, no windowing); **not
profiled** — could not measure actual paint cost without a live burst.
**Fix shape:** virtualize `LogTrack`'s line list (even a simple windowed render keyed to
`scrollTop`) once buffer length passes a few hundred lines; memoize `LogRow`.

### P2 — `strippedById` rebuilds the whole track's stripped-text map on every buffer change
`src/components/log-track.tsx:296-300`: `useMemo(..., [allLines])` reruns `stripAnsi` over **every**
line in the buffer (up to 2000) whenever `allLines` changes — which happens on every arrival batch
and every "load earlier" click — rather than incrementally stripping only the new lines. Bounded by
the rAF coalescing above (at most once per animation frame), so this is O(buffer size) per frame
during a burst rather than per line, but it's still doing 2000 regex-strip passes on a frame where
only 1-5 lines actually changed.
**Fix shape:** key the strip cache by line id and only compute for ids not already in the map
(the map is already keyed by id, `log-track.tsx:298`, it's just discarded and rebuilt from scratch
each time instead of extended).

### P2 — two `EventSource` streams never pause on `visibilitychange`
Covered above under "Polling & timer budget." `src/lib/client.ts:158` (telemetry) and
`src/lib/use-log-stream.ts:164` (logs) keep processing server-pushed events at full cadence in a
backgrounded tab, which given the P1 above means `/resources` continues its 1Hz re-sort/re-layout
work even when not visible. Every other polling hook in the app (all SWR-based) already gets this
for free from SWR's default; these two hand-rolled subscriptions don't have an equivalent guard.
**Fix shape:** gate the `next()`/`bumpVersion()` calls (or the render-triggering state update) on
`document.visibilityState`, still consuming and buffering events so nothing is lost, just not
re-rendering until visible again.

### P2 — `box-shadow` pulse animations run continuously for restarting/unhealthy states
`src/app/globals.css:124-130` (`.dot-restarting`, 1.6s; a second class at 0.9s) animates
`box-shadow`, which is a paint-triggering property, not a compositor-only one (`transform`/`opacity`
would be free). Scoped to a single 8×8px dot per affected container, and only running while that
container is actually `restarting`/`unhealthy` — a normally-rare, self-limiting state — so this is
low severity, but on a host with several containers cycling (e.g. mid-redeploy) it's N concurrent
paint-animating elements rather than 1. `prefers-reduced-motion` is already respected
(`globals.css:155`, `230`, `297`, `330`, `365`), which is the right mitigation for the class of
readers who'd feel this most.
**Fix shape:** if this is ever revisited, an animated `filter: drop-shadow()` or a duplicated
pseudo-element with `transform: scale()` + `opacity` would move the animation off the paint path;
not worth doing pre-emptively given the scope (rare state, tiny area).

### P3 — `LogTrack`'s `earlier` archive-load state has no cap of its own
`src/components/log-track.tsx:225-371`: each "load earlier" click prepends up to 500 more lines
(`EARLIER_PAGE`) with no ceiling on how many times a reader can click, unlike every other buffer in
this codebase (`LOG_BUFFER_CAP`, `ARCHIVE_LINE_CAP`, `SEEN_CAP` in `use-log-archive.ts:33`). In
practice this is self-limiting: `earlierAvailable` is bounded by how much history the archive
actually holds for that one container, and `ARCHIVE_LINE_CAP` caps the *whole* archive at 10,000
lines fleet-wide (`log-archive.ts:30`), so a single container realistically can't push `earlier`
into the thousands. Flagging only because it's the one buffer in this file that doesn't state its
own ceiling the way its siblings do.
**Fix shape:** none needed unless the archive cap itself grows; not urgent.

## Already correct — credit where due

- **`useNow`** (`src/lib/use-now.ts`): one shared module-level 1Hz timer for every uptime counter on
  screen, torn down when the last subscriber unmounts, explicitly built to avoid "26 cards, 26
  timers." This is the right pattern and the comment explaining why is worth keeping as a model for
  the rest of the app.
- **SWR polling pauses in background tabs by default** (`refreshWhenHidden: false`), and the team
  already knows and documents this (`src/lib/use-ha.ts:4-8`) rather than re-deriving it per hook.
- **Null-key lazy/gated fetching**: `useDiskUsage` (`client.ts:112-118`) only fetches once a disk
  row is expanded; `useProcesses` (`client.ts:84-92`) is gated behind the ALL tab so the ~476-row
  `/proc` scan never runs for the other five `/resources` tabs. Both documented in-line as
  deliberate.
- **`useLogStream`'s rAF-coalesced rendering** (`use-log-stream.ts:120-126`): a 200-line restart
  burst produces one React render per animation frame, not 200. This is the single most important
  performance decision on `/logs` and it's already in place.
- **Batched IndexedDB writes** (`src/lib/log-archive.ts:253-266`): a 1.5s/250-line debounce instead
  of a transaction per line, with byte- and count-based eviction that trims to 90% of the ceiling
  rather than one-in-one-out churn (`log-archive.ts:47`).
- **`useDeferredValue`** used correctly in two places under real 1Hz/2s pressure: the `/resources`
  treemap (`page.tsx:673`) and `ProcessTable`'s search filter (`process-table.tsx:435`), both with
  comments explaining exactly what they're protecting (typing/interaction latency).
- **`ProcessTable` pagination** (`process-table.tsx:70,459-460`): caps the unfiltered process view
  at 40 rows instead of mounting ~476, with an explicit "show more"/"show all" escape hatch.
- **Shared, refcounted server-side telemetry collector** (`src/lib/telemetry.ts:18,282-297`): one
  1Hz Docker-stats loop feeds every connected browser tab via SSE, not one loop per tab; it starts
  on first subscriber and tears itself down (including poisoned rate-state) when the last one
  disconnects.
- **Lean bundle surface**: no chart library (hand-rolled SVG sparklines/gauges in `charts.tsx` and
  `sparkline.tsx`), `d3-hierarchy` is the one non-trivial dependency and it's only reachable from
  `Treemap`, which only renders on `/resources`; `lucide-react` is imported per-icon
  (`import { X } from "lucide-react"`) everywhere checked, which is already tree-shakeable.
- **`AnsiText` memoized** (`ansi.tsx:350`) even though its parent `LogRow` isn't — partial credit,
  it's the more expensive of the two (SGR parsing) to re-run.
- **Static, composited body background** (`globals.css:52-65`): one gradient/grid texture set once,
  no `background-attachment: fixed`, nothing that forces a scroll-driven repaint.
