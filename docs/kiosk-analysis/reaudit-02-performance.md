# /kiosk performance re-audit — verifying the fix wave against audit-02

Scope: `src/app/kiosk/**`, `src/components/kiosk-*.tsx`, `src/lib/kiosk-client.ts`,
`src/lib/use-now.ts`. Audit only — no source files were modified. Re-audit of
`docs/kiosk-analysis/audit-02-performance.md` (previously scored 3/4).

## Score (was 3/4, now 4/4)

**4 — excellent.** Both findings that drove the previous 3/4 deduction are
genuinely fixed, not just relabeled. `kiosk-sky.tsx`'s 90s crossfade is now
transform/opacity-only and the `top:50%` + `translate(-50%, calc(-50% +
Nvh))` replacement is arithmetic-equivalent to the old `top: N%` (verified by
hand below) — same visual drift, zero layout cost. `KioskHub`'s five
sections are `memo()`-wrapped against a genuinely stable `ha` object
(`useKioskHa`'s `useMemo`, SWR's real default `compare` — confirmed
`lite.dequal` in the installed `swr@2.2.5` package, not an assumption) and
the optimistic-update path still works correctly because a real optimistic
mutate *does* change `data`'s reference, correctly busting the memo where it
should. The vitals/health cadence drop (5s → 15s) is also verified exactly:
24 → 8 req/min for that component, arithmetically exact. No regressions
found in the stale-detection path, the optimistic HA flow, or the modal
focus-trap code. The two items still open (chime-loop-always-armed,
undismissed-timer persistence) are pre-existing P3s that were never named as
part of the 3/4 deduction, so their being unaddressed doesn't hold the score
down.

## Fix verification

### 1. `kiosk-sky.tsx` — `top` animation replaced with `transform`
**Verified equivalent, not just verified-present.** `SKY_TRANSITION` is now
`"transform 90s linear, opacity 90s linear"` (`kiosk-sky.tsx:72`) with `top`
pinned static at `"50%"` on both blobs (`kiosk-sky.tsx:140,154`); the drift
lives in `transform: translate(-50%, calc(-50% + ${Y - 50}vh))`
(`kiosk-sky.tsx:143,157`).

Hand-derivation of the claimed equivalence (`kiosk-sky.tsx:126-135`'s own
comment): the ancestor is `fixed inset-0` (`kiosk-sky.tsx:115`), so its
containing block is sized exactly to the viewport (`W×H`). Old code
(per audit-02) centered each blob on the point `top: Y%` via a `translate(-50%,-50%)`
self-centering transform — that combination places the blob's *center* at
`Y% of H` from the container's top, full stop.

New code: `top: 50%` places the anchor point at `0.5·H`. The transform's
`-50%` component re-centers on that anchor (percentages in `translate()`
resolve against the *element's own* box, same as before). The added
`(Y-50)vh` then shifts by `(Y-50)/100 · H` (1vh = 1% of viewport height, and
viewport height = `H` here). Net center position:

```
0.5·H + (Y-50)/100·H = 0.5·H + (Y/100)·H - 0.5·H = (Y/100)·H = Y% of H
```

— identical to the old `top: Y%` result. The claim that "`Nvh` is
numerically identical to what `top: N%` used to mean" is correct *because*
the ancestor is viewport-sized, not a coincidence-free assertion. No visual
regression from this change.

The compounding backdrop-filter risk noted in audit-02 (aerogel/aurora
themes blur every `.panel` while the sky layer animates) is also
structurally reduced: a transform/opacity animation can run compositor-only
even under a `backdrop-filter` ancestor, whereas the old `top` animation
forced a real layout+repaint pass on every frame regardless of theme. Not
zero-cost under those two themes (the GPU still resamples the blur region as
the layer moves), but no longer a main-thread cost — the finding is closed.

### 2. `kiosk-status-strip.tsx` — vitals/health cadence 5s → 15s
**Verified, arithmetically exact.** `useFreshness(useKioskVitals(15_000))` /
`useFreshness(useKioskHealth(15_000))` (`kiosk-status-strip.tsx:51-52`). At
5s: `60/5 × 2 = 24` req/min. At 15s: `60/15 × 2 = 8` req/min. The claimed
"24 → 8" is exact, not rounded. `useFreshness` itself (`kiosk-client.ts:27-40`)
has no cadence dependency — it only branches on SWR's `data`/`error`/
`isLoading`, so slowing the poll doesn't change how staleness is detected,
only how often it's *checked* (see Regressions below for the one real
trade-off this introduces).

### 3. `kiosk-hub.tsx` — `useMemo` + `memo()`, no custom `compare`
**Verified correct and effective, dependency-by-dependency.**

- No custom `compare`: `useSWR<HaStatesResponse>(HA_STATES_KEY, fetcher, { refreshInterval: paused ? 0 : POLL_MS, keepPreviousData: true })`
  (`kiosk-hub.tsx:125-128`) — no `compare` option. The code comment's claim
  that SWR's default is already `dequal` checks out against the actually
  installed package: `node_modules/swr/dist/_internal/config-context-*.js:510`
  is literally `const compare = lite.dequal;`, wired to the default config at
  line 532. So `data` is reference-stable across content-identical polls
  without any extra code.
- `useKioskHa`'s return is `useMemo(() => ({ data, error, isLoading,
  runAction, actionErrors, isPending }), [data, error, isLoading, runAction,
  actionErrors, isPending])` (`kiosk-hub.tsx:194-197`). Traced every dep for
  stability at idle (no action in flight, no error):
  - `data` — stable per SWR's `dequal` compare, as above.
  - `runAction` — `useCallback` deps `[data, mutate, dismissActionError]`
    (`kiosk-hub.tsx:148-183`); `mutate` is SWR's bound mutator for a fixed
    key (stable per hook instance); `dismissActionError` has an empty dep
    array (`kiosk-hub.tsx:134-146`, permanently stable). So `runAction` is
    stable whenever `data` is.
  - `isLoading` — primitive boolean, trivially stable when unchanged.
  - `actionErrors` — `useState` object, stable until an action actually
    errors/dismisses.
  - `isPending` — `useCallback` deps `[pendingIds]`; `pendingIds` is a
    `Set` from `useState`, stable when no action is starting/finishing.
  All six are simultaneously stable at idle, so `ha` itself is
  reference-stable across identical-content 7s polls — this is the
  precondition the team lead asked to confirm, and it holds.
- All five sections are `memo()`-wrapped: `LightsSection` (`:321`),
  `SwitchesSection` (`:373`), `ScenesSection` (`:413`), `ClimateSection`
  (`:575`), `SensorsSection` (`:596`). `entities = data.entities`
  (`kiosk-hub.tsx:733`) is a direct read off the stable `data`, so the
  `lights`/`switches`/`entities` props each section receives are also
  reference-stable when `data` is unchanged — `memo()`'s shallow prop
  comparison bails out correctly.

**Does it actually help?** `KioskHub` itself still re-renders every ~7s —
that's unavoidable, since `useKioskHa()`/`useSWR` is called directly inside
it and SWR's own internal state updates re-invoke the calling component
regardless of the memoized *return value*. But that re-render is now cheap:
a handful of `.length` checks and JSX element creation, not a re-invocation
of every tile in every section. The actual DOM-heavy subtrees (10-30+ tiles
on a populated HA setup) now correctly bail out via `memo()` on
content-identical polls. This is the intended effect and it verifies as
working, not just plausible.

**Optimistic update path — not broken.** Traced the tap → mutate → resync
sequence: `runAction` calls `mutate({ ...previous, entities: optimisticEntities
}, { revalidate: false })` (`kiosk-hub.tsx:154-156`) — this *does* change
`data`'s content (the toggled entity differs from what's cached), so SWR's
`dequal` compare correctly treats it as a new value, `data` gets a new
reference, `entities` gets a new reference, and `memo()` correctly lets the
affected section re-render with the optimistic state. `setPaused(true)`
(`:158`) then holds off the next scheduled poll until the POST settles,
exactly as before — this pause/resync guard is unchanged by the
memoization work and still prevents a mid-flight resync from stomping the
optimistic flip.

### 4. `HATCH_PATTERN` — `color-mix()` replacing hard-coded rgba
**Verified identical in both files.** `kiosk-hub.tsx:60-61` and
`kiosk-display.tsx:52-53` both now read:
```
repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--color-ink-faint) 14%, transparent) 8px 10px)
```
Paint cost: negligible, and unchanged in nature from before. These hatch
backgrounds only render on the empty/unconfigured HA and weather states
(`HubUnconfigured`, `HubEmpty`, `WeatherUnconfigured` — small, non-animated
panels, not full-viewport). `color-mix()` resolves once per style
recalculation (initial paint, or a theme switch, which is a rare manual
action), not per-frame — there's no timer or animation driving these
backgrounds. A configured kiosk (the steady-state target of this audit)
never renders them at all.

## Poll & timer budget (re-derived, both layouts)

Idle, non-elevated, day/evening period (not morning — briefing polling is
self-limiting and stops once content lands or on `unavailable`).

| Source | Cadence | file:line | req/min |
|---|---|---|---|
| `useKioskVitals` | 15s | `kiosk-client.ts:54-59`, called `kiosk-status-strip.tsx:51` | 4 |
| `useKioskHealth` (strip) | 15s | `kiosk-client.ts:62-67`, called `kiosk-status-strip.tsx:52` | 4 |
| `useKioskHa` | 7s | `kiosk-hub.tsx:52,126` | 8.57 |
| `KioskAttentionCard` | 30s | `kiosk-attention.tsx:22,26` | 2 |
| `useWeatherView` | 15 min | `kiosk-display.tsx:178,196`, shared SWR key with `kiosk-sky.tsx:81` | 0.07 |
| `useGlanceHealth` (glance only) | 15s | `kiosk-glance.tsx:42` | 4 |

**Standard layout total**: vitals 4 + health(strip) 4 + HA 8.57 + attention 2
+ weather 0.07 ≈ **18.6 requests/min** (~1,118/hour, ~26,840/day) — down
from audit-02's 34.6/min, a **46% reduction**, entirely attributable to the
verified 15s cadence change (the HA/attention/weather figures are unchanged
because those files weren't touched).

**Glance layout total** (unchanged default): health 4 + HA 8.57 + weather
0.07 ≈ **12.6 requests/min** (~758/hour, ~18,200/day) — matches audit-02's
figure; glance never mounted the status strip or attention card, so it was
never exposed to the vitals/health cadence in the first place.

**setInterval/setTimeout/rAF at idle** — unchanged from audit-02, since none
of the claimed fixes touched timer code:

| Timer | Cadence | file:line |
|---|---|---|
| Shared 1 Hz clock | 1/sec, one interval app-wide | `use-now.ts:26-40` |
| Kitchen-timer chime loop | 4s, armed the moment any `KioskTimersButton` mounts | `kiosk-timers.tsx:121-126,138` |
| Period recompute | 1/min | `kiosk-display.tsx:59,90-97` |
| Night-wake auto-revert | one-shot, not recurring | `kiosk/page.tsx:25,126-130` |

Still **3** steady-state recurring timers, same as before — this fix wave
correctly left the P3 timer findings alone rather than claiming credit for
them. `requestAnimationFrame` still only fires during active voice
recording and a one-shot on `KioskAttentionCard`'s entrance
(`kiosk-attention.tsx:41`); neither runs at idle.

## Remaining findings

### P3 — chime loop still armed on mount, not on first timer (unaddressed, unchanged from audit-02)
`kiosk-timers.tsx:121-126,138` — `startChimeLoopIfNeeded()` still runs from
`subscribe()`, which fires the instant any `KioskTimersButton` mounts (i.e.
always, since it's in both layouts' status chrome). Cost is still
negligible (`timers.some()` over a normally-empty array every 4s). Not
claimed as fixed in this wave and correctly not affecting the score, since
audit-02 never named it as a deduction reason. Recommendation unchanged:
call it from `addTimer` instead.

### P3 — finished-but-undismissed timers persist indefinitely (unaddressed, unchanged from audit-02)
`kiosk-timers.tsx:53,66-73` — no automatic eviction; still a UX/cosmetic
item, not a resource-growth risk. Unchanged assessment.

## Regressions

Checked each of the three areas the team lead flagged specifically; none
found.

- **Stale-detection path (`useFreshness`)**: not affected by the cadence
  change. `useFreshness` (`kiosk-client.ts:27-40`) branches only on SWR's
  own `data`/`error`/`isLoading`, which is orthogonal to `refreshInterval`.
  The only real behavioral change is an *inherent, already-acknowledged*
  trade-off: a vitals/health value that goes stale (e.g. the metrics route
  starts failing) now takes up to 15s to surface a `ready-stale` tag instead
  of up to 5s — a 3x wider detection window. This is the direct, obvious
  cost of the cadence change, explicitly named in the code's own comment
  (`kiosk-status-strip.tsx:45-50`) as an accepted trade for the request-rate
  win; not a hidden regression.
- **Optimistic HA update path**: traced in detail above under fix #3 — the
  `memo()` boundaries do not interfere with it, because a real optimistic
  update changes `data`'s content and therefore its reference, which is
  exactly the signal `memo()` needs to let the update through.
- **Modal focus-trap work (`kiosk-pin-pad.tsx`, `kiosk-timers.tsx`)**: no
  new timers or uncleaned listeners. Both files' `onDialogKeyDown` handlers
  are React `onKeyDown` props (bubble-based, no `addEventListener`/cleanup
  needed) and run an ad-hoc `querySelectorAll` per Tab keypress rather than
  storing anything persistent. The only `setTimeout` touched by this area is
  `kiosk-pin-pad.tsx:69`'s pre-existing one-shot shake-animation timer
  (420ms, not recurring, not new). Both files' focus-restore `useEffect`s
  (`kiosk-pin-pad.tsx:34-40`, `kiosk-timers.tsx:291-297`) have proper
  cleanup and mount/unmount symmetrically with the modal's open state — no
  leak.

## Summary

All four claimed fixes verify as genuine, not cosmetic: the sky animation's
replacement geometry is provably equivalent (worked the algebra by hand),
the poll-cadence math is exact, the HA memoization chain is stable
dependency-by-dependency with the optimistic-update path intact, and the
`color-mix()` swap is confirmed identical in both files with no new
per-frame cost. SWR's default-compare claim was checked against the actual
installed `dequal` source rather than taken on faith. Re-derived poll
budget: standard layout drops from 34.6 to ~18.6 req/min (-46%), glance
stays at ~12.6 req/min (unaffected, still the lighter default). Timer count
unchanged at 3 steady-state intervals — the two open P3s (chime-loop-always-
armed, undismissed-timer persistence) were never part of the original
deduction and remain minor/cosmetic. No regressions found in stale-
detection, the optimistic HA flow, or the modal focus-trap code. Score
raised 3/4 → 4/4.
