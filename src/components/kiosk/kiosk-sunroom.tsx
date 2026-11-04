"use client";

/* THESIS: the bridge between real solar position and the sunroom theme's CSS.
   The ramp itself (src/lib/sunroom-light.ts) is pure data and pure maths; this
   file is the only thing that knows about time, the network, or the DOM.

   It renders NOTHING visible. Its entire output is one <style> element
   carrying the `--sr-*` custom properties (colours, light model, the six
   shadows and the press vector) that src/app/kiosk/sunroom/*.css read. The
   generated tokens.css holds the morning stop as the static fallback, so the
   theme is complete before hydration, when the weather feed is down, or when
   this component is absent; this component only ever improves on it.

   THE 60-SECOND TICK: the weather feed refreshes every 15 minutes, but the
   sun's hour angle advances an exact 0.25 deg per minute, so the fetched
   reading becomes an ANCHOR and each tick extrapolates from it. Elevation is
   not extrapolated (it needs latitude and declination this client lacks).

   NOTHING TWEENS. Colours and shadows are never animated (Sunroom rule 8):
   each tick lands its values at once; a step is a few tenths of a pixel and
   a sub-percent colour change, which the eye cannot catch. The one exception
   is the dark crossing: when the ink snaps between the light and dark halves
   of the ramp, the old look is cloned onto a layer above the page and only
   that layer's OPACITY fades (SR bundle.js setStop). The clone is aria-hidden,
   inert, out of the focus order and removed when the fade ends.

   SCOPE: returns null on every theme but sunroom. The `:root ` prefix on the
   emitted selector is not cosmetic: it lifts specificity to (0,2,0) so these
   values outrank the static tokens.css block at (0,1,0) whatever order the
   stylesheets end up in. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useKioskWeather, type KioskWeatherOk } from "@/lib/kiosk-client";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { shouldStopFade, sunroomCssVars, sunroomLightVector, sunroomStateAt, sunroomT } from "@/lib/sunroom-light";

/** How often the light direction is recomputed from the anchor. */
const TICK_MS = 60_000;

/** The sun's hour angle advances 360 deg per 24h; exact, so it extrapolates with no accumulating error. */
const DEG_PER_MINUTE = 360 / (24 * 60);

const STYLE_SELECTOR = ":root [data-kiosk-theme=\"sunroom\"]";

/** The cross-fade clone's class (surface.css owns its look) and the hard removal timeout (fade is 3s). */
const FADE_CLASS = "sr-stopfade";
const FADE_REMOVE_MS = 3400;

/** Rain intensity, 0..1. 4 mm/hr is the top of the scale and clamps. */
function rainIntensity01(mmPerHour: number | undefined): number {
  if (typeof mmPerHour !== "number" || !Number.isFinite(mmPerHour)) return 0;
  return Math.min(1, Math.max(0, mmPerHour / 4));
}

/** Falls back to reconstructing the hour angle from `progress01` when the feed
 *  predates `hourAngleDeg`: daylight spans roughly +-90 deg of hour angle. */
function anchorHourAngle(sun: NonNullable<KioskWeatherOk["sun"]>): number {
  if (typeof sun.hourAngleDeg === "number" && Number.isFinite(sun.hourAngleDeg)) return sun.hourAngleDeg;
  const p = Math.min(1, Math.max(0, sun.progress01));
  return (p - 0.5) * 180;
}

/** Clones the themed scope onto a fixed layer carrying the OLD stop's variables inline, then fades its opacity. */
function fadeFromOldStop(oldVars: Record<string, string>, oldDark: boolean) {
  const scope = document.querySelector<HTMLElement>("[data-kiosk-theme=\"sunroom\"]");
  if (!scope) return;
  document.querySelectorAll(`.${FADE_CLASS}`).forEach((n) => n.remove()); // a change mid-fade drops the older snapshot
  const layer = document.createElement("div");
  layer.className = FADE_CLASS;
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  const copy = scope.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  copy.querySelectorAll(`.${FADE_CLASS}, style`).forEach((n) => n.remove());
  copy.querySelectorAll("[tabindex], a, button, input, select, textarea").forEach((n) => n.setAttribute("tabindex", "-1"));
  for (const [k, v] of Object.entries(oldVars)) copy.style.setProperty(k, v);
  copy.style.colorScheme = oldDark ? "dark" : "light";
  copy.style.cssText += `;position:absolute;left:0;right:0;top:${-window.scrollY}px`;
  layer.appendChild(copy);
  scope.appendChild(layer); // inside the scope so surface.css (scoped, N10) styles it and --sr-m-* resolve
  void layer.offsetWidth; // commit the opaque frame before the fade starts
  layer.setAttribute("data-out", "");
  const done = () => layer.remove();
  layer.addEventListener("transitionend", (e) => { if (e.target === layer) done(); });
  setTimeout(done, FADE_REMOVE_MS);
}

export function KioskSunroomLight() {
  const theme = useKioskTheme();
  const { data, isLoading } = useKioskWeather();

  const ok = data && data.status === "ok" ? data : null;
  const sun = ok?.sun ?? null;
  const cloudCoverPct = ok?.current?.cloudCoverPct;
  const nowcastMmHr = ok?.rain?.nowcast?.[0]?.precipMmHr;
  const currentPrecipMm = ok?.current?.precipMm;

  /* Minutes since the anchor landed. State rather than a ref because the
     rendered output must change as it advances; a count so it stays SSR-stable
     and never reads the clock during render. */
  const [tick, setTick] = useState(0);
  const anchorAtRef = useRef<number | null>(null);
  const anchorKey = sun ? `${sun.elevationDeg}:${sun.progress01}:${sun.hourAngleDeg ?? "na"}` : null;

  useEffect(() => {
    if (!anchorKey) return;
    // A fresh reading resets the anchor and the extrapolation, so drift never accumulates across fetches.
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

  const out = useMemo(() => {
    if (!sun) return null;
    const hourAngle = anchorHourAngle(sun) + tick * DEG_PER_MINUTE;
    const t = sunroomT({ elevationDeg: sun.elevationDeg, hourAngleDeg: hourAngle });
    const cloud01 = typeof cloudCoverPct === "number" ? cloudCoverPct / 100 : 0;
    // The nowcast's first bucket is what falls in the next quarter hour; the ground should darken while it rains.
    const rain01 = rainIntensity01(nowcastMmHr ?? currentPrecipMm);
    const state = sunroomStateAt(t, { cloud01, rain01 });
    const { light, isDark } = state;

    // Direction override: when the feed carries a true azimuth, point the shadow where the sun is while every
    // stop-driven quality (magnitude, blur, alphas, colours) stays as the ramp produced it. Azimuth is not
    // extrapolated between polls: its rate depends on latitude and swings fastest near noon.
    let lightX = light.lightX;
    let lightY = light.lightY;
    if (typeof sun.azimuthDeg === "number" && Number.isFinite(sun.azimuthDeg)) {
      const magnitude = Math.hypot(light.lightX, light.lightY);
      const vector = sunroomLightVector(sun.azimuthDeg, sun.elevationDeg, magnitude);
      // Below the horizon there is no sun to point at; fade the geometry back to the stop's own direction
      // over the civil-twilight band the ramp treats as dark.
      const geoWeight = Math.min(1, Math.max(0, (sun.elevationDeg + 4) / 8));
      lightX = light.lightX + (vector.x - light.lightX) * geoWeight;
      lightY = light.lightY + (vector.y - light.lightY) * geoWeight;
    }

    // Shadows and the press vector derive from the EFFECTIVE (blended) light, so they follow the real sun.
    const vars = sunroomCssVars(state, { ...light, lightX, lightY });
    const decls = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    const css = `${STYLE_SELECTOR} {\n  color-scheme: ${isDark ? "dark" : "light"};\n${decls}\n}`;
    return { css, vars, isDark };
  }, [sun, cloudCoverPct, nowcastMmHr, currentPrecipMm, tick]);

  /* The stop cross-fade: runs in a layout effect so the clone is taken before the browser paints the new values. */
  const prevRef = useRef<{ vars: Record<string, string>; isDark: boolean; settled: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!out || theme !== "sunroom") return;
    const prev = prevRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prev && shouldStopFade(prev.isDark, out.isDark, reduced, prev.settled)) fadeFromOldStop(prev.vars, prev.isDark);
    // A ?wx= preview answers with a placeholder sun before the first fetch lands; that is not a settled stop (spec 4: no fade on load).
    prevRef.current = { vars: out.vars, isDark: out.isDark, settled: !isLoading };
  }, [out, theme]); // isLoading read from the render that produced `out`; it never needs to re-run the fade

  // Off-theme, or no sun to report: emit nothing; tokens.css is the whole definition.
  if (theme !== "sunroom" || !out) return null;

  return <style>{out.css}</style>;
}
