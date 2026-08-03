# /kiosk performance audit — sustained cost on a low-power tablet

Scope: `src/app/kiosk/**`, `src/components/kiosk-*.tsx`, `src/lib/kiosk-client.ts`,
`src/lib/use-now.ts`, `src/lib/use-ha.ts`, `src/lib/weather.ts` (client paths). Audit
only — no source files were modified.

## Score (0-4)

**3 — good.** The team already applied real performance discipline in the places
that matter most for a weeks-long unattended session: one shared 1 Hz clock instead
of per-card timers, absolute `endsAt`/`lockedUntil` timestamps instead of decrementing
counters (immune to background-tab drift), a bounded voice-exchange list, no fetch
waterfalls, and a default layout (Glance) that is deliberately the lighter of the two.
The deductions are for one genuine layout-property animation in `kiosk-sky.tsx`
(`top`, not `transform`) driving a full-viewport 90-second transition four times an
hour forever, and for `KioskHub`'s subsections re-rendering in full on every ~7s HA
poll because nothing memoizes them against SWR's always-fresh object identity. Both
are real, fixable, and neither threatens the panel degrading or dying unattended —
hence 3, not lower.

## Poll & timer budget

Idle, non-elevated, day/evening period, default theme. "Justified?" judges cadence
against what's actually moving on screen, not the endpoint's importance.

| Source | Cadence | file:line | Justified? |
|---|---|---|---|
| `useKioskVitals` (host cpu/mem) | 5s (60/req/... = 12/min) | `src/lib/kiosk-client.ts:54-59` | Borderline — cpu/mem shown as rounded whole percentages (`kiosk-status-strip.tsx:78-81`); a value that visibly moves maybe once every few seconds doesn't need 5s, 10-15s would look identical |
| `useKioskHealth` (container counts) | 5s = 12/min | `src/lib/kiosk-client.ts:62-67` | No — container running/dead/unhealthy counts change on the order of minutes, not 5s; `kiosk-glance.tsx` independently proves this by polling the *same* data at 15s (`kiosk-glance.tsx:42`) with no visible loss of freshness |
| `useKioskHa` (lights/switches/scenes/climate/sensors) | 7s ≈ 8.6/min | `src/components/kiosk-hub.tsx:36,121` (`POLL_MS` at line 52) | Yes — this is the one surface with real user-actuated state (a light someone just switched from a phone), 7s is a reasonable optimistic-update reconciliation window; already pauses while an action POST is in flight (`kiosk-hub.tsx:121,153,172`) |
| `useKioskBriefing` | 10s while `active && no digest/news yet`, then 0 (stops) | `src/components/kiosk-display.tsx:234,239-248` | Yes — self-limiting, morning-only, and the comment documents why (first daily call is ~45s) |
| `useWeatherView` (weather card) | 15 min | `src/components/kiosk-display.tsx:173,190-193` | Yes |
| `KioskSky` ambient tint | 15 min, **same SWR key** as `useWeatherView` (`"/kiosk/api/weather"`) | `src/components/kiosk-sky.tsx:95-98` | Good — SWR dedupes this to zero extra requests; noted under Already correct |
| `KioskAttentionCard` | 30s = 2/min | `src/components/kiosk-attention.tsx:22,25-28` | Yes — matches the "silent unless something's wrong" design; 30s is an acceptable detection lag for a wall alert |
| `useGlanceHealth` (Glance layout only) | 15s = 4/min | `src/components/kiosk-glance.tsx:41-43` | Yes |
| Elevated-only: `useContainers` (admin panel) | 5s | `src/components/kiosk-admin-panel.tsx:42` | Out of idle budget — only runs while PIN-elevated (bounded ~5 min window) |
| Elevated-only: `useHermesStatus` (voice panel) | 10s | `src/lib/use-hermes.ts:30-35`, called from `src/components/kiosk-voice.tsx:118` | Out of idle budget — elevated + voice-configured only |

**Idle request totals** (not elevated, not night):

- **Standard layout**: vitals 12 + health 12 + HA 8.6 + attention 2 + weather ~0.07
  ≈ **34.6 requests/min** (~2,076/hour, ~49,800/day).
- **Glance layout (the shipped default — `kiosk-glance.tsx` THESIS comment, and
  `page.tsx:34-39`'s `LAYOUT_STORAGE_KEY` default)**: health 4 + HA 8.6 + weather
  ~0.07 ≈ **12.7 requests/min** — Glance doesn't mount `KioskStatusStrip` or
  `KioskAttentionCard` at all, so vitals (5s) and attention (30s) never poll in the
  default configuration. This is a real, verified design win, not a suspicion.

**setInterval/setTimeout/rAF reachable from `/kiosk` at idle** (excluding SWR's own
internal poll timers, already counted above as requests):

| Timer | Cadence | file:line | Notes |
|---|---|---|---|
| Shared 1 Hz clock | 1/sec, **one interval for the whole app** | `src/lib/use-now.ts:26-40` | Started on first subscriber, cleared on last — see Already correct |
| Kitchen-timer chime loop | every 4s, **runs the moment any `KioskTimersButton` mounts**, regardless of whether a timer has ever been created | `src/components/kiosk-timers.tsx:41,121-126,135-143` | `KioskTimersButton` is always mounted (status strip and glance both render it: `kiosk-status-strip.tsx:120`, `kiosk-glance.tsx:193`), so this interval effectively runs for the panel's entire uptime. Cost per tick is negligible (`timers.some()` over a normally-empty array), but it's a timer with no reason to exist until the first timer is actually started — `startChimeLoopIfNeeded` should be called from `addTimer` instead of from `subscribe` |
| Period recompute (`useKioskPeriod`) | 1/min | `src/components/kiosk-display.tsx:54,90-93` | Fine at this cadence |
| Night-wake auto-revert | one-shot `setTimeout`, 60s, re-armed only on a wake tap | `src/app/kiosk/page.tsx:25,126-130` | Not recurring, no concern |

Total steady-state JS timers: **3** (1 Hz clock, 4s chime poll, 60s period tick) —
a genuinely lean budget. requestAnimationFrame only runs during active voice
recording (`src/lib/use-voice.ts:151,229`) and a single one-shot frame on an
attention-card arrival (`src/components/kiosk-attention.tsx:41`); neither runs at
idle.

## Findings

### P1 — `KioskSky` animates a layout property (`top`), not a compositor property, across a full-viewport layer
- **Location**: `src/components/kiosk-sky.tsx:87` (`const SKY_TRANSITION = "top 90s linear, opacity 90s linear"`), applied at lines 140-153 and 154-167 to two `position: absolute` divs inside a `fixed inset-0` ambient layer (line 130).
- **Impact**: every weather refresh (every 15 min, `SKY_REFRESH_MS` at line 31) that changes `sun.progress01` moves `glowY`/`washY` (lines 112-113), which the browser then animates via a CSS transition on `top` over 90 seconds. `top` is a layout-triggering property — even though the element is absolutely positioned and doesn't affect sibling layout, the browser still has to recompute that box's own geometry and fully repaint its blurred radial-gradient background on every animation frame for the full 90s, four times an hour, for as long as the tablet is on. A `transform: translateY()` equivalent would let the same 90s glide run compositor-only (GPU, no repaint) at effectively zero main-thread cost. This is the file's own house rule elsewhere in the codebase (`kiosk-voice.tsx:22-25` explicitly documents "transform/opacity, not layout properties" for the same reason) — `kiosk-sky.tsx` is the one place that doesn't follow it.
- **Compounding factor**: two of the sixteen kiosk themes (`aerogel`, `aurora`) put `backdrop-filter: blur()` on every `.panel` (`src/app/globals.css:556-557,715-716`). While the sky layer is mid-transition and one of those themes is active, the browser must also continuously re-blur the animating layer behind every panel on screen — the two costs stack. This only applies to 2 of 16 themes (opt-in), so it's noted here as a compounding risk rather than a separate baseline finding.
- **Recommendation**: replace the `top: ${y}%` positioning with a fixed `top` anchor plus `transform: translateY(...)`, keeping `opacity` in the same transition. No visual difference in the eased 90s glide; removes repaint cost from every occurrence.
- **Status**: verified in code (property name, transition target, and the file's own theme-detection logic are all read directly). The actual paint-timeline cost is suspected/needs profiling (a Safari Timelines recording on the target iPad would confirm frame cost), but the mechanism (`top` is not compositor-only) is a settled fact, not a guess.

### P2 — `KioskHub`'s five sections re-render in full on every ~7s HA poll, unmemoized
- **Location**: `src/components/kiosk-hub.tsx:683-729` (`KioskHub`), calling `useKioskHa()` at line 684; sections `LightsSection` (296), `SwitchesSection` (348), `ScenesSection` (388), `ClimateSection` (545) all take `ha`/`entities` as plain props with no `React.memo`.
- **Impact**: `useKioskHa` (line 118-183) returns a fresh object literal (`{ data, error, isLoading, runAction, actionErrors, isPending }`, line 182) on every render, and SWR hands back a newly `JSON.parse`d `data`/`entities` graph on every successful poll even when the underlying values are unchanged (`fetcher` in `src/lib/client.ts:25-34` does a plain `res.json()`, and SWR's default `compare` is reference equality). Because `KioskHub` itself re-renders on every 7s poll and none of its children are memoized, every tile in every section (lights, switches, scenes, climate cards, sensor chips — easily 10-30+ DOM nodes on a populated Home Assistant setup) gets its render function re-invoked every 7 seconds, forever, whether or not anything actually changed. React's diffing keeps this from being a hard freeze, but it's real, recurring main-thread work with no gate on it.
- **Recommendation**: wrap the five section components in `React.memo`, and pass them narrower, referentially-stable props (e.g. the specific entity arrays rather than the whole `ha` object; wrap the derived onCount/toggle closures in `useMemo`/`useCallback` keyed off entity content, or give SWR a custom `compare` that does a cheap shallow-equal on the entity arrays so unchanged polls don't force a new reference at all).
- **Status**: verified in code — SWR's fresh-JSON-per-poll behavior and the absence of any `memo`/`useMemo` boundary in this file are both directly observable. Actual frame-time cost is suspected/needs profiling.

### P2 — vitals and health are two separate polls at the identical 5s cadence
- **Location**: `src/components/kiosk-status-strip.tsx:45-46` — `useFreshness(useKioskVitals(5000))` and `useFreshness(useKioskHealth(5000))`, hitting `/kiosk/api/vitals` and `/kiosk/api/health` independently.
- **Impact**: two round trips every 5 seconds instead of one; not expensive individually on a LAN, but it's the single largest contributor to the 34.6 req/min standard-layout idle total, and `kiosk-glance.tsx:42` already demonstrates the health data reads fine at 15s.
- **Recommendation**: either slow both to 10-15s (health in particular — see poll-budget table) or, if a combined endpoint is easy on the server side, merge vitals+health into one `/kiosk/api/status` poll.
- **Status**: verified in code (two distinct SWR keys, same literal `5000` interval).

### P3 — kitchen-timer chime loop runs indefinitely with nothing to chime
- **Location**: `src/components/kiosk-timers.tsx:121-126` (`startChimeLoopIfNeeded`), called unconditionally from `subscribe` at line 138, which runs the instant any `KioskTimersButton` mounts (i.e., always — see the timer table above).
- **Impact**: negligible per-tick cost (an empty-array `.some()` every 4s), but it's a timer with no reason to be armed until the first timer actually exists. Purely a tidiness/battery-hygiene item, not a frame-rate risk.
- **Recommendation**: call `startChimeLoopIfNeeded()` from `addTimer` (line 161) instead of from `subscribe`, and let `stopChimeLoopIfIdle` additionally check `timers.length === 0`.
- **Status**: verified in code.

### P3 — finished-but-undismissed timers persist indefinitely
- **Location**: `src/components/kiosk-timers.tsx:53,66-73` (`persist`/`restoreOnce` against `localStorage["kiosk-timers"]`), no automatic eviction.
- **Impact**: a timer that finishes and is never tapped "Done" stays in `timers`/localStorage forever, silently chiming every 4s (`hasUnacknowledgedFinish`, line 113-115) until acknowledged or the kiosk is reloaded. This is bounded by how many timers a person manually starts (not automatic accumulation, so not a leak in the arrays-that-append-without-bound sense), but on a weeks-long session an abandoned "Laundry" timer could chime for that entire time. Cosmetic/UX rather than a resource-growth risk.
- **Status**: verified in code.

## Already correct

- **Single shared 1 Hz clock, not per-component timers.** `src/lib/use-now.ts:20-45` — one module-level `setInterval`, started on first subscriber and cleared on the last, explicitly built to avoid "26 cards each owning a `setInterval`" (the file's own comment, lines 8-9). Confirmed idle-live gating too: `subscribeIdle` (line 43-45) means a component that doesn't need ticking seconds (e.g. `KioskTimersButton` with zero active timers, `KioskPinPad` when not locked out) subscribes to nothing at all.
- **Absolute timestamps everywhere a duration is tracked**, immune to background-tab/sleep drift: kitchen timers track `endsAt`/`pausedRemainingMs` (`kiosk-timers.tsx:204-210`), PIN lockout tracks `lockedUntil` off the server's own value (`kiosk-pin-pad.tsx:30-34`), elevation countdown is `expiresAt - now` (`kiosk-admin-panel.tsx:44-46`).
- **Bounded voice history.** `MAX_EXCHANGES = 3` (`src/lib/use-voice.ts:265`) with an explicit `.slice(0, MAX_EXCHANGES)` on every append (`use-voice.ts:337`) — a wall tablet can't accumulate an unbounded scrollback here.
- **No fetch waterfalls.** Every kiosk data source (`useKioskVitals`, `useKioskHealth`, `useKioskHa`, `useWeatherView`, `useKioskBriefing`, `KioskAttentionCard`'s SWR) is an independent `useSWR` call fired on mount; nothing gates one panel's paint behind another's network round trip. `page.tsx`'s own mount-time elevation check (`page.tsx:99-110`) is fire-and-forget against the shell, not a paint blocker.
- **Optimistic HA actions pause the poll instead of racing it.** `kiosk-hub.tsx:118-183` sets `paused` during an in-flight action POST (`setPaused(true)` at line 153) specifically so a resync landing mid-tap can't stomp the optimistic UI update — a correctness-motivated design that also avoids a wasted extra request during the action.
- **Default layout is the lighter one.** Glance Board is the documented default for a fresh device (`page.tsx:27-30`) and, as shown above, polls roughly a third of what the Standard layout does at idle because it skips the status strip and attention card entirely.
- **Fonts: 23 `next/font` families loaded but every one is `preload: false`.** `src/components/kiosk-theme.tsx:55-80` — the file's own comment (lines 11-16) is correct that this means a font face only downloads when a theme actually using it is selected; one tablet only ever pays for its own 1-2 chosen families, not all 23.
- **Tree-shakeable icon imports.** Every kiosk component imports `lucide-react` icons by name (`import { AlertTriangle, Cloud, ... } from "lucide-react"` — e.g. `kiosk-display.tsx:24-41`, `kiosk-hub.tsx:25-35`) with no default/barrel import anywhere in the audited surface.
- **SWR key sharing eliminates a would-be duplicate poll.** `KioskSky` and `useWeatherView` both key on the literal string `"/kiosk/api/weather"` (`kiosk-sky.tsx:95`, `kiosk-display.tsx:190`) — SWR dedupes this to a single shared cache entry and a single 15-minute poll, not two.
- **Interaction throttling on the elevation refresh.** `SLIDE_MIN_INTERVAL_MS = 15_000` (`page.tsx:20`) caps how often a fast run of taps can hit `/api/auth/kiosk/refresh`, with an explicit comment explaining the tradeoff (page.tsx:16-19).
