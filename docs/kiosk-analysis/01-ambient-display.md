# Kiosk ambient-display analysis — glanceable information design

Lens: how the kiosk screen itself should behave for a 1-3 m, 24/7, wall/bench-mounted ambient display. Not feature invention — screen optimisation.

## Current state (cited)

### Typographic / density scale actually used

The codebase runs **two unreconciled type scales** on the same route:

- **Glance layout** (`kiosk-glance.tsx`) is genuinely distance-tuned. `KioskClock` renders at `text-[4.5rem] min-[420px]:text-[5.5rem] md:text-[7rem]` (`kiosk-clock.tsx:29`) — the single largest element in the app, explicitly called out in its own comment as "bigger than anything the logged-in dashboard ever sets" (`kiosk-clock.tsx:17-22`). Below it: current temp at `text-3xl` (1.875rem, `kiosk-glance.tsx:170`), condition label `text-xl` (`kiosk-glance.tsx:171`), and the two status sentences at `text-base` (`kiosk-glance.tsx:177`). Four control tiles run `text-sm` (`kiosk-glance.tsx:129`). Nothing on this layout is smaller than 0.875rem/14px.
- **Standard layout** (the default — `layout` state seeds `"standard"`, `kiosk-page.tsx:57`) is the full dashboard instrument-panel vocabulary imported wholesale: `KioskStatusStrip` prints the clock at `text-lg md:text-xl` (1.125–1.25rem, `kiosk-status-strip.tsx:55`) with cpu/mem figures at `text-xs` (0.75rem) *hidden below `sm`* (`kiosk-status-strip.tsx:77`), the weather band's biggest reading is `text-4xl` (2.25rem, `kiosk-display.tsx:340`) but everything else — microlabels, forecast strip cells, rain ribbon, briefing body — sits at 0.6–0.75rem per DESIGN.md's own "bottom-heavy ramp" (`DESIGN.md:284`, "nine of the twelve steps sit at or below body size"). That ramp is authored for a desk/phone-in-hand reading distance ("read by one person... leaning into it at 2am", `DESIGN.md:221`), not a 1-3 m wall glance.
- The **night overlay** clock (`kiosk-display.tsx:704`, `text-6xl md:text-8xl` = 3.75–6rem) is smaller than the glance-layout clock above it, despite night being the one period where the *entire* screen budget goes to a single reading and nothing else competes for size.

**Gap:** the layout that's actually correct for the stated viewing distance (Glance) is not the default, and reaching it requires knowing it exists (`kiosk-appearance.tsx`, mounted only when `elevated` — i.e., behind the PIN, `kiosk-page.tsx:179`). A wall-mounted iPad set up once and never touched again stays on Standard forever.

### Information hierarchy: `standard` vs `glance`

Both layouts are real, deliberate, and honestly documented in their own THESIS comments (`kiosk-glance.tsx:3-17`, `kiosk-display.tsx:3-19`). The split itself is the right model — one open-ground distance surface, one dense panel surface for when someone is standing at it doing admin work. What's misjudged is which one is the *default* and how discoverable the choice is: the switcher lives inside `KioskAppearance`, rendered only `elevated && expiresAt !== null` (`kiosk-page.tsx:176-181`), i.e. only after a 4-digit PIN. For a "device-local, wall vs bench" choice (`kiosk-page.tsx:27-30` says exactly this), gating it behind auth adds friction to a decision that should be made once at physical setup time, not tied to the admin elevation window.

Within Standard, hierarchy is already handled well in the places that were touched recently: `KioskAttentionCard` renders nothing when healthy and sits first in the column when it does speak (`kiosk-page.tsx:171-173`), and `KioskStatusStrip` demotes date/cpu/mem before the alert chip (`kiosk-status-strip.tsx:56-92`). The unaddressed part is the *bulk* of Standard below the fold — `KioskDisplay` (weather + briefing) and `KioskHub` (the full Home Assistant control surface) — which is the entire authenticated-dashboard-style content set, not a curated ambient subset.

### Time-of-day / period behaviour

`useKioskPeriod` buckets local wall-clock hour into four fixed windows — morning 5-10, day 10-17, evening 17-22, night 22-5 (`kiosk-display.tsx:56-61`), recomputed every 60s (`kiosk-display.tsx:53,89-92`). This is a **separate, cruder clock** from the one already available: `KioskSky` independently fetches the weather API's own `sun` block (`elevationDeg`, `phase: "night"|"dawn"|"day"|"dusk"`, `progress01`) computed server-side from the house's real coordinates (`kiosk-sky.tsx:38,101-107`), but that phase only drives the decorative sky tint — it never feeds `useKioskPeriod`. The result: "morning" starts at a literal 05:00 year-round regardless of when dawn actually happens (a winter 05:00 is still full night at most temperate latitudes), while a real four-phase sun signal sits unused one file away.

Within period, weight allocation is real and sensible: morning gets `CurrentWeatherLarge` + `ForecastStrip` + `BriefingCard` (`kiosk-display.tsx:566-577,673`), day/evening compress to `CurrentWeatherCompact` (single row, `kiosk-display.tsx:366-401`), evening's forecast strip emphasises the tomorrow column (`kiosk-display.tsx:577`, `emphasizeIndex`). Night replaces the entire screen with `KioskNightOverlay` — clock + small current-conditions line only (`kiosk-display.tsx:686-728`) — and there is no fifth night-specific display band; the overlay *is* the night treatment, explicitly by design (`kiosk-glance.tsx:14-15`).

Night wake behaviour: a tap dismisses the overlay for 60s (`NIGHT_WAKE_MS`, `page.tsx:25`) and falls back to Standard's `displayPeriod = "day"` compact band, never a fifth period (`kiosk-page.tsx:104-108`).

### Rotation, dwell, motion

There is **no rotation or content cycling anywhere in the kiosk** — confirmed by search (no `rotat`/`carousel`/`cycle` hits outside comments and a CSS `-rotate-90` on a timer ring, `kiosk-timers.tsx:335`) and stated explicitly in the display THESIS: "Layout is a static choice per period, not a rotation" (`kiosk-display.tsx:6-8`). Given the stated setting (hallway, 7am, hard to please when scrolling/cycling underfoot), this is the correct baseline for an ambient surface, not a gap to fix.

Authored motion is deliberately rationed to a small, honest set: `KioskAttentionCard`'s one-time 500ms entrance fade that never re-triggers on a routine 30s re-poll of the *same* condition (`kiosk-attention.tsx:38-45,63-68`); `KioskSky`'s continuous 90s linear drift of the two ambient blobs tracking the sun (`kiosk-sky.tsx:87,151`); a 500ms width transition on the HA light brightness bar (`kiosk-hub.tsx:235`). All motion-reduce-safe. This matches DESIGN.md's "one authored moment per surface" rule (`DESIGN.md:236`) and is not something a hallway would find annoying.

### Burn-in, dimming, always-on behaviour

**No brightness, dimming, or wake-lock handling exists anywhere in the kiosk code** — confirmed by search; `visibilitychange`/`wakeLock` appear only in the unrelated `use-log-archive.ts`. Concretely absent:
- No `navigator.wakeLock` request, so iOS's own auto-lock/auto-dim timer is the only thing keeping the screen on; this is an OS setting the deployer must remember to disable, not something the page guarantees.
- No scheduled dimming for night (the night overlay is high-contrast `text-ink` on the near-black ground — same peak brightness as day, just less content).
- No pixel-shift / position jitter for the two elements most likely to sit static for weeks: the clock (fixed centre position, both layouts) and the sticky status strip (`sticky top-0`, `kiosk-status-strip.tsx:53`).
- Worth noting for calibration: the target devices are **LCD** iPads (per brief), which do not suffer classic OLED-style permanent burn-in — the real risk class here is temporary image persistence after very long static exposure, a much smaller problem than the "burn-in" framing implies. This should lower this item's priority, not raise it.

One relevant existing capability that *does* touch brightness indirectly: `kiosk-theme.tsx` ships nine light-background identities in `LIGHT_THEMES` (`kiosk-theme.tsx:50-60`) alongside the dark ones, each with its own halved `KioskSky` opacity cap (`kiosk-theme.tsx:125`, "0.05 on light ones"). This directly contradicts DESIGN.md's "dark only, no light-mode fallbacks anywhere in the codebase" (`DESIGN.md:225,435`) — that rule describes the authenticated dashboard; `/kiosk` has quietly built its own theme system that already goes light. Nothing currently switches between them automatically by time of day — it's a static per-device manual pick in `localStorage` (`kiosk-theme.tsx:165,183-206`).

## Gaps

1. Glance (the distance-correct layout) is opt-in and hidden behind the admin PIN, while Standard (desk-density) is the silent default on every fresh device.
2. `useKioskPeriod`'s morning/day/evening/night buckets are a fixed wall-clock schedule, ignoring the real sunrise/sunset `sun.phase` signal the app already fetches for `KioskSky`.
3. No screen wake-lock — always-on relies entirely on an external iOS setting.
4. No night-time dimming — the overlay is full brightness, just less content.
5. No automatic light/dark theme switching by period, despite the theme catalog already containing both.
6. No pixel-shift on the two long-lived static elements (clock position, sticky strip).

## Ranked proposals

| Proposal | Why | Cost (hrs) | Risk |
|---|---|---|---|
| Make Glance the default layout for a fresh device, keep Standard as the elevated/admin choice | The distance-correct surface should not require discovering a setting behind a PIN; `LAYOUT_STORAGE_KEY` already exists, this is a default-value + first-run flip | 1–2 | Low — additive, `?layout=` override and existing stored choice both still work |
| Screen Wake Lock API (`navigator.wakeLock.request('screen')` on mount, re-request on `visibilitychange`) | Removes total dependence on an OS setting nobody will remember to re-check after an iOS update; ~15 lines, zero new dependency (native browser API, satisfies PRODUCT.md's no-new-deps rule) | 1–2 | Low — feature-detect and no-op where unsupported |
| Drive `useKioskPeriod`'s morning/night boundaries off `KioskSky`'s existing `sun.phase`/`elevationDeg` instead of fixed 5/22 hours, with the current fixed hours as fallback before the weather feed lands | Fixes the actual-dawn mismatch cheaply since the data is already being fetched for the sky tint — this is wiring, not new capability | 2–4 | Medium — period changes propagate to Standard's weather band and Glance's tile ordering, needs a walk through both at a few sun angles |
| Night-time dimming: reduce the night overlay's effective brightness (a low-opacity near-black scrim, or swap `text-ink`→`text-ink-dim` for the clock) once truly dark, on a schedule/opacity ramp tied to `sun.phase` | A wall clock at full white-on-black brightness in a dark bedroom/hallway at 2am is the single biggest "should this screen behave differently at night" gap found | 2–3 | Low — purely visual, easy to gate behind reduced-motion-style escape if someone dislikes it |
| Auto-switch kiosk theme's light/dark family by period (reuse `LIGHT_THEMES` set + existing `setKioskTheme`) | The infrastructure (light identities, per-theme sky opacity cap) is fully built and unused for its obvious purpose; a bench iPad in a sunlit kitchen at midday genuinely benefits from a lighter ground | 3–5 | Medium — must not fight a user's explicit manual theme choice; needs an explicit "auto" tri-state distinct from a pinned theme, and a decision on which of the 4 light + dark groups pairs with which period |
| Pixel-shift the clock ±4-8px on an hourly cycle | Standard LCD image-persistence mitigation, trivial CSS | 0.5–1 | Low |

## Explicitly not worth doing

- **Content rotation/carousel.** The app already made the right call not to build this (`kiosk-display.tsx:6-8`). Cycling briefing headlines or forecast days on a timer would only add motion an ambient hallway display doesn't want, for content that already fits statically (4 headlines, 5 forecast days). Do not introduce this to "use the screen more."
- **OLED burn-in mitigations (compositor-level anti-aliasing, forced full-black rest frames, etc.).** The target hardware is LCD; that whole mitigation category solves a problem these devices don't have. The pixel-shift item above is the appropriately-sized version of this concern, not a bigger one.
- **A fifth "dawn"/"dusk" period bolted onto `useKioskPeriod`.** The sun-phase data already distinguishes four phases including dawn/dusk; the fix is re-deriving the *existing* four kiosk periods from that signal (item 3 above), not inventing new display states nobody asked for and Glance/Standard would both need new branches for.
