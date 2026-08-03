# Kiosk Anti-Pattern Re-Audit (post fix-wave)

Surface: `/kiosk` — `src/app/kiosk/**`, `src/components/kiosk-*.tsx`, `src/app/globals.css`, `DESIGN.md`.
Method: full re-read of every file in scope (all 16 `kiosk-*.tsx` components, `page.tsx`, `layout.tsx`, `error.tsx`, all 15 `[data-kiosk-theme]` CSS blocks) against the three claimed fixes and the full ban/product-register checklist, plus a directed pass on token adoption and motion coverage per the brief. No browser session run — render-only claims (live contrast, actual overflow) are called out as unverified, not asserted.

## Score (was 3/4, now 3/4)

**Unchanged at 3 — mostly clean, subtle tells only, but the tells moved.** The one real P1 (status-dot motion) is genuinely fixed. In its place the wave introduced a P2 of the *same species* the P1 was (a real, functionally-equivalent element missing its `prefers-reduced-motion` gate — see Motion coverage) plus two new P3 token-hygiene misses from the radius-token work claimed as a fix. Net severity is the same shape as last time: one real accessibility-adjacent gap plus a small cluster of vocabulary/hygiene nits. Score holds rather than moving to 4/4.

## Verdict

**Generated-looking? No, still.** No new ban-matrix hits. The system stays legible as one deliberate design, not a template.

**Product-register trust test: still passes, with one caveat.** Someone fluent in this category would still recognize every idiom as native. The caveat: a fluent user who opens the timer overlay and watches the ring visibly stutter-step once every second under reduced motion (see Motion coverage) would notice — small, but it's exactly the kind of "almost but not quite" a trust-test is designed to catch, and it sits right next to a component (`VoiceLevelBars`) that handles the identical situation correctly with a documented rationale.

## Fix verification

| Claimed fix | Status | Evidence |
|---|---|---|
| 1. `.dot-unhealthy`/`.dot-restarting` reduced-motion branch | **Fixed** | `globals.css:152-157` — both classes get `animation: none` under `@media (prefers-reduced-motion: reduce)`, with a comment explaining the dots stay distinguishable by hue/glow alone once static. Confirmed applied via `.dot` classes in `kiosk-health.tsx:41` and `container-tile.tsx:21,23` (consumed by `kiosk-admin-panel.tsx`'s `stateDotClass`). |
| 2. `error.tsx` Reload button `rounded-lg` → `rounded-tile` | **Partially — renamed, not resolved** | `error.tsx:133` now reads `rounded-tile` instead of `rounded-lg`. But `--radius-tile` is defined as `0.5rem` (`globals.css:43`) — the *same value* `rounded-lg` already was (per the comment at `globals.css:38`, "rounded-lg already IS 0.5rem"). The button is pixel-identical to before; only the class name changed. It's still off-vocabulary against its real peers: every other `h-14` accent-weight control in kiosk scope (`kiosk-hub.tsx:522,539,558` climate nudge/mode buttons, `kiosk-glance.tsx:236` the Admin corner button) uses `rounded-md` (0.375rem), not `rounded-tile`/`rounded-lg` (0.5rem). The height (`h-14`) is now well-justified — it matches the established "large single-CTA" tier (`KioskTimersButton`, hub mode buttons) rather than the toolbar `h-11` tier the original audit compared it to — so that half of the original P3 is resolved. The radius half isn't: it just moved from an unnamed coincidence to a *named* mismatch. See Ban matches / P3 below for the reclassified finding. |
| 3. `chrome` theme's borrowed `--font-mono` | **Fixed** | `globals.css:791-795` now carries an explicit comment: "Intentional share, not a hole: no dedicated Chrome mono face exists, and Aerogel's Fragment Mono reads as plain enough hardware-console monospace to work here too." Reads as a deliberate decision, not a copy-paste seam. |

## Ban matches

Re-ran the full absolute-ban list against current code. No new hits.

| Ban | Hit? | Note |
|---|---|---|
| Side-stripe borders | No | Only remaining left/right-adjacent border is still `bulletin`'s `border-top-width: 3px` (`globals.css:639`) — a top border on an opt-in identity, unchanged from last pass. |
| Gradient text | No | Not present. |
| Decorative glassmorphism as default | No | Same two legitimate scrims (`kiosk-pin-pad.tsx:126`, `kiosk-timers.tsx:341`) and two opt-in themed identities (`aerogel`, `aurora`) as before. |
| Hero-metric template | No | `KioskClock` is still a wall-clock face, not a KPI tile. |
| Identical card grids | No | Tile grids still carry real per-entity state. |
| Uppercase eyebrows on every section | No (checked, not blanket-flagged) | `.microlabel` still used identically to the sibling `/smarthome` panels; not re-litigated per the brief. |
| Numbered section scaffolding | No | None found. |
| Text overflowing container | Unverified | `ForecastStrip` (`kiosk-display.tsx:409-440`) unchanged since last pass — still a real-browser check candidate, not counted without render evidence. |
| Nested cards | Borderline, not counted | `ClimateCard` (`kiosk-hub.tsx:492-498`) is still the documented tile-in-panel idiom — see token findings below for the more precise issue (which radius name it uses), not a nesting violation. |
| Gray-on-color | No | Unchanged. |
| Bounce/elastic easing | No | All easing still `ease-in-out` or the two named cubic-beziers (settle, shake). `TimerRing`'s new-to-this-pass `linear` transition (`kiosk-timers.tsx:423`) is linear, not elastic — not a ban hit, but see Motion coverage. |
| Arbitrary z-index (999/9999) | No | `globals.css:413`'s `z-index: 60` unchanged, still reasoned against the modal `z-50` layer. |

## Post-wave consistency review

Four agents touching ~30 edits across 12 files in parallel is exactly the situation that produces divergent solutions to the same problem, and that's what happened here — concentrated entirely in the new radius tokens, which is precisely the area the fix wave touched.

**P3 — `rounded-tile`/`rounded-[0.5rem]`/`rounded-lg` are three names for the same 0.5rem radius, and the new token landed in the wrong place.** `--radius-tile: 0.5rem` was added (`globals.css:43`) specifically annotated "kiosk touch tiles (56px+)." Its *only* consumer is `error.tsx:133` — a one-off crash-screen button, not a tile. Meanwhile the actual population of things that comment describes still use the pre-existing `rounded-lg` (same 0.5rem value, unnamed):
- `ToggleTile` — `kiosk-hub.tsx:230`
- `SceneTile` — `kiosk-hub.tsx:281`
- `ClimateCard` — `kiosk-hub.tsx:495`
- `HubSkeleton` placeholder tiles — `kiosk-hub.tsx:645`
- `GlanceTiles` button — `kiosk-glance.tsx:129`

And a third spelling of the identical value shows up independently in `kiosk-timers.tsx:516` (`PresetRow`'s preset chips): `rounded-[0.5rem]`, an arbitrary-value literal — exactly the kind of thing a named token exists to replace, in the same file family the token was introduced to serve. Three ways to write one number, and the one place the named token actually appears is the one place that isn't a touch tile. Cosmetically invisible (all three resolve to 0.5rem), but it's real vocabulary drift, and it's evidence the token was added to satisfy the flagged finding rather than swept through its own stated scope.

**P3 — `--radius-panel` is dead on arrival.** Defined at `globals.css:44` with the comment "matches `.panel`'s own border-radius below," but `.panel` itself (`globals.css:169`) still hardcodes `border-radius: 0.625rem` rather than `var(--radius-panel)`. The token has zero consumers anywhere in `src/` (confirmed by grep — the only two matches for `rounded-panel`/`--radius-panel` in the whole codebase are the token's own declaration and its comment). An orphaned constant: real, harmless today, but it will silently drift from `.panel`'s literal the first time either one is edited without the other, since nothing wires them together.

**Everything else checked clean.** No divergent button heights for the same semantic role beyond the item above (the `h-11` toolbar tier and `h-14` large-CTA tier are each used consistently once you separate them correctly — see the fix-verification table). No comments now contradicting their code. No other duplicated-logic seam found across the 12 touched files.

## Motion coverage

Enumerated every `animate-*`, Tailwind `transition`, and inline-style `transition` in kiosk scope (8 Tailwind-class instances + `KioskSky`'s inline-style pair + `TimerRing`'s inline-style transition + `VoiceLevelBars`' inline-style transition):

| Location | Motion | Gated? |
|---|---|---|
| `globals.css:125,130` `.dot-unhealthy`/`.dot-restarting` | `pulse` infinite | **Yes** — newly fixed, see above |
| `globals.css:307` `.kiosk-pin-shake` | 420ms shake | Yes (`globals.css:328-332`) |
| `globals.css:352` `.voice-mic-recording` | 1.6s breathing ring | Yes (`globals.css:363-368`, static ring substituted) |
| `globals.css:218` `.net-reveal` | 760ms sweep (not kiosk) | Yes |
| `globals.css:255,278` `.log-arrival`/`.rail-arrival` | 1100ms settle (not kiosk) | Yes |
| `kiosk-attention.tsx:63,68` entrance fade | 500ms opacity/translate | Yes (`motion-reduce:transition-none` + reduced-motion end-state classes) |
| `kiosk-display.tsx:305` `WeatherSkeleton` | `animate-pulse` | Yes |
| `kiosk-display.tsx:586` briefing-preparing dot | `animate-pulse` | Yes |
| `kiosk-hub.tsx:251` `ToggleTile` brightness bar | `transition-[width]` 500ms | Yes |
| `kiosk-hub.tsx:645` `HubSkeleton` tiles | `animate-pulse` | Yes |
| `kiosk-timers.tsx:253` `KioskTimersButton` finished state | `animate-pulse` | Yes |
| `kiosk-timers.tsx:439` `TimerCard` finished state | `animate-pulse` | Yes |
| `kiosk-timers.tsx:423` `TimerRing` progress stroke | inline-style `transition: stroke-dashoffset 900ms linear` | **No** |
| `kiosk-voice.tsx:41-44` `VoiceLevelBars` bar height | inline-style `transition: transform 80ms linear` | No, but documented exempt (see below) |
| `kiosk-voice.tsx:163` mic-button spinner | `animate-spin` | Yes |
| `kiosk-sky.tsx:72,147,161` ambient sky drift | inline-style `transition` (90s) | Yes — via injected `<style>` block, `!important` override (`kiosk-sky.tsx:121-125`) |

**P2 — `TimerRing`'s progress transition has no `prefers-reduced-motion` gate.** `kiosk-timers.tsx:423`. This is a real miss, not a nitpick: it's structurally the same pattern as `ToggleTile`'s brightness bar (`kiosk-hub.tsx:251`) — a meter/gauge that smoothly transitions its own visual position on every state tick rather than jumping — and that one *is* gated. `TimerRing`'s `now` (hence `progress`) updates once a second while any timer is running and the overlay is open, so under `prefers-reduced-motion: reduce` this ring keeps performing a 900ms eased sweep once a second, every second, for as long as a timer runs and the overlay stays open — indefinitely, on request, exactly the pattern DESIGN.md's rule ("gate every authored animation… reduced-motion escape") exists to catch, and exactly the pattern the P1 finding from the last audit was about. `VoiceLevelBars`' otherwise-similar ungated transition (`kiosk-voice.tsx:41-44`) is defensible by contrast — the file's own header comment explicitly argues the bar *is* the data, not decoration, and `use-voice.ts` freezes it to a flat level under reduced motion at the source. `TimerRing` has no equivalent argument or freeze; it reads as an oversight, not a documented exemption, and it's a live user path (open the timer overlay, glance at a running timer) rather than a rare crash screen.

## Theme character check

Re-examined the palette after the ~24 contrast-driven color changes referenced in `CLAUDE.md` (every ink/status role now ≥4.5:1 per that note). Went through all 15 named themes' full `@theme` blocks plus `default`.

**Character intact across the catalog.** Every changed value moves *along* its theme's own hue, never toward neutral gray and never toward another theme's palette:
- `terminal`'s ink-faint stays phosphor green (`#40693f`→`#50834e`), `journal`'s stays warm newsprint gray (`#8b887f`→`#716e66`), `lounge`'s stays amber-brown (`#77624a`→`#947a5c`) — same families, just clearer against their grounds.
- `sunroom`/`aerogel`/`understory`/`duotone`/`cinderblock`'s darkened `ok`/`warn`/`bad` values all stay recognizably the same color (a darkened green is still green, a darkened rust is still rust) — none flattened toward the sunroom-blue/aerogel-indigo accent or toward each other.
- `aurora`'s change is isolated to `ink-faint` alone (`globals.css:747-753`), with the most careful reasoning of any token in the file — it's tuned against *both* the alpha-composited-on-bg reading and the flat-panel reading simultaneously, because `.panel` there also carries `backdrop-filter: blur`. Genuinely well done.
- `chrome`'s `bad` moved further than most (`#ff4d4d`→`#ff6969`, a real softening toward coral) but its defining moves — amber accent, brushed-metal bevel, `Chakra_Petch` sans — are all untouched, so the identity holds.

No theme reads as flattened or de-differentiated by the pass. The catalog's four-family taxonomy (core / light & calm / warm & editorial / dark & expressive) still groups themes that visibly belong together and separates ones that don't.

## Remaining findings

1. **P2 — `TimerRing` progress transition has no reduced-motion gate.** `kiosk-timers.tsx:423`. See Motion coverage above.
2. **P3 — Radius-token adoption gap: `rounded-tile`, `rounded-[0.5rem]`, and `rounded-lg` all express the same 0.5rem value in kiosk scope, and the named token is used in the one place that isn't a tile.** `error.tsx:133` (`rounded-tile`), `kiosk-timers.tsx:516` (`rounded-[0.5rem]`), `kiosk-hub.tsx:230,281,495,645` + `kiosk-glance.tsx:129` (`rounded-lg`). See Post-wave consistency review.
3. **P3 — `--radius-panel` token is defined but has zero consumers, including `.panel` itself.** `globals.css:44` (declaration) vs. `globals.css:169` (`.panel`'s own hardcoded `0.625rem`). Orphaned constant.
4. **P3 — `error.tsx`'s Reload button radius still doesn't match its true peer tier**, now via a named token rather than a coincidence. `error.tsx:133` (`rounded-tile`, 0.5rem) vs. every other `h-14` control in kiosk scope (`rounded-md`, 0.375rem) — see fix-verification table. Downgraded from the original finding's severity since the height half is now justified; the radius half is a smaller, purely visual mismatch (0.5rem vs 0.375rem) on a screen few people see.

## Genuinely good (unchanged from last pass, re-confirmed)

The status-dot system, `KioskAttentionCard`'s silence-is-the-payload design, the 16-theme catalog's real variety, `KioskSky`'s solar-driven ambient tint, the honest stale/empty/unconfigured states, and `error.tsx`'s self-healing crash ladder all re-verified as described in the original audit — no regressions found in any of them.
