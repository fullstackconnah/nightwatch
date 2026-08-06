"use client";

/* THESIS: weather touching the one material that can actually show it — the
   frosted glass of Aerogel and Aurora. Every other theme's panel is opaque
   (see the comment at globals.css ~1438-1444: backdrop-filter with nothing
   translucent behind it to sample resolves to a no-op), so this component
   has nothing to say to them and never checks which theme is active — the
   `[data-kiosk-theme]` selectors in the emitted CSS do that scoping on their
   own. If a future theme grows a translucent panel, it opts in by reading
   these same vars in its own block; nothing here has to change.

   It renders NOTHING visible, the same discipline as KioskSunroomLight
   (kiosk-sunroom.tsx): its entire output is one <style> element carrying
   three custom properties. They are MULTIPLIERS, not absolute values,
   because Aerogel and Aurora each already own their baseline blur and edge
   alphas in globals.css, and this component's job is to modulate those, not
   replace them with a foreign literal — Aerogel's `blur(14px)` becomes
   `blur(calc(14px * var(--glass-blur-x, 1)))`, which keeps Aerogel's own
   number the authority on Aerogel's glass and lets weather only nudge it.
   The same three multipliers apply to both themes for the same reason:
   there is only one sky over this tablet, and each theme reads its own
   proportional share of it.

   RAIN AND FOG READ AS WETNESS (wet01): they deepen the blur and damp the
   specular edge — a rain-slicked window loses its crisp reflection long
   before it loses its transparency. A HIGH SUN IN A CLEAR SKY READS AS
   CLARITY (clarity01): it sharpens the edge/specular highlight, the way
   real glass throws a harder line under direct light. Blur answers only to
   wet01, never clarity — there is nothing sharper than clean glass already
   is, so a bright dry noon has nothing to push blur below its own
   baseline. */

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client";

/** Same key, same interval, same `fetcher` as KioskSunroomLight
 *  (kiosk-sunroom.tsx) and its sibling consumers — this is the fifth
 *  subscriber to `/kiosk/api/weather` at this exact cadence, and SWR dedupes
 *  all of them into one request per interval. Keep this identical to the
 *  others or it fetches separately. */
const WEATHER_REFRESH_MS = 15 * 60_000;

/** Mirrors kiosk-sunroom-weather.tsx's rain scale exactly: 4mm/hr is the top
 *  of the ramp (solidly heavy in temperate rain), and anything below the
 *  floor is treated as dry rather than a barely-visible drizzle. */
const RAIN_FULL_MM_HR = 4;
const RAIN_FLOOR_MM_HR = 0.05;

/** Blur only ever grows with wetness, capped at 1.7x baseline. Aerogel's
 *  14px baseline tops out at ~24px — not the 32px a naive "double it" pass
 *  would land on: backdrop-filter is the most expensive paint this tablet
 *  does, and 24px reads identical to 32px at arm's length. The same 1.7x
 *  against Aurora's 10px baseline lands its own ceiling at ~17px. */
const BLUR_X_WET_MAX = 1.7;

/** Edge/specular multipliers share one shape: damped by wetness down to
 *  0.6x, sharpened by clarity up to 1.1x. The 1.1 ceiling is deliberate —
 *  Aerogel's border alpha baseline is 0.9, and 0.9 * 1.1 = 0.99, so even the
 *  brightest noon never pushes a composed alpha channel past 1. */
const EDGE_X_MIN = 0.6;
const EDGE_X_MAX = 1.1;
const EDGE_X_WET_PULL = 0.4;
const EDGE_X_CLARITY_PUSH = 0.1;

/* 2s ease: slow enough to read as ambient rather than reactive, the same
   class of tween as KioskSunroomLight's palette crossfade — just faster,
   because a blur/alpha nudge is a far smaller visual delta than a full
   palette swap. No prefers-reduced-motion special-case here, deliberately:
   this sits in the same "slow ambient tween" bucket KioskSunroomLight's own
   TRANSITION comment argues doesn't need one, and it drives different
   properties on different, always-on themes than sunroom's own
   `transition: none !important` override, so that rule has nothing to say
   about it either way. */
const TRANSITION_MS = 2000;
const TRANSITION = `
  transition:
    --glass-blur-x ${TRANSITION_MS}ms ease,
    --glass-edge-x ${TRANSITION_MS}ms ease,
    --glass-spec-x ${TRANSITION_MS}ms ease;`;

/* Specificity (0,2,0), same reasoning as kiosk-sunroom.tsx's STYLE_SELECTOR:
   it has to outrank each theme block's own (0,1,0) selector in globals.css
   regardless of stylesheet order. */
function styleSelector(theme: "aerogel" | "aurora"): string {
  return `:root [data-kiosk-theme="${theme}"]`;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function rainIntensity01(mmPerHour: number): number {
  return mmPerHour >= RAIN_FLOOR_MM_HR ? clamp01(mmPerHour / RAIN_FULL_MM_HR) : 0;
}

/** The damped-then-sharpened shape shared by --glass-edge-x and
 *  --glass-spec-x — one function computes both rather than two
 *  near-identical copies drifting apart over time. */
function edgeLikeX(wet01: number, clarity01: number): number {
  const raw = 1 - EDGE_X_WET_PULL * wet01 + EDGE_X_CLARITY_PUSH * clarity01;
  return Math.min(EDGE_X_MAX, Math.max(EDGE_X_MIN, raw));
}

interface GlassWeatherOk {
  status: "ok";
  current?: { cloudCoverPct?: number; precipMm?: number; code?: string };
  rain?: { nowcast?: Array<{ minutesFromNow: number; precipMmHr: number }> };
  sun?: { elevationDeg: number };
}

type GlassWeatherResponse = GlassWeatherOk | { status: "unconfigured" | "unreachable"; detail?: string };

export function KioskGlassWeather() {
  const { data } = useSWR<GlassWeatherResponse>("/kiosk/api/weather", fetcher, {
    refreshInterval: WEATHER_REFRESH_MS,
    keepPreviousData: true,
  });

  const ok = data && data.status === "ok" ? data : null;
  const cloudCoverPct = ok?.current?.cloudCoverPct;
  const nowcastMmHr = ok?.rain?.nowcast?.[0]?.precipMmHr;
  const currentPrecipMm = ok?.current?.precipMm;
  const fog = ok?.current?.code === "fog";
  const elevationDeg = ok?.sun?.elevationDeg;
  const hasWeather = ok != null;

  /* Same withhold-then-tween idiom as KioskSunroomLight: the first real
     emission has to land instantly (a tablet booting into a rainstorm
     shouldn't spend 2s crossfading out of the @property initial values as
     if the sky just cleared), and only later changes tween. */
  const [tweening, setTweening] = useState(false);
  const emittedRef = useRef(false);

  const css = useMemo(() => {
    if (!hasWeather) return null;

    const cloud01 = typeof cloudCoverPct === "number" ? clamp01(cloudCoverPct / 100) : 0;
    // Prefer the nowcast's first bucket over `current.precipMm`, same reason
    // KioskSunroomLight does: it's what's falling in the next quarter hour,
    // not what has already accumulated, and the glass should react while
    // it's wet, not after.
    const rain01 = rainIntensity01(nowcastMmHr ?? currentPrecipMm ?? 0);
    // Mild cloud contribution: only above 60% cover, and capped at its own
    // 0.4 ceiling — overcast alone should never read as fully wet the way
    // rain or fog does, just noticeably dulled.
    const cloudWet01 = clamp01((cloud01 - 0.6) / 0.4) * 0.4;
    const wet01 = Math.max(rain01, fog ? 0.85 : 0, cloudWet01);

    const elevSharp01 = typeof elevationDeg === "number" ? smoothstep(0, 40, elevationDeg) : 0;
    const clarity01 = clamp01(1 - cloud01) * elevSharp01;

    // Rounded on the way out for the same reason KioskSunroomLight's px()/num()
    // are: sub-percent precision buys nothing visually and would churn the
    // emitted string, invalidating the style element, on every fetch.
    const num = (n: number) => `${Math.round(n * 1000) / 1000}`;
    const blurX = num(1 + (BLUR_X_WET_MAX - 1) * wet01);
    const edgeX = num(edgeLikeX(wet01, clarity01));
    const specX = num(edgeLikeX(wet01, clarity01));

    const transition = tweening ? TRANSITION : "";
    const vars = `{${transition}
  --glass-blur-x: ${blurX};
  --glass-edge-x: ${edgeX};
  --glass-spec-x: ${specX};
}`;

    return `${styleSelector("aerogel")} ${vars}\n${styleSelector("aurora")} ${vars}`;
  }, [hasWeather, cloudCoverPct, nowcastMmHr, currentPrecipMm, fog, elevationDeg, tweening]);

  useEffect(() => {
    if (!css || emittedRef.current) return;
    emittedRef.current = true;
    // Same one-frame gap as KioskSunroomLight: the browser has to commit the
    // untransitioned first values before the transition declaration exists,
    // or it animates from the @property initial values instead of landing
    // the true reading immediately.
    const id = requestAnimationFrame(() => setTweening(true));
    return () => cancelAnimationFrame(id);
  }, [css]);

  // No weather to react to: emit nothing. The @property initial values (1
  // for all three multipliers, in globals.css) are a complete, correct
  // definition of both themes' glass on their own — "nothing" here means
  // "the Aerogel/Aurora that shipped before this feature," never a
  // half-applied one.
  if (!css) return null;

  return <style>{css}</style>;
}
