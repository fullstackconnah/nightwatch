# Kiosk screen — impeccable audit (2026-08-03)

Technical audit of the `/kiosk` surface: `src/app/kiosk/**`, `src/components/kiosk-*.tsx`,
with `src/app/globals.css` and `DESIGN.md` as the system of record. Register: **product**
(design serves the task). Platform: web (installed iOS PWA). Five dimensions audited in
parallel; every headline number below was recomputed independently before publishing.

Dimension detail: `audit-01-a11y.md` · `audit-02-performance.md` · `audit-03-theming.md`
· `audit-04-responsive.md` · `audit-05-antipatterns.md`

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2/4 | `ink-faint` captions fail AA in **8 of 16 themes**; zero headings on the entire surface |
| 2 | Performance | 3/4 | Lean idle budget (3 timers), but the sky layer animates `top` on a full-viewport element forever |
| 3 | Responsive | 2/4 | A shared desktop button shrinks lifecycle controls to **32px at exactly the wall-iPad widths** |
| 4 | Theming | 3/4 | All 16 themes override all 14 color tokens — but fonts, `::selection` and the hatch texture leak the default |
| 5 | Anti-Patterns | 3/4 | No AI tells; two `infinite` pulse animations ignore `prefers-reduced-motion` |
| **Total** | | **13/20** | **Acceptable — significant work needed** |

## Anti-Patterns Verdict

**Pass. This does not read as generated.** Every ban was matched against the code and
came back clean: no side-stripe accent borders, no gradient text, no hero-metric tiles,
no numbered section scaffolding, no identical filler card grids, no nested-card slop, no
bounce easing, no arbitrary z-index escalation.

Product-register trust test: **pass**. Tile grids, the ring-gauge timer and the wall-clock
face match the conventions a Home Assistant / Apple Home / Nest Hub user already knows,
and the component vocabulary comes from one documented system.

Four patterns were examined and **deliberately not counted** as hits, with reasoning:
- **Glassmorphism** — the pin-pad and timer scrims are modal scrims (legitimate); the
  aerogel/aurora blur is an opt-in themed identity, not default panel glass.
- **Uppercase eyebrow** — `.microlabel` is a documented brand commitment in PRODUCT.md
  and DESIGN.md, used identically on the sibling `/smarthome` panels. It is the app's one
  heading idiom, not decoration layered onto the kiosk.
- **Nested cards** — `ClimateCard` inside a panel uses DESIGN.md's own `tile` treatment,
  consistent with `ToggleTile` / `SceneTile`.
- **z-index: 60** on the terminal theme's scanline layer — one reasoned step above the
  modal layer, and commented.

The 15-theme catalog is architecturally uniform rather than a hue-shift grab-bag, which is
the failure mode a catalog that size usually has.

## Executive Summary

- **13/20 — Acceptable.** The craft is real and visible; the gaps are structural and
  concentrated, not scattered.
- Roughly **1 P0, ~19 P1, ~10 P2, ~8 P3** across the five reports.
- The kiosk's *own* code is disciplined. Most of the damage comes from two seams: shared
  components carrying desktop assumptions onto a touch surface, and a theme system that
  systematized color but not everything else.

**Top 5 critical:**

1. **[P0] Lifecycle controls are 32px at wall-iPad widths.** `ui/button.tsx:20` sizes the
   `icon` variant `h-10 w-10 md:h-8 md:w-8` — 40px base (already under the 44px floor),
   dropping to 32px at ≥768px, which covers both 1024 and 1180. `kiosk-admin-panel.tsx:27`
   renders it without `dense`, so the `md:` shrink is unconditional. A desktop density rule
   is silently governing the primary touch surface.
2. **[P1] `ink-faint` fails WCAG AA in 8 of 16 themes** — default 2.93, terminal 3.19,
   journal 3.40, lounge 3.16, bulletin 3.84, aurora 4.31, chrome 3.32, pixel 2.86 (default,
   terminal and pixel also fail the 3:1 large-text floor). Independently recomputed from
   `globals.css`. It is one rule (`globals.css:74-80`) driving every caption on the screen,
   which makes it the highest-leverage fix in this audit.

   **Worse in the Glance layout**, which is panel-less by design, so `ink-faint` sits
   directly on the theme ground. The Glance Admin button (`kiosk-glance.tsx:198`) fails in
   7 themes — default 3.10, terminal 3.31, **journal 3.17**, lounge 3.37, **bulletin 3.84**,
   chrome 3.81, pixel 3.12 — and four more pass by under 0.1 (folio 4.54, slate 4.50,
   sunroom 4.55, aerogel 4.57), which is not a margin worth shipping. **journal and bulletin
   are light-ground themes**: this is precisely the "light theme inherits a dim ink token"
   case, confirmed real. Glance is now the default layout for a fresh device, so this is the
   path most panels take.

   Note on method: all 16 themes declare all 14 `--color-*` variables, so there are no
   silent inheritance gaps — `ink-faint` is *deliberately* set this low per theme. The fix
   is a value decision across the catalog, not a missing override.
3. **[P1] Zero `<h1>`-`<h6>` across all 30 kiosk files** (verified by walk). Every caption
   is a styled `<span>`. No heading structure for assistive tech on the whole surface.
4. **[P1] Pinch-zoom disabled** — `kiosk/layout.tsx:40-41` sets `maximumScale: 1` and
   `userScalable: false`. WCAG 1.4.4 failure technique.
5. **[P1] Two custom modals with no dialog semantics** — the PIN pad
   (`kiosk-pin-pad.tsx:69-133`) and the timers overlay (`kiosk-timers.tsx:280-324`) have no
   `role="dialog"`, no `aria-modal`, no focus trap, no Escape-to-close, no initial focus.

## Detailed Findings by Severity

### P0

**Lifecycle icon buttons below the touch floor at wall widths** · Responsive ·
`ui/button.tsx:20`, `container-controls.tsx:144-148`, `kiosk-admin-panel.tsx:27`
Impact: the PIN-elevated admin panel — the one place the kiosk performs destructive
container actions — has 32px targets on the wall tablet. Mis-taps land on the neighbouring
Start/Stop/Restart. Standard: WCAG 2.5.5 (44px), project floor 44px, kiosk convention 56px.
Fix: pass `dense={false}` semantics through, or give the kiosk its own size variant that
doesn't inherit the `md:` shrink. → `/impeccable adapt`

### P1 — selected (full lists in the dimension docs)

**`ink-faint` contrast, 8/16 themes** · A11y · `globals.css:74-80` — one token, every
caption. → `/impeccable polish`

**No heading structure** · A11y · all kiosk files. → `/impeccable harden`

**Pinch-zoom disabled** · A11y · `kiosk/layout.tsx:40-41`. Note the tension: a kiosk
legitimately wants to suppress accidental zoom, but WCAG 1.4.4 does not exempt it. Decide
deliberately and record the decision. → `/impeccable harden`

**Modal semantics missing (×2)** · A11y · `kiosk-pin-pad.tsx:69-133`,
`kiosk-timers.tsx:280-324`. → `/impeccable harden`

**Sky animates a layout property** · Performance · `kiosk-sky.tsx:87` —
`"top 90s linear, opacity 90s linear"` on two full-viewport radial-gradient layers
(`:140-167`), 4×/hour forever, on a tablet that never reloads. Should be `translateY`. The
codebase documents this exact rule elsewhere (`kiosk-voice.tsx:22-25`). → `/impeccable optimize`

**Pulse dots ignore reduced motion** · Anti-Pattern · `globals.css:94-103` + keyframes
`:120-124`. The only two `animation:` declarations in the file without a reduce branch —
and both are `infinite`. Every other animation (`:179, :216, :239, :268, :313`) has one.
→ `/impeccable animate`

**`::selection` never scoped to the theme** · Theming · `globals.css:64-66` — default teal
highlight on every non-default theme. → `/impeccable extract`

**Hatch texture frozen to the dark theme** · Theming · `kiosk-display.tsx:47`,
`kiosk-hub.tsx:56` — `rgba(77,97,122,.14)` is `ink-faint`'s *default* hex, hard-coded, so
every theme's unconfigured-state texture keeps the dark tint. → `/impeccable extract`

**No radius token scale** · Theming · DESIGN.md documents `rounded.tile: 0.5rem`; `@theme`
has zero `--radius-*` properties. The scale rides on Tailwind coincidence, and
`kiosk-timers.tsx:436` hand-writes `rounded-[0.5rem]`. → `/impeccable extract`

**Fixed buttons bypass safe-area insets** · Responsive · `kiosk-glance.tsx:192-198` are
`fixed bottom-4`, but `KioskThemeScope` applies `env(safe-area-inset-*)` as *padding on a
div* (`kiosk-theme.tsx:224-227`) — padding never reaches a fixed descendant. → `/impeccable adapt`

**Glance headline readout undersized** · Responsive · `kiosk-glance.tsx:170` — temperature
at 30px against a 112px clock, in a file whose own thesis names both as the elements that
must read from across a room. → `/impeccable typeset`

**Load-bearing signal hidden on phone** · Responsive · `kiosk-status-strip.tsx:70-85` —
the vitals-unreachable warning is `hidden sm:flex`, so the phone silently loses it. The
severity chip correctly stays visible at every width; this one is inconsistent with it.
→ `/impeccable adapt`

**State panels missing `role="status"`** · A11y · `kiosk-display.tsx:275-295`,
`kiosk-hub.tsx:626-679` — inconsistent with `kiosk-status-strip.tsx:104`,
`kiosk-health.tsx:50`, `kiosk-attention.tsx:60`, which do it correctly. → `/impeccable harden`

**`Meter` encodes its value only as bar width** · A11y · `charts.tsx:53-75`, used for
memory/disk in `kiosk-vitals.tsx` — no `role="progressbar"`, no `aria-valuenow`, no text
equivalent. Sibling `Gauge` overlays real percent text. → `/impeccable harden`

### P2 / P3 — see dimension docs

Hub sections re-render every 7s HA poll on reference inequality (`kiosk-hub.tsx`);
`active:scale-[0.98]` repeated 17× with one drift to `0.97` (`kiosk-glance.tsx:129`);
`LIGHT_THEMES` restated a third time in `kiosk-sky.tsx`; 5/15 themes never override
`--font-sans`; `chrome` borrows Aerogel's mono font const (`globals.css:737`);
`error.tsx:133` uses `h-14 rounded-lg` where kiosk siblings use `h-11 rounded-md`.

## Patterns & Systemic Issues

1. **Shared components import desktop assumptions onto a touch surface.** The P0 is the
   sharp edge of this: `ui/button.tsx`'s `md:` shrink is correct for a mouse at a desk and
   wrong for a wall tablet, and nothing at the kiosk boundary re-asserts the touch floor.
   The `hidden sm:flex` vitals warning is the same class of error. **The kiosk needs its
   own size contract at the seam where shared components enter it.**
2. **The theme system systematized color and stopped there.** All 16 themes override all 14
   color tokens with zero holes — genuinely good. But fonts (5/15 missing), `::selection`,
   the hatch literal, and `color` inheritance all still leak the default. The `font-family`
   scope bug already documented in `globals.css` was the first symptom of this, fixed
   locally rather than as a class.
3. **Accessibility is strong per-control and absent per-document.** `aria-label`,
   `role="switch"`, `aria-checked`, `focus-visible` rings and redundant colour+text coding
   are applied consistently and well. Headings, landmarks, dialog semantics and live
   regions — the document-level layer — are missing entirely.
4. **DESIGN.md has drifted from the code** in both directions: it documents a radius token
   that doesn't exist, and it still states a "dark only, no light theme" rule with no
   carve-out for the nine legitimate light kiosk themes.

## Positive Findings

- **`KioskAttentionCard`'s silence-is-the-payload design** — alert-by-exception with a real
  threshold, not a permanent widget.
- **The 15-theme catalog** is differentiated by actual ideas (typography, texture, ground)
  and stays architecturally uniform — including per-theme sky opacity caps.
- **Honest states throughout** — unconfigured vs unreachable vs stale are kept distinct
  rather than collapsed, and the recent per-endpoint stale work extended that correctly.
- **One shared 1 Hz clock** (`use-now.ts:26-40`) for the whole app, absolute timestamps
  everywhere (`endsAt`, `lockedUntil`, `expiresAt`) so nothing drifts or breaks on
  backgrounding.
- **Glance as the default costs ~12.7 req/min against standard's ~34.6** — roughly a third
  of the idle network load, because it renders neither the status strip nor the attention card.
- **`error.tsx`'s crash ladder** is tuned for an unattended tablet rather than a developer.
- Tree-shakeable named `lucide-react` imports; `preload: false` on all 23 theme fonts;
  shared SWR key between `KioskSky` and `useWeatherView` (zero duplicate requests).

## Recommended Actions

1. **[P0] `/impeccable adapt`** — kiosk touch-target contract at the shared-component seam
   (lifecycle icons 32px→56px at wall widths), fixed-button safe-area insets, and the
   phone-hidden vitals warning.
2. **[P1] `/impeccable polish`** — the `ink-faint` caption token across the 8 failing
   themes; this is one rule and it fixes every caption on the surface.
3. **[P1] `/impeccable harden`** — document-level a11y: heading structure, dialog semantics
   and focus traps on the two modals, `role="status"` on the remaining state panels,
   `Meter`'s accessible value, and a recorded decision on the pinch-zoom trade-off.
4. **[P1] `/impeccable optimize`** — sky layer `top` → `transform`, and memoize the hub's
   five sections against the 7s poll's reference inequality.
5. **[P1] `/impeccable animate`** — `prefers-reduced-motion` branch for the two infinite
   pulse dots.
6. **[P2] `/impeccable extract`** — promote the radius scale, `active:scale`, `LIGHT_THEMES`
   and the hatch pattern into real tokens; scope `::selection` to the theme.
7. **[P2] `/impeccable typeset`** — glance-layout distance hierarchy (30px temperature
   against a 112px clock).
8. **Finally `/impeccable polish`** — consistency sweep once the above land.
