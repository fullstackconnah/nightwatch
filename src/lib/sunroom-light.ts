/* THESIS: the sunroom theme's light, as data.
 *
 * The shipped sunroom is a photograph of a sunroom: one fixed cool-grey
 * ground and one neumorphic light source pinned forever at the top-left. This
 * module turns that fixed lamp into the actual sun — a six-stop ramp indexed
 * by real solar position, from which every colour and every shadow on the
 * surface is derived.
 *
 * TWO RULES GOVERN EVERY NUMBER BELOW, and they are the whole design:
 *
 * 1. THE GROUND BARELY TRAVELS. Rooms do not get repainted at 5pm; they get
 *    lit differently. The grounds here move only a few units of lightness
 *    across the entire day, and their journey is from cool blue-grey at night
 *    to NEUTRAL at golden hour — the warmth of the afternoon is the *removal*
 *    of coolness, never the addition of beige. A warm-neutral near-white
 *    ground would also spend contrast headroom on all eight foreground tokens
 *    at once, and this theme has none to spend (see rule 2).
 *
 * 2. THE FOREGROUND HAS EXACTLY TWO STATES AND NEVER BLENDS BETWEEN THEM.
 *    There is one ink set for the lit half of the day and one for the dark
 *    half, each tuned to clear WCAG AA 4.5:1 against the darkest surface its
 *    own side produces. Within a side nothing moves at all, which is what
 *    makes that side safe to interpolate: contrast against a ground is
 *    monotonic in the ground's luminance, so ink that passes on the darkest
 *    ground passes on every lighter one and every point between.
 *
 *    Across the two sides it does NOT interpolate, and that is not a
 *    preference. Between a light ground and a dark one lies a band of ground
 *    luminance (roughly 0.18 to 0.33) where NO ink colour reaches 4.5:1 —
 *    dark ink needs the ground above ~0.33, light ink needs it below ~0.18,
 *    and nothing lives in between. Blending the ink through that band would
 *    put mid-grey text on a mid-grey ground at dusk every single day. So the
 *    ink SNAPS at the halfway point, only the ground crosses continuously,
 *    and the crossing is made short enough (a few hundred ms, not the 90s
 *    used elsewhere) that the illegible band is never a state anyone reads
 *    in. scripts/sunroom-contrast.mjs gates both ends and prints how many
 *    samples it exempted, so the exemption can't quietly widen.
 *
 *    Don't "improve" this by tweening the ink across dusk.
 *
 * So what actually carries the time of day? The SHADOWS. Sunroom is the only
 * theme in the catalog whose surface treatment is a directional light model,
 * and that model is where the day is legible: the shadow's direction swings
 * east→overhead→west, its length and softness track elevation, and its hue
 * runs cool blue-violet at midday to warm violet-grey at golden. That is the
 * theme's signature and it is doing the expressive work here, not the palette.
 */

/** The eight tokens that must clear contrast, plus the two structural lines.
 *  Mirrors the token set the `[data-kiosk-theme="sunroom"]` block declares in
 *  globals.css — if that block gains a colour, it gains one here too. */
export interface SunroomPalette {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  lineBright: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  accent: string;
  accentDim: string;
  ok: string;
  warn: string;
  bad: string;
}

/** The directional light model. Consumed as CSS custom properties; see the
 *  box-shadow composition in globals.css's sunroom block. */
export interface SunroomLight {
  /** The SHADOW's horizontal offset in px — not the light's. Positive means
   *  the shadow falls to the right, which means the light is coming from the
   *  LEFT. Morning is positive (+7, matching the shipped static value exactly,
   *  so the theme at 9am is continuous with the theme people already know),
   *  midday is ~0, and the afternoon is negative. The highlight is always the
   *  exact negation, which is what makes the pair read as one light source
   *  rather than as two independent lamps. */
  lightX: number;
  /** The shadow's vertical offset in px. Always positive: light comes from
   *  above at every hour a sunroom has any light at all. */
  lightY: number;
  blur: number;
  shadowA: number;
  highlightA: number;
  /** "r, g, b" triples rather than hex, because they are consumed inside
   *  rgba() in a box-shadow where the alpha is a separate animatable var. */
  shadowRgb: string;
  highlightRgb: string;
  /** 0..1, peaks at golden and floors at night. Drives the live-state bloom.
   *  Deliberately not derived from the palette — it is the one channel that
   *  is allowed to say "it is late afternoon" loudly. */
  warmth: number;
}

export interface SunroomState {
  palette: SunroomPalette;
  light: SunroomLight;
  t: number;
  /** The ground is dark and the ink is light. Consumers must forward this to
   *  `color-scheme`, or form controls and scrollbars keep rendering for a
   *  light page on a near-black one. */
  isDark: boolean;
  /** We are mid-way between a light stop and the dark one, in the band where
   *  no ink colour clears AA against the ground. Consumers must make this
   *  transition SHORT — see the comment in `sunroomStateAt`. */
  crossing: boolean;
}

/* Held constant across all six stops — see rule 2 in the thesis. Every value
 * is darkened from the shipped sunroom token (globals.css:570-580, whose own
 * comments record how narrowly each one cleared AA) by just enough to survive
 * night's darker panel-2. Verified, not estimated: scripts/sunroom-contrast.mjs
 * prints the worst ratio these produce at every stop and every interpolated
 * midpoint between stops. */
/* Dark ink for the lit half of the day. `ok` and `bad` are the two that bind:
 * at 4.46 on night's old light panel-2 they were the only tokens the gate
 * failed, so both sit past the line rather than on it. */
const LIGHT_FG = {
  ink: "#2c3542",
  inkDim: "#4e5867",
  inkFaint: "#4f5662",
  accent: "#33559f",
  accentDim: "#2f4f96",
  ok: "#19603a",
  // Darkened again from #7a5613 to buy headroom for rain: `warn` is the
  // binding token on every light stop, so whatever margin it has IS the
  // budget for darkening the ground under it.
  warn: "#6b4a0f",
  bad: "#9d3232",
} as const;

/* Light ink for the dark half. Not a mechanical inversion of LIGHT_FG — on a
 * near-black ground the status hues have to lift AND desaturate or they
 * vibrate, and this surface is read from a bed at 2am. */
const DARK_FG = {
  ink: "#e4eaf4",
  inkDim: "#b0bdd0",
  inkFaint: "#8fa0b7",
  accent: "#93b6ff",
  accentDim: "#7ea5f5",
  ok: "#5ecf99",
  warn: "#edbe61",
  bad: "#ff9292",
} as const;

/** The ramp, in order. `t` indexes this array continuously and wraps 5 → 0
 *  through the small hours, so index 5 (dusk) interpolates into index 0
 *  (night) rather than snapping back through the whole day. */
export const SUNROOM_STOPS: readonly {
  name: string;
  palette: SunroomPalette;
  light: SunroomLight;
  /** Marks the stops whose ground is dark enough to need light ink. Exactly
   *  one today (`night`), but declared per-stop rather than hardcoded to
   *  index 0 so the light/dark boundary stays a property of the data — adding
   *  a second dark stop must not require finding every `=== 0` in this file. */
  dark?: boolean;
}[] = [
  {
    name: "night",
    dark: true,
    palette: {
      // A CLEAR night: blue, not black. This is the only stop on the dark
      // side of the ramp — cloud and rain deepen and grey it from here (see
      // `applyWeather`), so this palette is the clear-sky extreme and the
      // "really dark grey overcast night" is the same stop with cloud01 at 1.
      bg: "#0d1425",
      panel: "#141d31",
      panel2: "#0a1020",
      line: "#1f2b45",
      lineBright: "#35466e",
      ...DARK_FG,
    },
    // No sun means no direction: the shadow collapses to a short ambient drop
    // with no horizontal component at all. This is the one stop where the
    // neumorphic pair stops pointing anywhere, and that reads correctly —
    // a room at 2am is lit by the hallway, not by the sky.
    /* Neumorphism inverts on a dark ground, and getting this wrong is the
       classic dark-soft-UI failure: keep the near-white highlight from the
       light stops and every panel reads as OUTLINED in light rather than
       lifted out of the surface. The effect comes from the pair straddling
       the surface's own tone, so on a near-black ground the shadow goes to
       true black and the highlight becomes a small LIFT of the panel colour
       (a dark blue-grey), never white. Same emboss, no glow. */
    light: {
      lightX: 0,
      lightY: 3,
      blur: 10,
      // Black on near-black needs more alpha than grey on pale did, or the
      // shadow half of the pair simply disappears.
      shadowA: 0.7,
      highlightA: 0.55,
      shadowRgb: "0, 1, 4",
      highlightRgb: "44, 60, 94",
      warmth: 0.02,
    },
  },
  {
    name: "dawn",
    palette: {
      bg: "#dcdfe8",
      panel: "#e2e5ed",
      panel2: "#d6dae4",
      line: "#cbd1dd",
      lineBright: "#b4bccc",
      ...LIGHT_FG,
    },
    // Sun barely over the horizon: the longest, softest, most horizontal
    // shadow of the day. Light from the left, faint rose in the highlight.
    light: {
      lightX: 10,
      lightY: 5,
      blur: 20,
      shadowA: 0.42,
      highlightA: 0.62,
      shadowRgb: "150, 150, 178",
      highlightRgb: "255, 246, 240",
      warmth: 0.38,
    },
  },
  {
    name: "morning",
    palette: {
      // The shipped sunroom ground, unchanged. This stop is the continuity
      // anchor for the whole ramp — mid-morning is when the theme looks
      // exactly like the theme it replaces.
      bg: "#e3e7ee",
      panel: "#e9edf3",
      panel2: "#dde2ea",
      line: "#d3d9e3",
      lineBright: "#b9c2d1",
      ...LIGHT_FG,
    },
    // The shipped 7px/7px/14px neumorphic pair and its exact shadow and
    // highlight colours, preserved to the digit.
    light: {
      lightX: 7,
      lightY: 7,
      blur: 14,
      shadowA: 0.55,
      highlightA: 0.85,
      shadowRgb: "163, 177, 198",
      highlightRgb: "255, 255, 255",
      warmth: 0.16,
    },
  },
  {
    name: "midday",
    palette: {
      // Pushed COOLER (bluer), not lighter, after a browser pass found midday
      // and golden nearly indistinguishable at 1x: the two grounds sat about
      // 3 units apart and read as the same colour. The separation has to come
      // from somewhere, and the theme's own rule says afternoon warmth is the
      // removal of coolness — so the fix is to give midday more coolness to
      // remove, never to push golden toward beige. Red-minus-blue now swings
      // about -14 here to +5 at golden, against ~3 before.
      bg: "#e6eaf4",
      panel: "#edf0f8",
      panel2: "#e0e5f0",
      line: "#d5dae7",
      lineBright: "#bcc4d5",
      ...LIGHT_FG,
    },
    // Overhead: no horizontal component, the shortest and tightest shadow of
    // the day, and the whitest light. lightX crossing zero here is what makes
    // the morning→afternoon swing continuous instead of a jump.
    light: {
      lightX: 0,
      lightY: 8,
      blur: 11,
      shadowA: 0.52,
      highlightA: 0.9,
      shadowRgb: "158, 172, 196",
      highlightRgb: "255, 255, 255",
      warmth: 0.05,
    },
  },
  {
    name: "golden",
    palette: {
      // The warmest ground of the day, and note what that means here: it is
      // NEUTRAL, not warm-tinted. The blue cast is gone; no beige arrived.
      bg: "#edeae8",
      panel: "#f2f0ed",
      panel2: "#e7e4e1",
      line: "#dcd8d5",
      lineBright: "#c4c0bc",
      ...LIGHT_FG,
    },
    // Light from the right now — lightX has crossed zero. Warm violet-grey
    // shadow against an amber-white highlight is the whole hour in two
    // colours, and warmth peaks here.
    light: {
      lightX: -8,
      lightY: 6,
      blur: 18,
      shadowA: 0.5,
      highlightA: 0.8,
      shadowRgb: "170, 156, 168",
      highlightRgb: "255, 248, 235",
      warmth: 1,
    },
  },
  {
    name: "dusk",
    palette: {
      bg: "#dedde4",
      panel: "#e4e3ea",
      panel2: "#d8d7de",
      line: "#cdccd5",
      lineBright: "#b6b5c1",
      ...LIGHT_FG,
    },
    // Mirror of dawn on the other side of the sky: long, soft, low, and
    // cooling back toward night.
    light: {
      lightX: -11,
      lightY: 4,
      blur: 22,
      shadowA: 0.38,
      highlightA: 0.55,
      shadowRgb: "146, 140, 170",
      highlightRgb: "250, 240, 244",
      warmth: 0.5,
    },
  },
];

const STOP_COUNT = SUNROOM_STOPS.length;

/** Civil twilight, matching `buildSun`'s own phase cut in src/lib/weather.ts —
 *  the ramp and the weather module have to agree on where night ends, or the
 *  theme and KioskSky disagree about the same sky on the same screen. Used as
 *  the half-width of the band over which elevation's vote fades in; see
 *  `sunroomT`. */
const TWILIGHT_DEG = 6;

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Wraps any real number into [0, STOP_COUNT). */
function wrapT(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return ((t % STOP_COUNT) + STOP_COUNT) % STOP_COUNT;
}

/**
 * Maps real solar position onto the continuous ramp position `t`.
 *
 * Driven by `hourAngleDeg` alone — `elevationDeg` is accepted (and used
 * elsewhere, see `defaultElev01`/`sunroomStateAt`) but deliberately not
 * consulted here. That looks backwards given the stop table in the contract
 * doc is written in elevation terms, so the reasoning is worth spelling out:
 *
 * An earlier version of this function used elevation thresholds throughout,
 * including for the "morning → midday → golden" stretch (elevation > 6°),
 * built as two independent formulas — one for the rising half, one for the
 * falling half — each normalised against a fixed reference ceiling standing
 * in for "how high the sun gets today". Those two formulas only agree at
 * t = 3 exactly when the day's ACTUAL peak elevation reaches that ceiling.
 * Every day whose peak falls short of it — which in this house's climate
 * means most of the cooler half of the year — produced a real, visible jump
 * in palette and light direction at exactly solar noon: elevation is
 * genuinely at its daily maximum there, so the rising formula's limit and
 * the falling formula's limit are evaluated at the same instant but from two
 * different curves, and nothing forces them to meet. The same failure mode
 * recurs, mirrored, at solar midnight (hourAngle wrapping ±180°, where
 * elevation is at its daily MINIMUM and the night formula has the identical
 * two-independent-branches shape) — so patching only the noon case is not
 * enough. Both are guaranteed to occur every single day, unlike an elevation
 * threshold crossing (whose exact time of day drifts with the seasons and
 * carries no such correctness obligation).
 *
 * `hourAngleDeg` doesn't have this failure mode: it is defined to advance
 * uniformly through the whole 24 h cycle and is exactly symmetric around
 * both solar noon (0°) and solar midnight (±180°) on every day, regardless
 * of latitude or season. A single formula built from it alone is therefore
 * continuous through both extrema BY CONSTRUCTION, not by coincidence.
 */
export function sunroomT(input: { elevationDeg: number; hourAngleDeg: number }): number {
  const hourAngle = Number.isFinite(input.hourAngleDeg) ? input.hourAngleDeg : 0;
  const elev = Number.isFinite(input.elevationDeg) ? input.elevationDeg : -90;
  const rad = (hourAngle * Math.PI) / 180;
  // p: 0 at solar noon, 1 at solar midnight — the same "slow near both
  // extremes, fast through twilight" shape elevation itself traces across a
  // day, without this pure function needing latitude or date to derive it.
  const p = (1 - Math.cos(rad)) / 2;
  const tHour = hourAngle < 0 ? 3 * (1 - p) : 3 + 3 * p;

  /* Hour angle alone knows WHEN we are relative to noon, but nothing about
     whether the sun is actually up — and how much daylight a given hour angle
     buys swings hard with the season. Measured: at elevation -25° with an hour
     angle of -100° (a mid-winter 5:20am, fully dark) the pure hour-angle
     formula lands on t≈1.24 and paints a dawn room, direction and all.
     Elevation has to have a vote.

     `dark` is that vote, and it is a smoothstep rather than a threshold on
     purpose: elevation is continuous in time, so a smoothstep of it is too,
     which keeps the property that made the hour-angle backbone worth having.
     It runs 0 at civil twilight's light edge (+6°) to 1 at its dark edge
     (-6°), and pulls t toward the night stop — toward 0 on the rising side,
     toward 6 (≡ 0) on the falling side, so both approach the same place from
     the correct direction and the 5→0 seam stays closed.

     Continuity at solar noon survives because `dark` is 0 there for any day
     the sun clears +6°, which is every day at this house's latitude. (Inside a
     polar winter the two branches would part at noon; that is a real limit of
     this function and not one worth carrying code for here.) */
  const u = clamp01((TWILIGHT_DEG - elev) / (TWILIGHT_DEG * 2));
  const dark = u * u * (3 - 2 * u);
  const t = hourAngle < 0 ? tHour * (1 - dark) : tHour * (1 - dark) + STOP_COUNT * dark;
  return wrapT(t);
}

/** Elevation-shaped fallback for `elev01` when `sunroomStateAt` isn't given
 *  one explicitly: 1 at midday (t=3), 0 at night (t=0), symmetric either
 *  side, wrapping cleanly through the 5→0 seam. Triangular rather than
 *  `sunroomT`'s cosine — this only has to be a monotonic, continuous
 *  fine-tune on top of an already-interpolated light block, not a physically
 *  exact reconstruction. */
function defaultElev01(t: number): number {
  const pos = wrapT(t);
  const distFromMidday = Math.min(Math.abs(pos - 3), STOP_COUNT - Math.abs(pos - 3));
  return 1 - distFromMidday / 3;
}

/**
 * Whether sunroom is currently on the dark side of its ramp.
 *
 * Exists so consumers that branch on "is this theme's ground light or dark"
 * have one answer to ask rather than restating the rule. `KIOSK_LIGHT_THEMES`
 * in kiosk-theme.tsx is a STATIC set and sunroom is the first theme for which
 * that question has a time-dependent answer — anything reading that set for
 * sunroom (KioskSky's ambient-opacity cap, for one) has to come through here
 * instead, or it will treat a near-black midnight ground as a pale one.
 */
export function sunroomIsDark(sun: { elevationDeg: number; hourAngleDeg: number }): boolean {
  return sunroomStateAt(sunroomT(sun)).isDark;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpHex(a: string, b: string, k: number): string {
  if (a === b) return a;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(lerp(ar, br, k), lerp(ag, bg, k), lerp(ab, bb, k));
}

function lerpTriple(a: string, b: string, k: number): string {
  const pa = a.split(",").map((n) => Number(n.trim()));
  const pb = b.split(",").map((n) => Number(n.trim()));
  return pa.map((n, i) => Math.round(lerp(n, pb[i] ?? n, k))).join(", ");
}

/** Mixes one hex toward its own perceptual grey by `k` — removes hue while
 *  holding lightness, which is what an overcast sky actually does to a room:
 *  the colour goes out of the light, the light doesn't go out. */
function greyHex(hex: string, k: number): string {
  if (k <= 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgbToHex(lerp(r, grey, k), lerp(g, grey, k), lerp(b, grey, k));
}

/** Scales a hex toward black by `k`. Multiplicative, not a mix toward a fixed
 *  dark: heavy rain should deepen a blue night into a blue-black, never slide
 *  every ground toward the same charcoal. */
function darkenHex(hex: string, k: number): string {
  if (k <= 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - k;
  return rgbToHex(r * f, g * f, b * f);
}

/**
 * Weather's effect on the ground, applied after the solar interpolation.
 *
 * `cloud01` greys — overcast strips the hue and leaves the lightness, so a
 * clear blue night becomes the "really dark grey" one without needing a
 * separate palette to blend toward. `rain01` darkens on top, multiplicatively,
 * so heavier rain keeps deepening whatever colour the sky already is.
 *
 * THE SURFACES MOVE AND THE INK DOES NOT. That asymmetry is the whole reason
 * this is safe: every foreground token is already tuned against its side's
 * darkest surface, and darkening a light ground eats that margin directly.
 * Hence the caps below, which are not round numbers — they are the largest
 * values that still clear 4.5:1 everywhere when the gate sweeps the full
 * t x cloud x rain cube. On the dark side the cap is far higher, because
 * there darkening the ground INCREASES contrast against light ink.
 */
function applyWeather(p: SunroomPalette, cloud01: number, rain01: number, isDark: boolean): SunroomPalette {
  const grey = cloud01 * (isDark ? 0.85 : 0.5);
  /* The asymmetry here is severe and it is the honest answer, not a fudge.
     On the DARK side, rain deepening the ground pushes it away from light ink
     and contrast IMPROVES, so it can go far — 45%, enough that a downpour at
     2am is unmistakably blacker than a clear night. On the LIGHT side the
     same move eats the margin under every token at once, and the gate proved
     it: at 10% the `warn` pair fell to 3.78:1. So daytime rain barely touches
     the palette, and the fact that it is raining is carried by the
     atmosphere instead — heavier, greyer, more diffuse light — which costs no
     contrast because it is not what the text sits on. Weather lives in the
     light, the same way the hour does. */
  const dark = rain01 * (isDark ? 0.45 : 0.035);
  const move = (hex: string) => darkenHex(greyHex(hex, grey), dark);
  return {
    ...p,
    bg: move(p.bg),
    panel: move(p.panel),
    panel2: move(p.panel2),
    line: move(p.line),
    lineBright: move(p.lineBright),
  };
}

/** Mixes an "r, g, b" triple toward its own perceptual grey by `k`. The
 *  desaturation half of cloud muting; opacity carries the dimming half.
 *  Same technique as KioskSky's `desaturate`, deliberately — one overcast
 *  sky should not produce two different greys on the same screen. */
function desaturateTriple(rgb: string, k: number): string {
  const [r, g, b] = rgb.split(",").map((n) => Number(n.trim()));
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => Math.round(c + (grey - c) * k);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

/**
 * The fully interpolated state at ramp position `t`.
 *
 * `cloud01` models overcast as what it physically is — DIFFUSE light. An
 * overcast sky does not simply dim the sun, it removes its direction: the
 * horizontal offset collapses toward zero, the shadow spreads and softens,
 * and both shadow and highlight desaturate toward grey. The one thing it must
 * never do is flatten the pair to nothing, because a panel that casts no
 * shadow at all stops reading as a panel — so the alpha floor is 40% of the
 * clear-sky value, not 0.
 *
 * `elev01` is an optional fine-tune for shadow geometry when the caller has a
 * live elevation reading; the stops already encode the coarse shape, so this
 * only nudges. Omitting it is fine and is the common case.
 */
export function sunroomStateAt(
  t: number,
  opts?: { cloud01?: number; elev01?: number; rain01?: number },
): SunroomState {
  const pos = wrapT(t);
  const i = Math.floor(pos);
  const k = pos - i;
  const a = SUNROOM_STOPS[i];
  const b = SUNROOM_STOPS[(i + 1) % STOP_COUNT];

  /* THE FOREGROUND SNAPS, IT DOES NOT INTERPOLATE — and this is the single
     most important line in the file now that night is dark.

     Between a light ground and a dark one there is a band of ground luminance
     (roughly 0.18 to 0.33) where NEITHER dark ink nor light ink reaches
     4.5:1. That is arithmetic, not a tuning failure: dark ink needs the
     ground above ~0.33 and light ink needs it below ~0.18, and nothing lives
     in between. Interpolating the ink across that band would produce mid-grey
     text on a mid-grey ground — the worst possible reading — so instead the
     ink jumps at the halfway point and only the GROUND crosses continuously.
     The crossing itself is made short by the caller (see `crossing` below);
     `scripts/sunroom-contrast.mjs` gates both ends of it and deliberately
     exempts the transit rather than pretending it passes. */
  const nearer = k < 0.5 ? a : b;
  const isDark = nearer.dark === true;
  /* True while one side of this blend is the dark stop and the other isn't —
     i.e. we are physically inside the illegible band. The component reads
     this and drops the transition from 90s to a few hundred ms, so the band
     is crossed faster than anyone can start reading a word in it. */
  const crossing = a.dark !== b.dark;

  const palette: SunroomPalette = {
    bg: lerpHex(a.palette.bg, b.palette.bg, k),
    panel: lerpHex(a.palette.panel, b.palette.panel, k),
    panel2: lerpHex(a.palette.panel2, b.palette.panel2, k),
    line: lerpHex(a.palette.line, b.palette.line, k),
    lineBright: lerpHex(a.palette.lineBright, b.palette.lineBright, k),
    ink: nearer.palette.ink,
    inkDim: nearer.palette.inkDim,
    inkFaint: nearer.palette.inkFaint,
    accent: nearer.palette.accent,
    accentDim: nearer.palette.accentDim,
    ok: nearer.palette.ok,
    warn: nearer.palette.warn,
    bad: nearer.palette.bad,
  };

  const cloud = clamp01(opts?.cloud01 ?? 0);
  // Elevation nudge, centred on 1: a low sun lengthens and softens, a high sun
  // shortens and tightens, by at most 15% either way. Defaults to the shape
  // `t` itself already implies (see `defaultElev01`) rather than a flat
  // no-op, per the contract's "elev01 (default derived from t)".
  const elev01 = opts?.elev01 == null ? defaultElev01(pos) : clamp01(opts.elev01);
  const elevNudge = 1 + (0.5 - elev01) * 0.3;

  const light: SunroomLight = {
    // Direction is the first casualty of cloud: at full overcast the light is
    // coming from the whole sky, so it comes from nowhere in particular.
    lightX: lerp(a.light.lightX, b.light.lightX, k) * (1 - cloud * 0.75),
    lightY: lerp(a.light.lightY, b.light.lightY, k) * elevNudge,
    blur: lerp(a.light.blur, b.light.blur, k) * elevNudge * (1 + cloud * 0.35),
    shadowA: lerp(a.light.shadowA, b.light.shadowA, k) * (1 - cloud * 0.6),
    highlightA: lerp(a.light.highlightA, b.light.highlightA, k) * (1 - cloud * 0.45),
    shadowRgb: desaturateTriple(lerpTriple(a.light.shadowRgb, b.light.shadowRgb, k), cloud * 0.7),
    highlightRgb: desaturateTriple(lerpTriple(a.light.highlightRgb, b.light.highlightRgb, k), cloud * 0.7),
    warmth: lerp(a.light.warmth, b.light.warmth, k) * (1 - cloud * 0.55),
  };

  return {
    palette: applyWeather(palette, cloud, clamp01(opts?.rain01 ?? 0), isDark),
    light,
    t: pos,
    isDark,
    crossing,
  };
}
