"use client";

/* THESIS: the bridge between real solar position and the sunroom theme's CSS.
   The ramp itself (src/lib/sunroom-light.ts) is pure data and pure maths; this
   file is the only thing that knows about time, the network, or the DOM.

   It renders NOTHING visible. Its entire output is one <style> element
   carrying the `--sr-*` custom properties, which the sunroom block in
   globals.css reads. That indirection is deliberate: it means the theme has a
   complete, correct static definition (the @property initial values) that
   stands on its own when this component is absent, when the weather feed is
   down, or before hydration — and this component only ever *improves* on it.
   There is no state in which sunroom is broken because the sun is unknown.

   THE 60-SECOND TICK is the reason this is a component and not a one-shot
   read. The weather feed refreshes every 15 minutes, and a light source that
   jumped a quarter-hour at a time would read as a glitch rather than as the
   day passing — the eye is far better at catching a discrete jump than a
   continuous drift. But the sun's hour angle is not something we need the
   network for: it advances an exact 0.25°/min, always, everywhere. So the
   fetched reading becomes an ANCHOR, and between fetches we extrapolate from
   it locally. Each 60s step is then a fraction of a degree, and the CSS
   transition over it makes the travel genuinely continuous. Elevation is not
   extrapolated — deriving it needs latitude and declination that this client
   doesn't have — so it rides the fetch cadence and only drives the coarse
   softness of the shadow, where a 15-minute step is invisible anyway.

   SCOPE: returns null on every theme but sunroom, which is contract gate 3.
   The `:root ` prefix on the emitted selector is not cosmetic — see the
   comment at STYLE_SELECTOR. The transition list is emitted here rather than
   declared statically in globals.css, and deliberately withheld for one
   frame — see the comment at TRANSITION below for why. */

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client";
import { useKioskTheme } from "@/components/kiosk-theme";
import { sunroomStateAt, sunroomT } from "@/lib/sunroom-light";

/** Matches KioskSky's cadence so SWR dedupes the two subscriptions into one
 *  request — both components read the same key and neither pays for the other. */
const WEATHER_REFRESH_MS = 15 * 60_000;

/** How often the light direction is recomputed from the anchor. Small enough
 *  that each step is sub-degree and the CSS transition can swallow it whole. */
const TICK_MS = 60_000;

/** The sun's hour angle advances 360° per 24h. Exact, not an approximation —
 *  it is the definition of the hour angle, which is why it can be extrapolated
 *  locally with no error accumulation beyond the anchor's own. */
const DEG_PER_MINUTE = 360 / (24 * 60);

/* Specificity (0,2,0), which outranks globals.css's own
   `[data-kiosk-theme="sunroom"]` block at (0,1,0) no matter what order the
   stylesheets end up in. Relying on DOM order instead would work today and
   break silently the first time Next hoists or inlines a stylesheet
   differently — a cascade race is not something you want to debug through a
   production build's CSS ordering. */
const STYLE_SELECTOR = ":root [data-kiosk-theme=\"sunroom\"]";

/* Two cadences, because two things move at two speeds. The light DIRECTION is
   recomputed every 60s from the extrapolated hour angle, so a 60s tween hands
   each step straight into the next and the travel never visibly stops. The
   palette and the shadow's weight ride the 15-minute fetch cadence instead and
   get the longer crossfade — the same 90s KioskSky uses against the same data.

   THIS IS WITHHELD ON THE FIRST UPDATE. If it were declared in the stylesheet
   it would also apply to the first substitution of real solar values for the
   @property initial values, and every load would spend 90 seconds crossfading
   out of the morning defaults — a tablet booted at midnight would show a
   mid-morning room and slowly darken. Emitting it from the second update
   onward means the truth lands immediately and only the sun's own movement is
   ever animated. */
const TRANSITION = `
  transition:
    --sr-light-x 60s linear,
    --sr-light-y 60s linear,
    --sr-bg 90s linear,
    --sr-panel 90s linear,
    --sr-panel-2 90s linear,
    --sr-line 90s linear,
    --sr-line-bright 90s linear,
    --sr-ink 90s linear,
    --sr-ink-dim 90s linear,
    --sr-ink-faint 90s linear,
    --sr-accent 90s linear,
    --sr-accent-dim 90s linear,
    --sr-ok 90s linear,
    --sr-warn 90s linear,
    --sr-bad 90s linear,
    --sr-blur 90s linear,
    --sr-shadow-a 90s linear,
    --sr-highlight-a 90s linear,
    --sr-warmth 90s linear;`;

type SunPhase = "night" | "dawn" | "day" | "dusk";

interface SunroomWeatherOk {
  status: "ok";
  current?: { cloudCoverPct?: number };
  sun?: {
    elevationDeg: number;
    phase: SunPhase;
    progress01: number;
    /** Optional at runtime even though the server always sends it now: a
     *  response cached from before that field existed would arrive without
     *  it, and the theme must not break on a stale cache. */
    hourAngleDeg?: number;
  };
}

type SunroomWeatherResponse = SunroomWeatherOk | { status: "unconfigured" | "unreachable"; detail?: string };

/** Falls back to reconstructing the hour angle from `progress01` when the feed
 *  predates `hourAngleDeg`. Daylight spans roughly ±90° of hour angle, so
 *  mapping 0..1 onto -90..+90 recovers the one thing the light model actually
 *  needs from it: which side of noon we are on, and roughly how far. */
function anchorHourAngle(sun: NonNullable<SunroomWeatherOk["sun"]>): number {
  if (typeof sun.hourAngleDeg === "number" && Number.isFinite(sun.hourAngleDeg)) return sun.hourAngleDeg;
  const p = Math.min(1, Math.max(0, sun.progress01));
  return (p - 0.5) * 180;
}

export function KioskSunroomLight() {
  const theme = useKioskTheme();
  const { data } = useSWR<SunroomWeatherResponse>("/kiosk/api/weather", fetcher, {
    refreshInterval: WEATHER_REFRESH_MS,
    keepPreviousData: true,
  });

  const ok = data && data.status === "ok" ? data : null;
  const sun = ok?.sun ?? null;
  const cloudCoverPct = ok?.current?.cloudCoverPct;

  /* Minutes since the anchor landed. Kept as state (not a ref) because the
     rendered output has to change when it advances; kept as a COUNT of ticks
     rather than a timestamp so it stays SSR-stable and never reads the clock
     during render. */
  const [tick, setTick] = useState(0);
  const anchorAtRef = useRef<number | null>(null);
  const anchorKey = sun ? `${sun.elevationDeg}:${sun.progress01}:${sun.hourAngleDeg ?? "na"}` : null;

  useEffect(() => {
    if (!anchorKey) return;
    // A fresh reading resets both the anchor time and the extrapolation, so
    // drift never accumulates across fetches — each 15-minute window
    // extrapolates from its own ground truth, not from the previous estimate.
    anchorAtRef.current = Date.now();
    setTick(0);
  }, [anchorKey]);

  useEffect(() => {
    if (!anchorKey) return;
    const id = setInterval(() => {
      const startedAt = anchorAtRef.current;
      if (startedAt == null) return;
      setTick(Math.max(0, (Date.now() - startedAt) / 60_000));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [anchorKey]);

  /* Flipped one frame after the first real emission, which is what lets the
     first application land instantly and every later one tween. A ref plus a
     state flag rather than a plain "have we rendered" check, because the very
     first emission may itself be several renders in (SWR resolving, theme
     resolving) and only the render that actually writes values counts. */
  const [tweening, setTweening] = useState(false);
  const emittedRef = useRef(false);

  const css = useMemo(() => {
    if (!sun) return null;
    const hourAngle = anchorHourAngle(sun) + tick * DEG_PER_MINUTE;
    const t = sunroomT({ elevationDeg: sun.elevationDeg, hourAngleDeg: hourAngle });
    const cloud01 = typeof cloudCoverPct === "number" ? cloudCoverPct / 100 : 0;
    const { palette, light } = sunroomStateAt(t, { cloud01 });

    // Rounded on the way out: sub-pixel and sub-percent precision here buys
    // nothing visually and would churn the emitted string on every tick,
    // invalidating the style element for no reason.
    const px = (n: number) => `${Math.round(n * 10) / 10}px`;
    const num = (n: number) => `${Math.round(n * 1000) / 1000}`;

    return `${STYLE_SELECTOR} {${tweening ? TRANSITION : ""}
  --sr-bg: ${palette.bg};
  --sr-panel: ${palette.panel};
  --sr-panel-2: ${palette.panel2};
  --sr-line: ${palette.line};
  --sr-line-bright: ${palette.lineBright};
  --sr-ink: ${palette.ink};
  --sr-ink-dim: ${palette.inkDim};
  --sr-ink-faint: ${palette.inkFaint};
  --sr-accent: ${palette.accent};
  --sr-accent-dim: ${palette.accentDim};
  --sr-ok: ${palette.ok};
  --sr-warn: ${palette.warn};
  --sr-bad: ${palette.bad};
  --sr-light-x: ${px(light.lightX)};
  --sr-light-y: ${px(light.lightY)};
  --sr-blur: ${px(light.blur)};
  --sr-shadow-a: ${num(light.shadowA)};
  --sr-highlight-a: ${num(light.highlightA)};
  --sr-shadow-rgb: ${light.shadowRgb};
  --sr-highlight-rgb: ${light.highlightRgb};
  --sr-warmth: ${num(light.warmth)};
}`;
  }, [sun, cloudCoverPct, tick, tweening]);

  useEffect(() => {
    if (!css || emittedRef.current) return;
    emittedRef.current = true;
    // One frame's gap is the whole mechanism: the browser must commit the
    // untransitioned values as the element's current state before the
    // transition declaration exists, or it will animate from the initial
    // values anyway and nothing has been gained.
    const id = requestAnimationFrame(() => setTweening(true));
    return () => cancelAnimationFrame(id);
  }, [css]);

  // Off-theme, or no sun to report: emit nothing at all. The @property initial
  // values in globals.css are a complete definition of the theme on their own,
  // so "nothing" here means "the sunroom that shipped before this feature",
  // not a half-styled surface.
  if (theme !== "sunroom" || !css) return null;

  return <style>{css}</style>;
}
