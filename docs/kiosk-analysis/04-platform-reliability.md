# Kiosk platform & 24/7 reliability review

Lens: unattended iPad-as-PWA reliability over weeks of uptime on a flaky LAN
link. Scope: `/kiosk` route only (page, layout, all `kiosk-*` components,
`/kiosk/api/*` routes, `use-now.ts`, `use-voice.ts`, `kiosk-client.ts`,
`middleware.ts`, `auth.ts`). No code changed — analysis only.

## Verified defects (cited)

### 1. A transient network blip silently de-elevates an admin session
`src/lib/kiosk-client.ts:45-53` — `refreshKioskElevation()` wraps its `fetch`
in try/catch and returns `{ elevated: false }` on **any** failure, indistinguishable
from the server genuinely saying "not elevated."

`src/app/kiosk/page.tsx:129-137` — `slideExpiry()` (the handler that runs on
every tap while elevated, throttled to once per `SLIDE_MIN_INTERVAL_MS`) does:
```
refreshKioskElevation().then((s) => {
  if (lockingRef.current) return;
  setExpiresAt(s.elevated && s.expiresAt ? s.expiresAt : null);
});
```
A dropped packet or a few seconds of wifi flakiness during that call collapses
`s.elevated` to `false` and the kiosk locks — same visible effect as the real
5-minute window expiring, except it can happen seconds into a session, and the
person standing at the tablet has no way to tell "your PIN window expired"
from "the network hiccuped." Given the brief's own framing ("sometimes over a
flaky wifi link"), this will fire in the field.

### 2. Status-strip health/vitals render stale numbers as if live
`src/lib/kiosk-client.ts:19-24` and `:27-32` — both `useKioskVitals` and
`useKioskHealth` set `keepPreviousData: true`.

`src/components/kiosk-status-strip.tsx:44-51`:
```
const { data: vitals, error: vitalsError } = useKioskVitals(5000);
const { data: health, error: healthError } = useKioskHealth(5000);
const dead = health?.dead ?? 0;
const unhealthy = health?.unhealthy ?? 0;
const severity = dead > 0 ? "bad" : unhealthy > 0 ? "warn" : null;
const metricsDown = Boolean(vitalsError) && Boolean(healthError);
```
`metricsDown` (the only "something's wrong" indicator on this strip) requires
**both** endpoints to fail at once. If only `/kiosk/api/health` errors (e.g. a
Docker-socket hiccup) while `/kiosk/api/vitals` keeps succeeding, `health`
still holds the last good payload (via `keepPreviousData`) and the dead/
unhealthy chip and the "N running" figure keep rendering that stale snapshot
with zero visual difference from a fresh read. This is the dashboard's own
headline "is the homelab healthy" signal, and it can go quietly wrong.

Contrast with `src/components/kiosk-display.tsx:188-210` (`useWeatherView`),
which does this correctly: it tracks `lastOk` explicitly and returns a
`"ready-stale"` status the UI renders with a visible `StaleTag`
(`kiosk-display.tsx:264-271`). The weather band already implements the
project's own "honest states" principle; the status strip does not.

### 3. Kiosk smart-home hub has the same silent-stale gap, plus blind actions
`src/components/kiosk-hub.tsx:117-122` (`useKioskHa`) also polls with
`keepPreviousData: true`. `KioskHub`'s render guard only distinguishes
first-load failure:
```
if (isLoading && !data) return <HubSkeleton />;
if (Boolean(error) && !data) return <HubLoadError error={error} />;
if (!data) return null;
```
(`kiosk-hub.tsx:686-688`). Once one successful load has happened, every
subsequent poll failure leaves `error` truthy but `data` still holds the old
entities, and the tile grid renders it as current — no stale badge anywhere
in `LightsSection`/`SwitchesSection`/`ClimateSection`. Worse than the status
strip's case: this surface is interactive. Someone can tap a light tile whose
"on/off" state is minutes stale during an outage; the optimistic-update path
in `runAction` (`kiosk-hub.tsx:142-177`) still fires the POST against
whatever `entityId` they tapped, so the action itself is fine, but the
tile the tap was based on may have already been showing the wrong state.

### 4. No error boundary anywhere in the app — one bad render blanks the kiosk
Confirmed via glob: there is no `error.tsx` or `global-error.tsx` anywhere
under `src/app/**`, and no `componentDidCatch`/`ErrorBoundary` anywhere in
`src/`. There is also no `location.reload()` call anywhere in the codebase —
nothing self-heals. An unhandled exception in any child component under
`/kiosk` (a weather-shape surprise, an HA entity the client doesn't expect,
a `TypeError` from a null the API contract didn't promise) unmounts the whole
React tree to a blank white screen. For a device meant to run unattended for
weeks, this is the single highest-impact gap: recovery today requires a
person physically walking up and reloading the tablet.

### 5. No service worker — no update signal after a deploy, no offline shell
Confirmed via glob/grep: no `sw.js`, no `serviceWorker.register` anywhere.
Two consequences for a kiosk that's designed to stay open for weeks:
- **Stale JS forever.** A deploy replaces server-side chunks; an already-open
  kiosk tab keeps running the JS it loaded at last reload indefinitely — there
  is nothing that tells it a new version exists, so bugfixes/features never
  reach a device that isn't manually reloaded. `KioskAdminPanel`'s
  `<Link href="/">` (`kiosk-admin-panel.tsx:60-65`) is the one place that
  *could* trigger a client-side RSC fetch for a chunk that no longer exists
  post-deploy — low-traffic path (admin-only), but it's the one spot a stale
  session could hit a dead chunk mid-session.
- **No offline app shell.** If the installed PWA gets relaunched (iPad reboot,
  iOS killing the backgrounded PWA to reclaim memory) at a moment the LAN/wifi
  is down, there's no cached shell to fall back to — Safari's own offline
  error page replaces the kiosk, and nothing auto-retries it.

### 6. iOS text-selection/callout is not suppressed outside a couple of opt-ins
`src/app/globals.css:32-35` is the only global touch-behavior rule:
```
html {
  color-scheme: dark;
  -webkit-tap-highlight-color: transparent;
}
```
No `-webkit-touch-callout: none` or `user-select: none` exists anywhere else
in `globals.css` (grepped for both, plus `overscroll-behavior`, which is only
set on `.logbox`, not the kiosk shell). The only per-component opt-in found is
`select-none` on the clock's wrapper div (`src/components/kiosk-clock.tsx:28`).
Everything else — weather figures, hub tile names, timer names, forecast
strip — is still selectable/long-press-able. A stray touch (someone wiping
the screen, a kid poking at the tablet) can pop iOS's copy/lookup/share
callout bubble or a text-selection handle, and nothing on this ambient,
unattended surface ever dismisses it — it sits there until a person taps it
away.

### 7. Minor: the interaction-driven elevation refresh has no unmount guard
`src/app/kiosk/page.tsx:86-94` (the mount-time elevation-recovery effect) is
careful: it tracks a `cancelled` flag and checks it before calling
`setExpiresAt`. The interaction-driven `slideExpiry` at `page.tsx:129-137`
does not follow the same pattern — a straggling response could set state
after the effect that created it was superseded. Low real-world impact since
`/kiosk` never unmounts under normal operation (it's the whole session), but
inconsistent with the safer pattern 40 lines above it in the same file.

### Confirmed correct (worth noting, not a defect)
- `src/lib/use-now.ts:47-56` — the shared 1 Hz clock recomputes `Date.now()`
  fresh on every tick rather than incrementing a counter, so `setInterval`
  coalescing/drift under a backgrounded or throttled tab never accumulates
  into a wrong displayed time — only cadence, never correctness, can wobble.
- `src/components/kiosk-timers.tsx:16-19,161-169` — timers are tracked by
  absolute `endsAt`, not a decrementing counter, so a backgrounded tab can't
  desync a countdown; correctly designed against exactly the failure mode a
  wall tablet is prone to.
- `src/lib/use-voice.ts:35,238` — recording is hard-capped at
  `MAX_RECORDING_MS = 60_000` and `teardownStream` (called from `finish()`
  and an unmount effect at line 134) stops all `MediaStream` tracks and closes
  the `AudioContext` — no dangling mic/audio-context leak across sessions.
- `src/components/kiosk-display.tsx:238-247` — `useKioskBriefing` unsubscribes
  (`null` SWR key) whenever `period !== "morning"`, so the expensive briefing
  poll only ever runs during the one period it's needed.

## Platform gaps

- **Screen Wake Lock API**: not called anywhere in the codebase (grepped, no
  hits). It genuinely is supported in iOS Safari 16.4+ (real support status,
  not a guess) — but it requires a secure context, and per
  `docs/PENDING-SETUP.md` this origin is still plain HTTP. So today, even
  adding `navigator.wakeLock.request('screen')` would silently no-op on this
  deployment. Until HTTPS lands, the only levers that keep an iPad's screen
  on are device-level (`Settings → Display & Brightness → Auto-Lock: Never`)
  or Guided Access (manually triggered, per-device, not app-controllable) —
  neither of which this app can set for the owner.
- **Standalone PWA shell**: correctly configured. `kiosk.webmanifest`
  (`display: "standalone"`), the legacy `apple-mobile-web-app-capable` tag
  worked around Next only emitting the modern one
  (`src/app/kiosk/layout.tsx:20-27`, with the reasoning documented inline),
  and safe-area padding via `env(safe-area-inset-*)` plus `viewportFit:
  "cover"` (`kiosk-theme.tsx:224-227`, `kiosk/layout.tsx:35`) are all present
  and consistent with each other.
- **Pinch-zoom / 300ms tap delay**: handled — `maximumScale: 1,
  userScalable: false` (`kiosk/layout.tsx:40-41`) both blocks accidental
  pinch-zoom on a wall surface and, as a side effect, removes the legacy
  double-tap-zoom ambiguity that causes the 300ms tap delay on older mobile
  Safari.
- **Touch-callout / selection suppression**: gap — see Verified defect #6.
- **Offline/app-shell caching**: gap — tied to Verified defect #5; no service
  worker exists to precache the shell or gate a versioned reload.

## Ranked fixes

| Fix | Failure it prevents | Cost (hrs) | Severity |
|---|---|---|---|
| Don't collapse "network unreachable" into "not elevated" in `refreshKioskElevation`/`slideExpiry` — only clear `expiresAt` on an explicit server `elevated:false`, keep it on fetch failure | Wifi blip kicks an active admin session back to the PIN pad | 1–2 | High likelihood, medium impact |
| Add an `error.tsx` under `src/app/kiosk/` (Next's built-in boundary) with a short-delay auto `location.reload()` plus a manual "reload" tap target | Total blank-screen outage from any unhandled render exception, unrecoverable without physical intervention | 1 | Low-medium likelihood, very high impact — top priority given "a display that dies at 3am is worse than one with fewer features" |
| Add a daily quiet-hours self-reload (e.g. during the existing night period) | Both #5's "stale JS forever" and gives every long-uptime memory/state issue a daily reset, without needing a service worker or HTTPS | 1–2 | Medium likelihood, medium impact |
| Track `lastOk` + a `StaleTag` for `useKioskVitals`/`useKioskHealth`, same pattern `useWeatherView` already uses | Status strip silently showing old health/vitals as current during a partial outage | 2–3 | Medium likelihood, high impact (this is the dashboard's core promise) |
| Same stale-tracking treatment for `useKioskHa`, plus disabling tile taps while stale | Acting on a smart-home tile whose on/off state is known-stale | 2–3 | Medium likelihood, medium impact |
| Add `-webkit-touch-callout: none; user-select: none;` (with per-element `select: text` opt-back-in only where genuinely useful, e.g. none currently needed) to the kiosk theme scope root | Stray long-press popping an iOS callout/selection bubble that never auto-dismisses | 0.5 | High likelihood over weeks, low severity (visual annoyance, not a crash) |
| Give `slideExpiry`'s promise the same `cancelled`-guard pattern already used at `page.tsx:86-94` | Theoretical stale-closure state write; consistency | 0.25 | Low likelihood, cosmetic |

## Unlocked by HTTPS

Dependency map — what specifically changes once TLS lands (per
`docs/PENDING-SETUP.md`'s NPM item):

- **Microphone / voice** — `useVoiceSupport()` (`use-voice.ts:50-58`) gates on
  `window.isSecureContext && navigator.mediaDevices?.getUserMedia`; both are
  false on plain HTTP. Already the documented reason in PENDING-SETUP.md.
- **Screen Wake Lock API** — `navigator.wakeLock` requires a secure context
  per spec. Not implemented today either way (see Platform gaps), but even if
  it were added now it would be inert until HTTPS ships.
- **Service Worker registration** — also requires a secure context per spec.
  This blocks the "real" fix for stale-JS-after-deploy (a versioned SW with
  an update-available signal) and any offline app-shell caching. The
  daily-reload workaround recommended above deliberately does **not** depend
  on HTTPS, so it's worth shipping now rather than waiting on the NPM/TLS
  rollout.
