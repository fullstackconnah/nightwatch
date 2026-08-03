# Sunroom — living light

**Status:** contract. Every agent working on this builds against this file.
**Scope rule (non-negotiable):** everything here is exclusive to
`[data-kiosk-theme="sunroom"]`. No other theme's rendering may change. The one
allowed shared edit is an **additive, optional** field on `WeatherSun`.

---

## Thesis

A sunroom is a room whose entire character is the light coming through it. The
theme we ship today is that room with the blinds shut: one fixed cool-grey
ground (`#e3e7ee`), one fixed neumorphic light source pinned forever at the
top-left. It is a photograph of a sunroom, not a sunroom.

Make the light real. The house already computes true solar position
(`src/lib/weather.ts:236` `solarPosition`) against its own coordinates, and
`KioskSky` already proves the pattern: real sun data, compositor-only
properties, long transitions riding a 15-minute data cadence, reduced-motion
collapse. Sunroom becomes the theme where that data stops being an ambient
wash and becomes the room's actual lighting.

Two things move, and they are the whole design:

1. **The palette** warms and cools along the day.
2. **The light direction** travels — east in the morning, overhead at noon,
   west in the afternoon — and every neumorphic shadow on screen follows it.

(2) is the reason this belongs to sunroom and nowhere else: sunroom is the
only theme in the catalog whose surface treatment *is* a directional light
model. In any other theme a moving light source has nothing to move.

## What this is not

- Not a hue tour. Real rooms change in **temperature and lightness**, not by
  travelling the colour wheel. Chroma stays low throughout; the drama lives in
  the shadows, not the ground.
- Not a dark theme at night. Sunroom stays `color-scheme: light` at every hour.
  `/kiosk` already has a full-page night treatment (`src/app/kiosk/page.tsx`,
  `showNightOverlay`) that owns actual darkness, and `KIOSK_LIGHT_THEMES`
  (`kiosk-theme.tsx:148`) is a static set that other code branches on —
  a theme that changed ground lightness at runtime would silently falsify it.
  Sunroom's night stop is the *coolest, dimmest light* stop, not a dark mode.
- Not decoration. If a change cannot be traced to a solar input it does not
  ship.

---

## Data

### `WeatherSun` gains one field

`src/lib/weather.ts` already computes `hourAngleDeg` inside `solarPosition`
and throws it away at line 274. Expose it.

```ts
export interface WeatherSun {
  elevationDeg: number;
  phase: "night" | "dawn" | "day" | "dusk";
  progress01: number;
  /** Solar hour angle, -180..180. Negative = before solar noon (sun to the
   *  east), positive = after (sun to the west). Advances a uniform 15°/hour,
   *  which is what lets the client extrapolate light direction between the
   *  15-minute weather fetches without a second round trip. */
  hourAngleDeg: number;
}
```

Additive and non-optional in the type (the server always computes it), but
every consumer must tolerate its absence at runtime — a cached response from
the previous deploy will not have it.

### Why hour angle and not a true azimuth

A true azimuth would be more correct about where the sun physically is, and
useless here: the screen is not a window, and we do not know which way the
room faces. What has to read on the glass is *travel* — light that is
demonstrably on the left in the morning and on the right in the afternoon.
Hour angle is exactly that signal, is exact rather than approximated, and
advances linearly, which the client depends on. Document this choice in the
code; it is a deliberate simplification, not an oversight.

---

## The solar ramp

A single scalar `t ∈ [0, 6)` indexes a six-stop ramp. Everything visual is a
function of `t` plus two modifiers.

| `t` | stop | when |
|-----|------|------|
| 0 | `night` | `elevationDeg <= -6` |
| 1 | `dawn` | `-6 < elev <= 6`, rising |
| 2 | `morning` | `elev > 6`, rising, below the day's mid |
| 3 | `midday` | high sun, either side of solar noon |
| 4 | `golden` | `elev > 6`, falling, below the day's mid |
| 5 | `dusk` | `-6 < elev <= 6`, falling |

`t` is **continuous**: between two stops it holds a fraction and every value
below is linearly interpolated. It wraps 5 → 0 through the evening. Rising vs
falling comes from `hourAngleDeg < 0`.

### Modifiers

- **`cloud01`** — `current.cloudCoverPct / 100`. Overcast is diffuse light:
  it *shortens and softens* shadows toward ambient and desaturates the ground.
  Full overcast must never flatten shadows to nothing; a panel still has to
  read as a panel.
- **`elev01`** — normalised elevation. Drives shadow length and softness: low
  sun casts long soft shadows, high sun casts short tight ones.

---

## The custom-property contract

The runtime writes only these. `globals.css` consumes them with a static
fallback on every single one, so sunroom with no weather data renders exactly
as it does today.

**Palette** (registered `<color>`, inherits):
`--sr-bg` `--sr-panel` `--sr-panel-2` `--sr-line` `--sr-line-bright`
`--sr-ink` `--sr-ink-dim` `--sr-ink-faint` `--sr-accent` `--sr-accent-dim`
`--sr-ok` `--sr-warn` `--sr-bad`

**Light model** (registered, inherits):
`--sr-light-x` `<length>` — signed; negative = light from the left (morning)
`--sr-light-y` `<length>` — the vertical drop, from elevation
`--sr-blur` `<length>` — softness
`--sr-shadow-a` `<number>` — dark-side alpha
`--sr-highlight-a` `<number>` — lit-side alpha
`--sr-shadow-rgb` `<color>` — the shadow's own hue
`--sr-highlight-rgb` `<color>` — the lit side's hue
`--sr-warmth` `<number>` — 0..1, peaks at `golden`, floors at `night`

### The warmth lives in the light, not in the ground

The obvious move at golden hour is to turn the body background beige. Don't.
A warm-neutral near-white ground is the single most over-produced surface in
this whole category, it costs contrast headroom on every token at once, and it
is not even what the hour looks like — at 5pm a real room is not repainted, it
is *lit differently*. So the ground travels only a few units across the whole
day and stays low-chroma, while `--sr-shadow-rgb`, `--sr-highlight-rgb` and
`--sr-warmth` do the actual work: a cool blue-violet shadow with a white
highlight at midday becoming a warm violet-grey shadow with an amber-white
highlight at golden. The theme's signature is its shadows; make the shadows
carry the hour.

The sunroom block then reads e.g. `--color-bg: var(--sr-bg, #e3e7ee);` and
the panel treatment becomes a function of the light vector:

```
box-shadow:
  var(--sr-light-x) var(--sr-light-y) var(--sr-blur) rgba(<cool>, var(--sr-shadow-a)),
  calc(-1 * var(--sr-light-x)) calc(-1 * var(--sr-light-y)) var(--sr-blur) rgba(255,255,255, var(--sr-highlight-a));
```

Shadow falls **away** from the light; highlight sits on the lit side. They are
always exact opposites — that is what makes it read as one light source rather
than two lamps.

### Why `@property`

Custom properties are strings and do not interpolate. Register all of the
above with `@property` (in `globals.css`, statically) and a single
`transition` on the sunroom scope animates the entire palette and light model
at once, with every downstream `var()` re-resolving as it goes. Without
registration the theme snaps between values and the whole idea dies.

---

## Two materials, one light

**The glance layout renders no `.panel` elements at all.** This is deliberate
and documented in `kiosk-glance.tsx:15` — glance is "OPEN GROUND … type and
spacing carry the composition." It is also the layout the wall tablet *rests
in*: the surface falls back to glance after 30s of inactivity and only enters
full on touch. So a light model that lives exclusively in panel shadows is
invisible during the overwhelming majority of the day, on the theme whose
entire premise is that you can see the light.

The light source is the same in both layouts. Only the material it falls on
changes.

- **Full layout — panels.** The neumorphic shadow pair, offset along the light
  vector. This is the signature and it is unchanged from the section above.
- **Glance layout — the ground.** No boxes to cast shadows, so the light falls
  on the room itself: a soft lightness gradient across the ground, brighter on
  the lit side and a touch deeper opposite, with its origin driven by the same
  `--sr-light-x` and its intensity by elevation and inverse cloud.

**Keep the ground wash achromatic.** `KioskSky` already paints a sun-coloured
radial over every theme (capped at 0.05 opacity on light grounds). A second
*coloured* sun blob underneath it would double up and turn the ground muddy.
Sunroom's wash is not sky — it is light falling into a room — so it moves
lightness, not hue, and the two layers compose as "tinted sky" plus "directional
light" rather than fighting over the same job. Magnitude is a few percent at
most; on a pale ground anything more is a stain.

## Motion

Three behaviours, all sunroom-only.

1. **Solar drift.** The light direction updates on a **60s tick**, not only on
   the 15-minute weather fetch: hour angle advances an exact 0.25°/min, so the
   client extrapolates it from the fetched anchor. Each step is then tiny and
   a 60s linear transition makes the travel genuinely continuous rather than a
   quarter-hourly lurch. Palette and elevation-driven softness ride the fetch
   cadence with a longer crossfade.
2. **Press.** `button:active` flips the neumorphic shadow inward (inset), fast
   — ~120ms, ease-out. This is the one affordance soft-UI actually owes the
   user, the surface is a touchscreen, and no other theme has the shadow
   vocabulary to express it.
3. **Warmth bloom.** Live/active state carries a soft glow whose intensity is
   `--sr-warmth`. The room glows at golden hour and goes quiet at night.
   Subtle: this must never become the thing you notice.

**Reduced motion is not optional.** `prefers-reduced-motion: reduce` collapses
every transition above to an instant cut. The values still update — the room
still tracks the sun — only the tweening stops. Follow the `!important`
override pattern `KioskSky` already uses (`kiosk-sky.tsx:118`).

Performance: transitions run on inherited registered properties on **one**
scope element, not per-component declarations. This is a wall tablet that
holds one screen for hours; a 60s transition that repaints the tree every
frame is a real cost and must be measured, not assumed.

---

## Gates

Nothing ships until all four pass with recorded evidence.

1. **Contrast at every stop.** `ink`, `ink-dim`, `ink-faint`, `accent`, `ok`,
   `warn`, `bad` each ≥ 4.5:1 against `bg`, `panel` and `panel-2`, for all six
   stops. The current theme's comments (`globals.css:563-581`) show how hard
   won these ratios were — several tokens sit within 0.05 of the line. Do not
   spend that margin.
2. **Contrast *between* stops.** Linear interpolation between two passing
   endpoints can dip below the line in the middle. Sample at least 10 steps
   across every adjacent pair, including the 5 → 0 wrap, and verify each.
   This gate is the whole reason the ramp is testable code and not a CSS
   keyframe list.
3. **No other theme moves.** Every new rule sits under
   `[data-kiosk-theme="sunroom"]`. The runtime component returns `null` unless
   the active theme is sunroom. Verify by screenshotting a second theme before
   and after.
4. **Layout holds.** 1024×768 and 1180×820 (the wall tablet's real sizes),
   plus 390px as the phone regression check. Zero horizontal overflow, no
   clipped content, at more than one solar stop.
5. **Both layouts carry the light.** Glance (`?layout=glance`, the resting
   state) and full (`?layout=standard`) each have to show the day moving —
   the ground wash and the panel shadows respectively. A pass on panels alone
   is not a pass.

The harness for gates 3 and 4 already exists and runs:
`…/62f3501f-…/scratchpad/sunroom-check.mjs` drives five mocked solar states at
both tablet sizes, reads every `--sr-*` back off a live `.panel`, and asserts
the two things that separate a real implementation from a recolour: that
`--color-bg` actually differs across night/midday/golden, and that **the panel
shadow's x-offset changes sign between morning and afternoon**. It also
re-loads a second theme under two different sun mocks to prove no leakage.
Six assertions fail today for the correct reason — nothing is implemented yet.
Extend it for gate 5 rather than writing a second harness.

Screenshots are evidence. Measurements alone are not — this surface has
already shipped a doubled degree symbol and a duplicated room name that every
numeric check passed clean.

---

## Files

| File | Change |
|------|--------|
| `src/lib/weather.ts` | expose `hourAngleDeg` on `WeatherSun` |
| `src/lib/sunroom-light.ts` | **new** — the ramp: stops, `t`, palette + light model as pure functions |
| `src/components/kiosk-sunroom.tsx` | **new** — subscribes to the weather feed, ticks, emits the scoped `<style>`; `null` off-theme |
| `src/app/kiosk/layout.tsx` | mount alongside `KioskSky` |
| `src/app/globals.css` | `@property` registrations; sunroom block reads the vars with fallbacks; press + bloom |
| `scripts/sunroom-contrast.mjs` | **new** — gates 1 and 2, runnable, prints ratios |

## Constraints inherited from the project

- **No new runtime dependencies** (PRODUCT.md). The maths is small; write it.
- **No token *value* changes outside the sunroom block.** Contrast headroom
  across the other 15 themes is nearly zero.
- `KIOSK_THEME_SWATCHES` in `kiosk-theme.tsx:180` mirrors sunroom as
  `accent: #3964bf` while `globals.css:573` has since moved to `#3760b7` —
  the desync its own comment warns about has already happened. Fix it to the
  ramp's midday accent while you are in there.
