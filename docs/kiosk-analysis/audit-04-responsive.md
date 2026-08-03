# Kiosk Responsive / Touch Audit

Scope: `/kiosk` — `src/app/kiosk/**`, `src/components/kiosk-*.tsx`, plus `container-controls.tsx` and `ui/button.tsx` where the admin panel reuses them. Both layouts (`standard`, `glance`) audited. Target devices: wall iPad landscape (1024, 1180 CSS px), bench iPad, phone (390 CSS px), viewed 1-3m when wall-mounted. **Audit only — no source files edited.**

## Score (0-4)

**2 — partial.**

Key finding: the kiosk's own custom-built controls (glance tiles, hub tiles, pin pad, timers, appearance chips) are disciplined about touch targets — most sit at 44-64px. But two things break the score: (1) the admin panel's container lifecycle buttons inherit a **desktop-oriented `md:` downshift** from the shared `Button` component that shrinks them to 32px at exactly the 1024/1180 widths this kiosk targets, and (2) the glance layout's temperature readout — called out in its own file's THESIS comment as one of "the only large elements, legible from across a room" — actually renders at 30px, roughly a third the size of the clock next to it. Both are real regressions against this surface's stated own design intent, not just generic mobile-web nitpicks.

## Touch target inventory

| Control | Size (px) | Floor | file:line | Pass/Fail |
|---|---|---|---|---|
| Status strip Admin button | 44 (h-11) | 44 | `kiosk-status-strip.tsx:127-133` | Pass |
| Status strip → KioskTimersButton | 44 (h-11) | 44 | `kiosk-timers.tsx:246-264` | Pass |
| Glance Admin button | 44 (h-11) | 56 (wall convention) | `kiosk-glance.tsx:195-201` | Fail vs wall convention (pass vs 44 floor) |
| Glance → KioskTimersButton | 44 (h-11) | 56 (wall convention) | `kiosk-glance.tsx:192-194` (button itself `kiosk-timers.tsx:246`) | Fail vs wall convention |
| Glance auto-picked tiles | 64×128 min (`min-h-16 min-w-32`) | 56 | `kiosk-glance.tsx:128-134` | Pass |
| Hub `ToggleTile` (lights/switches) | 64 min (`min-h-16`) | 56 | `kiosk-hub.tsx:214-219` | Pass |
| Hub `SceneTile` | 64 min (`min-h-16`) | 56 | `kiosk-hub.tsx:265-269` | Pass |
| Climate nudge ± buttons | 56×56 (`h-14 w-14`) | 56 | `kiosk-hub.tsx:492, 509` | Pass |
| Climate HVAC mode chips | 56×72 min (`h-14 min-w-[4.5rem]`) | 56 | `kiosk-hub.tsx:520-528` | Pass |
| Sensor chip (display only, not interactive) | 44 (`min-h-11`) | n/a | `kiosk-hub.tsx:574-579` | Not a control — informational |
| PIN pad Close (X) | 44×44 (`h-11 w-11`) | 44 | `kiosk-pin-pad.tsx:77-84` | Pass |
| PIN pad digit keys | 56 tall, ~85 wide (grid-derived) | 44 | `kiosk-pin-pad.tsx:118-127` | Pass |
| Appearance layout segmented buttons | 44 (`h-11`) | 44 | `kiosk-appearance.tsx:82-93` | Pass |
| Appearance theme chips (×16) | 44 (`h-11`) | 44 | `kiosk-appearance.tsx:32-44` | Pass |
| Admin panel Dashboard link | 44 (`h-11`) | 44 | `kiosk-admin-panel.tsx:60-65` | Pass |
| Admin panel Lock button | 44 (`h-11`) | 44 | `kiosk-admin-panel.tsx:66-72` | Pass |
| **Admin panel container Start/Stop/Restart icons** | **40 base, 32 at ≥768px** (`h-10 w-10 md:h-8 md:w-8`) | 44 | `container-controls.tsx:144-148` (icon size from `ui/button.tsx:20`), rendered via `kiosk-admin-panel.tsx:27` | **Fail — fails even the 40px base tier, and shrinks further exactly at 1024/1180** |
| Voice mic button | 96×96 (`h-24 w-24`) | 44 | `kiosk-voice.tsx:152-163` | Pass |
| Voice "Stop speaking" | 44 (`h-11`) | 44 | `kiosk-voice.tsx:184-191` | Pass |
| Voice text-fallback input/Ask | 44 (`h-11`) | 44 | `kiosk-voice.tsx:87-101` | Pass |
| **Voice error-dismiss button** | **no height/padding class at all** — collapses to text line-height (~16-20px) | 44 | `kiosk-voice.tsx:197-203` | **Fail** |
| Night overlay Admin button | 44 (`h-11`) | 44 | `kiosk-display.tsx:704-713` | Pass |
| Timers: entry button, overlay close, presets, custom +1/+5/+10, Clear, Start, pause/resume, cancel, Done | all 44 (`h-11`/`h-11 w-11`) | 44 | `kiosk-timers.tsx:246-264, 299-306, 401-416, 432-439, 473-502` | Pass (uniformly, none reach the 56px wall convention, but Timers is an admin-style modal not a wall tile) |

## Distance legibility

Standard layout is explicitly **not** the distance use case — `page.tsx:30` documents it as "a deliberate opt-out for a bench/desk device viewed up close." Its readouts are reported for completeness, not judged against the 1-3m bar.

| Readout | Layout | px | Verdict |
|---|---|---|---|
| Wall clock | glance | 112px at ≥768px (`md:text-[7rem]`), 72px below 420px | `kiosk-clock.tsx:29` — **legible at 1-3m**, the one element correctly sized for the stated use case |
| **Current temperature** | glance | **30px** (`text-3xl`) | `kiosk-glance.tsx:170` — **too small for 1-3m.** The file's own THESIS comment (`kiosk-glance.tsx:5-6`) calls this out by name as one of only two elements meant to be "large… legible from across a room," but it renders at roughly a third the clock's size (112px) and well under common distance-legibility minimums even at 1m |
| Weather condition label | glance | 20px (`text-xl`) | `kiosk-glance.tsx:171` — secondary text, acceptable as a supporting label, not a primary readout |
| Weather/briefing sentences | glance | 16px (`text-base`) | `kiosk-glance.tsx:178-187` — secondary, acceptable |
| Night overlay clock (both layouts fall back to this 22:00-05:00) | shared | 60px / 96px (`text-6xl md:text-8xl`) | `kiosk-display.tsx:692-694` — legible, though noticeably smaller than the glance-board clock it otherwise mirrors |
| Status strip clock | standard | 18/20px (`text-lg md:text-xl`) | `kiosk-status-strip.tsx:55` — fine for its documented close-viewing context, not a distance readout |
| Morning current temp | standard | 36px (`text-4xl`) | `kiosk-display.tsx:328` — close-viewing context |
| Day/evening current temp | standard | 24px (`text-2xl`) | `kiosk-display.tsx:372` — close-viewing context |

## Findings

**P0 — Admin panel touch targets regress below the floor at the kiosk's own target widths.** `LifecycleActions` (`container-controls.tsx:122-169`) renders container Start/Stop/Restart via `Button size="icon"`, whose `icon` variant is `"h-10 w-10 md:h-8 md:w-8"` (`ui/button.tsx:20`). `kiosk-admin-panel.tsx:27` calls `LifecycleActions` without the `dense` prop, so the plain base size applies: **40px under 768px (already below the 44px floor)**, dropping to **32px at ≥768px** — which covers both wall targets, 1024 and 1180 CSS px. The `md:` breakpoint here is being used as a proxy for "pointer device," which is invalid on a touch-only iPad; the component's own doc comment (`container-controls.tsx:132`, "touch keeps the full 40px") assumes `dense` is the only way sizes shrink, but the un-dense base variant shrinks anyway via `md:`.

**P1 — Glance board's temperature readout contradicts its own design intent.** See Distance legibility above — `kiosk-glance.tsx:170`, 30px vs. the clock's 112px, despite the file's THESIS explicitly grouping them as the layout's two large, distance-legible elements.

**P1 — `ClimateCard` name truncate likely doesn't truncate.** `kiosk-hub.tsx:474-477`: `<span className="truncate ...">{climate.name}</span>` is a direct flex child of `<div className="flex items-baseline justify-between gap-2">` with no `min-w-0` anywhere in the chain. Flex items default to `min-width: auto`, so `truncate`'s `overflow:hidden` has no width to clip against — the item will grow to its content width and can push the row wider than the card, rather than showing an ellipsis. Contrast the correct pattern one file below: `kiosk-hub.tsx:227` wraps `ToggleTile`'s name in `<div className="min-w-0">` before applying `truncate` (`kiosk-hub.tsx:228`). A long HA climate name (the prompt's 40-char test case) is a real trigger.

**P1 — Glance auto-picked tiles have no overflow protection at all.** `kiosk-glance.tsx:136`: `{p.name}` renders raw inside the tile button with no `truncate`, `max-w-*`, or `break-words` — unlike the equivalent `ToggleTile`/`SceneTile` in the hub, which both truncate (`kiosk-hub.tsx:228, 272`). `min-w-32` on the button (`kiosk-glance.tsx:129`) is a *minimum*, not a cap, so a single long, space-free HA entity name (or a name that happens to not wrap at a convenient point) can stretch the button — and since the row is otherwise `flex-wrap` (`kiosk-glance.tsx:113`), an individual overlong tile can still exceed the 390px viewport on its own. `kiosk-appearance.tsx` is cited in the brief as having a documented overflow-fix history (its THESIS comment at lines 3-18 walks through fixing an "unwrappable 16-button row" by wrapping per-family with `flex-wrap gap-2`) — that fix does **not** generalize here; glance tiles need the same truncate treatment hub tiles already have, not just wrapping.

**P1 — Fixed-position kiosk chrome bypasses the standalone-PWA safe-area padding.** `KioskThemeScope` applies `env(safe-area-inset-*)` as padding on its own div (`kiosk-theme.tsx:224-227`) — but padding on an ancestor has no effect on descendants positioned `fixed`, since `fixed` escapes the padding box entirely and anchors to the true viewport edge. Two real controls are affected: the glance layout's Timers button (`fixed bottom-4 left-5`, `kiosk-glance.tsx:192-194`) and Admin button (`fixed bottom-4 right-5`, `kiosk-glance.tsx:195-201`). On an installed standalone PWA with a home-indicator inset (`viewportFit: "cover"` is set at `kiosk/layout.tsx:35`, confirming standalone intent), both buttons sit 16-20px from the raw device edge regardless of the inset, risking partial coverage by the home-indicator gesture strip. `KioskPinPad` and the Timers overlay also use `fixed inset-0` but their interactive content is flex-centered, not edge-anchored, so they're lower risk — worth noting, not a finding.

**P1 — Vitals health signal disappears below 640px on the strip, on the phone breakpoint.** `kiosk-status-strip.tsx:70-73`: `vitals unreachable` is `hidden ... sm:flex` — invisible under 640px. The routine cpu/mem readout (`kiosk-status-strip.tsx:76-85`) is hidden the same way. The container-health severity chip (dead/unhealthy, `kiosk-status-strip.tsx:102-116`) correctly has **no** `hidden` class and stays visible at every width — so the strip's most load-bearing alert survives, but the vitals-unreachable warning (itself a real infrastructure signal, not decoration) does not. On a 390px phone this is a silent loss of a genuine health signal, not just a cosmetic simplification.

**P2 — Admin panel's `AdminRow` container name has no title/tooltip fallback for its truncated text.** `kiosk-admin-panel.tsx:24`: `<div className="font-mono text-sm truncate">{c.name}</div>` — no `title={c.name}`, unlike the equivalent pattern elsewhere in the same surface (`kiosk-hub.tsx:583` sensor name has `title={s.name}`; `kiosk-timers.tsx:367` timer name has `title={timer.name}`). A 40-char container name truncates with no way to recover the full string (title tooltips are weak on touch anyway, but it's at least the established fallback used everywhere else on this surface).

**P2 — Glance/Timers buttons sit below the kiosk's own 56px wall-tile convention.** Both the Glance Admin button and the Timers entry button reuse the strip's 44px `h-11` sizing (`kiosk-glance.tsx:195-201`; `kiosk-timers.tsx:246-264`) rather than the 56px used for every other glance-board control. They pass the general PRODUCT.md floor but are the smallest touch targets on the distance-first layout, at the two bottom corners where a hand reaching in from off-screen has the least visual guidance.

**P2 — `h-11`/`h-14` are fixed heights, not minimums, across nearly every button in the kiosk.** Almost every interactive control on this surface (`ThemeChip` `kiosk-appearance.tsx:40`; PIN keys `kiosk-pin-pad.tsx:124`; strip Admin button `kiosk-status-strip.tsx:130`; Timers presets `kiosk-timers.tsx:436`; admin panel Lock/Dashboard `kiosk-admin-panel.tsx:62,69`) uses a fixed `h-*` combined with `flex items-center`, rather than `min-h-*`. Under iOS Dynamic Type or a 200% browser zoom, the label text grows but the box does not, risking vertical clipping or the label overflowing the border rather than the button growing to fit. The hub's `ToggleTile`/`SceneTile` (`min-h-16`) get this right; the rest of the surface does not. This is systemic enough that it's worth a single sweep rather than fixing case-by-case.

**P3 — Glance layout has almost no breakpoint coverage.** Outside the clock's one `min-[420px]:` step (`kiosk-clock.tsx:29`), nothing else in `kiosk-glance.tsx` — the temperature readout, weather sentence, server sentence, tile row — has any responsive variant; 390px and 1440px render identically. Given glance is now the default layout for a fresh device (`page.tsx:28-29`) and could plausibly be opened on a phone during setup/testing, the undersized 30px temperature reading (see P1 above) gets no relief at the one width where it would matter least for the wall use case but most for someone checking the layout on their phone.

**P3 — Breaking layout coverage gaps that don't matter.** `kiosk-pin-pad.tsx` has zero responsive classes anywhere in the file — but its `max-w-xs` panel and `grid-cols-3` key layout are small and self-contained enough that this doesn't cost anything at 390 or 1440.

## Already correct

- **Touch-target discipline in the custom-built controls is genuinely good.** Hub tiles (`kiosk-hub.tsx:214, 265`), climate nudge/mode buttons (`kiosk-hub.tsx:492, 509, 520`), glance tiles (`kiosk-glance.tsx:129`), the PIN pad (`kiosk-pin-pad.tsx:124`), and the voice mic (`kiosk-voice.tsx:158`, 96px) all meet or exceed their applicable floor. `TILE_GRID`'s own comment (`kiosk-hub.tsx:58-62`) documents the 56px+ touch-first sizing decision explicitly, and the code delivers on it.
- **Theme-chip overflow is actually fixed, and the fix generalises within its own file.** `kiosk-appearance.tsx`'s THESIS comment (lines 3-18) documents a prior "unwrappable 16-button row" bug; the current implementation wraps each of the four theme families independently (`flex flex-wrap gap-2`, `kiosk-appearance.tsx:104`) rather than one long row, and every chip individually meets the 44px floor. This holds at both 390 and 1440.
- **Container name truncation in the main container list pattern is correct where the hub applies it.** `min-w-0` wrapping precedes `truncate` correctly in `ToggleTile` (`kiosk-hub.tsx:227-228`), `SceneTile` (`kiosk-hub.tsx:272`), the sensor chip (`kiosk-hub.tsx:583`), and `AdminRow`'s own name column (`kiosk-admin-panel.tsx:23-24`, `min-w-0 flex-1` on the parent). The `ClimateCard` gap (P1 above) is the one place this pattern wasn't carried over.
- **Safe-area handling is correctly wired at the shell level.** `viewportFit: "cover"` (`kiosk/layout.tsx:35`) plus `env(safe-area-inset-*)` padding on `KioskThemeScope` (`kiosk-theme.tsx:224-227`) correctly protects everything in normal document flow — the night overlay's Admin button (`kiosk-display.tsx:704`, positioned `absolute` inside a `relative` ancestor still in-flow) inherits it correctly. The gap is specifically `fixed`-positioned elements (P1 above), not the mechanism itself.
- **The most important status-strip alert survives every breakpoint.** The dead/unhealthy severity chip (`kiosk-status-strip.tsx:102-116`) has no `hidden` class at any width — the one piece of information on that strip that genuinely can't afford to disappear, doesn't.
- **No horizontal overflow observed in the static structure at 1440/390** for the glance layout's core composition (clock, tiles, sentences) — confirms the baseline the brief describes; the overflow risks documented above are narrow, content-dependent triggers (a specific long name), not structural breaks.
