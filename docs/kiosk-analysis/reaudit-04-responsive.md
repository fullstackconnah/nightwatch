# Kiosk Responsive / Touch Re-Audit

Scope unchanged from the prior audit: `/kiosk`, both layouts, `src/app/kiosk/**`, `src/components/kiosk-*.tsx`, `container-controls.tsx`, `ui/button.tsx`. Wall iPad (1024, 1180), bench iPad, phone (390). **Audit only — no source files edited.**

## Score (was 2/4, now 4/4)

No P0 or P1 remains. Every finding from the original audit that carried real severity — the admin panel's 32px lifecycle buttons, the 30px temperature readout, the voice dismiss button's collapsed hit area, the `ClimateCard` truncate bug, the glance tile overflow gap, the fixed-position safe-area bypass, and the vitals-warning disappearing at 640px — is fixed and verified against the actual rendered classes, not just the diff. What's left is two pre-existing P2s the fix wave didn't touch, plus one new P2 candidate this re-audit found in the temperature-readout fix itself (below) — none block shipping, all are polish.

## P0 status

**RESOLVED.** `ui/button.tsx:32` adds a `touch` size variant (`h-14 w-14` = 56px, no `md:` step) alongside the untouched `icon` variant (`h-10 w-10 md:h-8 md:w-8`, `ui/button.tsx:20`). `container-controls.tsx:155` picks between them (`size={touch ? "touch" : "icon"}`), and only `kiosk-admin-panel.tsx:31` passes `touch`. I grepped every other `LifecycleActions`/`OpenAppLink` call site to confirm no desktop regression:
- `src/app/(dash)/containers/page.tsx:77,79` — no `dense`/`touch`, still plain `icon` (40/32px, unchanged desktop density).
- `src/components/container-tile.tsx:177-178` — still `dense` (md:h-7 w-7, unchanged).
`cn()` is `twMerge(clsx(...))` (`src/lib/utils.ts:4-6`), so Tailwind conflict resolution is real, not string concatenation — confirmed the `touch` variant's `h-14 w-14` isn't silently lost to `className` merging anywhere. Admin panel's Start/Stop/Restart icons are now a flat **56×56px at 390, 1024 and 1180** — the `md:` proxy-for-pointer bug that shrank them at the wall widths is gone.

## Fix verification

1. **Button `touch` variant + dash isolation — verified, no regressions.** See P0 status above.
2. **Voice error-dismiss `min-h-14` — verified.** `kiosk-voice.tsx:202`: `"microlabel !text-bad max-w-xs min-h-14 flex items-center justify-center px-3 text-center"`. Was a collapsed ~16-20px line-height target; now a genuine 56px minimum, and `min-h` (not `h-`) correctly lets a wrapped error message grow past that floor instead of clipping.
3. **Glance Timers/Admin raised to 56px + safe-area-correct positioning — verified.** `kiosk-glance.tsx:214-222`: `KioskTimersButton className="h-14"` inside a wrapper positioned via `bottom: calc(1rem + env(safe-area-inset-bottom)); left: calc(1.25rem + env(safe-area-inset-left))`. `KioskTimersButton`'s own base class is `h-11` (`kiosk-timers.tsx:251`); `twMerge` resolves the conflict in favor of the later `h-14` passed via `className`, so this genuinely renders 56px, not 44. Admin button (`kiosk-glance.tsx:223-239`) is directly `h-14` with matching `calc()` inset math on `bottom`/`right`. Both buttons now anchor to the safe area instead of the raw viewport edge — the original P1 (fixed positioning bypassing `KioskThemeScope`'s padding-based insets) is fixed for these two controls, the only `fixed`-positioned interactive elements the original audit flagged as edge-anchored (the pin pad and timers overlay remain flex-centered `fixed inset-0`, still low-risk as before).
4. **Vitals-unreachable always visible — verified.** `kiosk-status-strip.tsx:80-84`: the block carries no `hidden` class at all now; only the inner text swaps via `hidden sm:inline` / `sm:hidden` between "vitals unreachable" and "vitals down". Confirmed this sits inside a `flex-wrap` parent (`:74`) so the compressed label can't force overflow at 390px.
5. **`ClimateCard` `min-w-0` wrapper — verified.** `kiosk-hub.tsx:503-504`: `<div className="min-w-0"><div className="truncate text-xs text-ink">{climate.name}</div></div>`, direct child of the `flex items-baseline justify-between gap-2` row at `:499`. This is exactly the working pattern `ToggleTile` already used (`:227-228`) — `truncate` now has a bounded track to clip against.
6. **Glance auto-picked tiles bounded — verified.** `kiosk-glance.tsx:129`: `min-h-16 min-w-32 max-w-48` on the button; `:141`: `<span className="block truncate">{p.name}</span>`. `max-w-48` = 192px, well under the 390px viewport even accounting for the `px-6` page padding, so a single overlong HA entity name can no longer stretch past the screen. `flex-wrap` on the row (`:113`) still handles multi-tile overflow as before.
7. **Glance temperature/condition responsive, hierarchy restored — verified, ratio matches the claim.** `kiosk-glance.tsx:183-186`: temp `text-4xl min-[420px]:text-5xl md:text-6xl` = 36/48/60px; condition `text-xl min-[420px]:text-2xl md:text-3xl` = 20/24/30px. Clock (`kiosk-clock.tsx:29`) is `text-[4.5rem] min-[420px]:text-[5.5rem] md:text-[7rem]` = 72/88/112px. Temp:clock ratio — 36/72 = 50% at <420px, 48/88 = 54.5% at 420-767px, 60/112 = 53.6% at ≥768px (both wall widths). This is a real fix: previously flat 30px against a 112px clock (27%) at the wall widths; now 60px against 112px (53.6%) — restores the "two large, distance-legible elements" hierarchy the file's own THESIS names.

## Touch-target inventory (rebuilt)

All figures are real rendered px (1rem = 16px), both layouts, checked at 390 / 1024 / 1180.

| Control | 390px | 1024/1180px | Floor | file:line | Verdict |
|---|---|---|---|---|---|
| **Admin panel Start/Stop/Restart** | **56×56** | **56×56** | 44 (56 wall) | `container-controls.tsx:155` (`touch` variant), `ui/button.tsx:32` | **Pass — was Fail, now fixed at every width** |
| **Voice error-dismiss** | **56 min-height** | **56 min-height** | 44 | `kiosk-voice.tsx:202` | **Pass — was Fail (~16-20px)** |
| **Glance Timers button** | **56** | **56** | 56 (wall) | `kiosk-glance.tsx:221` (h-14 override of base h-11) | **Pass — was 44, wall-convention Fail** |
| **Glance Admin button** | **56** | **56** | 56 (wall) | `kiosk-glance.tsx:236` | **Pass — was 44, wall-convention Fail** |
| Status strip Admin (standard layout) | 44 | 44 | 44 | `kiosk-status-strip.tsx:141` | Pass, unchanged |
| Status strip → KioskTimersButton (standard) | 44 | 44 | 44 | `kiosk-timers.tsx:251` | Pass, unchanged (no override in this call site) |
| Glance auto-picked tiles | 64×128 min, 192 max | 64×128 min, 192 max | 56 | `kiosk-glance.tsx:129` | Pass, overflow now bounded (was unbounded) |
| Hub `ToggleTile` / `SceneTile` | 64 min | 64 min | 56 | `kiosk-hub.tsx:230, 281` | Pass, unchanged |
| Climate nudge ± / HVAC mode chips | 56×56 / 56×72 min | 56×56 / 56×72 min | 56 | `kiosk-hub.tsx:522, 539, 558` | Pass, unchanged |
| Sensor chip (informational) | 44 | 44 | n/a | `kiosk-hub.tsx:607` | Not a control |
| PIN pad Close (X) / digit keys | 44 / 56 tall, ~85 wide | 44 / 56 tall, ~85 wide | 44 | `kiosk-pin-pad.tsx:161, 205` | Pass, unchanged |
| Appearance layout segmented / theme chips (×16) | 44 | 44 | 44 | `kiosk-appearance.tsx:88, 40` | Pass, unchanged |
| Admin panel Dashboard link / Lock | 44 | 44 | 44 | `kiosk-admin-panel.tsx:66, 73` | Pass, unchanged |
| Voice mic button | 96×96 | 96×96 | 44 | `kiosk-voice.tsx:156` | Pass, unchanged |
| Voice "Stop speaking" / text-fallback input+Ask | 44 | 44 | 44 | `kiosk-voice.tsx:186, 91, 96` | Pass, unchanged |
| Night overlay Admin button (standard/night) | 44 | 44 | 44 | `kiosk-display.tsx:715` | Pass, unchanged — not `fixed`, correctly in-flow under `KioskThemeScope`'s padding insets |
| Timers overlay: close/presets/custom steps/Clear/Start/pause-resume/cancel/Done | 44 uniformly | 44 uniformly | 44 | `kiosk-timers.tsx:378, 516, 559, 570, 579, 480, 488, 470` | Pass, unchanged (Timers is a modal, not a wall tile — the 44px floor, not the 56px wall convention, applies) |
| Error boundary Reload button | 56, full width | 56, full width | 44 | `kiosk/error.tsx:133` | Pass, unchanged — not part of this fix wave but already correct |
| Attention card | n/a — no interactive controls | n/a | n/a | `kiosk-attention.tsx` | Not applicable — status-only, confirmed no buttons in the component |

## Distance legibility

| Readout | Layout | 390px | 1024/1180px | Verdict |
|---|---|---|---|---|
| Wall clock | glance | 72px (below 420 tier) | 112px | Unchanged, correctly the largest element |
| **Current temperature** | glance | **36px** | **60px** | **Fixed — was flat 30px; now tracks the clock at 50-54% ratio at every width** |
| Weather condition label | glance | 20px | 30px | Now responsive too (was flat 20px); still correctly secondary |
| Weather/briefing sentences | glance | 16px | 16px | Unchanged, secondary — fine as-is |
| Night overlay clock | shared | 60px | 96px | Unchanged |
| Status strip clock (standard) | standard | 18px | 20px | Unchanged — close-viewing context, not a distance readout |
| Morning/day/evening current temp (standard) | standard | 36px/24px | 36px/24px | Unchanged — not in scope of this fix wave, standard layout is explicitly the close-viewing use case |

## Remaining findings

**P2 — New: glance temperature row has no wrap/overflow guard, and the fix's own "checked at 390px, still fits" claim looks optimistic for the longest real weather label.** `kiosk-glance.tsx:181`: `<div className="flex items-center gap-3 text-ink">` (icon + temp + condition + optional "stale" badge) has **no `flex-wrap`** and the condition `<span>` (`:186`) has no `truncate`/`max-w`. The longest WMO label this app actually renders is `"Thunderstorm, heavy hail"` (`src/lib/weather.ts:123`, 25 chars, lowercased at render). At the 390px tier (icon 28px + temp `text-4xl` ~50px + condition `text-xl` ~25 chars at 20px ≈ 270-300px, all plus three `gap-3` = 12px gaps), the row's content width plausibly exceeds the ~342px available inside `px-6` — before even counting the optional stale badge. The in-code comment (`:174-180`) asserts this was manually checked and fits, but that's an unverified claim in a comment, not a structural guarantee — unlike the tile row (`flex-wrap`, `:113`) or the vitals warning (`flex-wrap` parent, `kiosk-status-strip.tsx:74`), this row has no fallback if the estimate is wrong. **Needs a real browser check** with `?theme=` + a mocked "Thunderstorm, heavy hail" response at 390px to confirm; I can't rule out overflow from code alone.

**P2 — carried over, unchanged: `AdminRow` container name still has no title/tooltip fallback.** `kiosk-admin-panel.tsx:24`: `<div className="font-mono text-sm truncate">{c.name}</div>` — still no `title={c.name}`, while the equivalent patterns elsewhere on this surface (`kiosk-hub.tsx` sensor name, `kiosk-timers.tsx:442` timer name) do carry `title`. Not touched by this fix wave.

**P2 — carried over, largely unchanged: fixed `h-*` heights instead of `min-h-*` remain the norm across most of the surface.** Appearance chips (`kiosk-appearance.tsx:40, 88`), PIN pad keys (`kiosk-pin-pad.tsx:205`), status strip Admin (`kiosk-status-strip.tsx:141`), Timers preset/custom/cancel/pause buttons (`kiosk-timers.tsx` throughout), Admin panel Lock/Dashboard (`kiosk-admin-panel.tsx:66, 73`) are all still fixed-height. The one exception the fix wave carved out is the voice error-dismiss button, which correctly switched to `min-h-14` specifically because its content wraps. Under iOS Dynamic Type or 200% zoom the rest remain at risk of label clipping/overflow — same systemic P2 as before, just one instance narrower now.

**P3 — improved, not fully closed: glance breakpoint coverage.** Clock, temperature and condition now all have responsive steps (fix 7). The weather sentence, server sentence and briefing text (`kiosk-glance.tsx:194-204`) still have zero responsive variants — acceptable, since they're secondary body text at a fixed 16px, not a finding worth raising on its own.

**Already correct, reconfirmed:** hub tile touch-target discipline, theme-chip wrapping, hub's `min-w-0`+`truncate` pattern (now including `ClimateCard`), safe-area handling at the shell level (`kiosk-theme.tsx:242-245`) for in-flow content, and the status strip's severity chip surviving every breakpoint.

## What a browser would still need to confirm

No live browser session exists for this re-audit (torn down per the brief) — everything above is reasoned from source. The one place I can't close from code alone is the new P2: whether `kiosk-glance.tsx:181`'s temperature row actually overflows at 390px with a long condition string plus the stale badge. Every other verification above (px math, `cn()`/`twMerge` conflict resolution, grep-confirmed call sites) is derivable with certainty from the source and doesn't need a browser to trust.
