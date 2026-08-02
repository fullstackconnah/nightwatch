"use client";

/* THESIS: a device-wide ambient backdrop for /kiosk, tinting the ground with
   the REAL sun — not a clock-driven guess, the /kiosk/api/weather sun block
   (elevationDeg/phase/progress01) computed server-side against the house's
   actual coordinates. This is atmosphere, not a widget: no numbers, no
   icons, nothing to read — two soft radial blobs whose color and vertical
   position drift with the sun and mute under cloud cover, sitting almost at
   the noise floor (peak ~0.10 opacity on dark themes, ~0.05 on light ones)
   so it never competes with a panel's own reading.

   STACKING NOTE for whoever mounts this: KioskThemeScope's own div paints
   an OPAQUE, full-viewport `bg-bg` background as a plain non-positioned box.
   In CSS's painting order, negative-z-index descendants (step 2) paint
   *before* a shared context's normal in-flow boxes (step 3) as one flat
   group — so a bare z-index:-1 layer here would sit behind that div's own
   ground color and never be seen, regardless of DOM nesting. To get the
   intended ground-then-sky-then-panels stack, mount `<KioskSky />` as the
   FIRST child inside the div KioskThemeScope returns (src/components/
   kiosk-theme.tsx), and give that div `position: relative` (or
   `isolation: isolate`) so its own background becomes THAT box's stacking
   root — z-index:-1 here then nests above its ground and below every
   normal-flow child (the panels) inside the same local context. Without
   that one-line ancestor change this layer is invisible by construction,
   not a bug in this file. */

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import { useKioskTheme } from "@/components/kiosk-theme";

const SKY_REFRESH_MS = 15 * 60_000;

type SunPhase = "night" | "dawn" | "day" | "dusk";

interface SkyWeatherOk {
  status: "ok";
  current?: { cloudCoverPct?: number };
  sun?: { elevationDeg: number; phase: SunPhase; progress01: number };
}

type SkyWeatherResponse = SkyWeatherOk | { status: "unconfigured" | "unreachable"; detail?: string };

/* Mirrors the `color-scheme` declared on each [data-kiosk-theme] block in
   globals.css (nine light identities out of the sixteen). Checked by theme
   name rather than reading a computed background-color: the whole catalog's
   palette is fixed at author time in kiosk-theme.tsx/globals.css, so a
   lookup here is exact where a DOM/luminance read would only be an
   approximation, and it needs no extra effect, observer, or timer — the
   theme is already a value this component has via useKioskTheme(). */
const LIGHT_THEMES = new Set([
  "journal",
  "folio",
  "slate",
  "sunroom",
  "aerogel",
  "bulletin",
  "understory",
  "duotone",
  "cinderblock",
]);

/* Per-phase color (as an "r,g,b" triple, desaturated toward gray under
   cloud) and how strongly each of the two blobs reads for that phase —
   peaks are fractions of the theme's own opacity cap, not raw opacity. */
const PHASE_TUNING: Record<SunPhase, { glow: string; wash: string; glowPeak: number; washPeak: number }> = {
  dawn: { glow: "255,168,96", wash: "255,214,182", glowPeak: 1, washPeak: 0.4 },
  day: { glow: "150,205,255", wash: "190,222,255", glowPeak: 0.22, washPeak: 0.85 },
  dusk: { glow: "255,132,120", wash: "222,128,168", glowPeak: 1, washPeak: 0.45 },
  night: { glow: "140,162,224", wash: "120,140,196", glowPeak: 0.12, washPeak: 0.12 },
};

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Mixes an "r,g,b" triple toward its own gray (perceptual luminance) by `t`
 *  — the desaturation half of cloud muting; opacity (in the caller) carries
 *  the dimming half. */
function desaturate(rgb: string, t: number): string {
  const parts = rgb.split(",").map(Number);
  const [r, g, b] = parts;
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => Math.round(c + (gray - c) * t);
  return `${mix(r)},${mix(g)},${mix(b)}`;
}

const SKY_TRANSITION = "top 90s linear, opacity 90s linear";

/** Fixed, non-interactive sky tint for /kiosk. Renders null whenever the
 *  weather feed isn't ok or hasn't landed a `sun` block yet — every named
 *  kiosk theme's own ground stays exactly as authored until real sun data
 *  says otherwise. See the STACKING NOTE above for how this must be mounted. */
export function KioskSky() {
  const theme = useKioskTheme();
  const { data } = useSWR<SkyWeatherResponse>("/kiosk/api/weather", fetcher, {
    refreshInterval: SKY_REFRESH_MS,
    keepPreviousData: true,
  });

  const ok = data && data.status === "ok" ? data : null;
  const sun = ok?.sun;
  const cloudCoverPct = ok?.current?.cloudCoverPct;
  if (!sun || typeof cloudCoverPct !== "number") return null;

  const tuning = PHASE_TUNING[sun.phase] ?? PHASE_TUNING.night;
  const progress = clamp01(sun.progress01);
  const cloud = clamp01(cloudCoverPct / 100);

  // Sun low (progress near 0) -> glow near the bottom edge; sun high
  // (progress near 1) -> glow rises toward the upper third. Loose and
  // monotonic per the brief, not a literal reconstruction of the sun's arc.
  const glowY = 92 - progress * 60; // 92% near-bottom -> 32% upper-third
  const washY = 16 - progress * 8; // stays high; drifts a little higher near zenith

  // Cloud mute: full overcast caps at 40% of clear-sky intensity and the
  // color desaturates toward gray as it thickens.
  const cloudFactor = 1 - cloud * 0.6;
  const desatT = cloud * 0.65;
  const glowColor = desaturate(tuning.glow, desatT);
  const washColor = desaturate(tuning.wash, desatT);

  // Intensity discipline: ambience, not decoration. Dark themes cap at
  // ~0.10 total layer opacity, light ones at ~0.05 (LIGHT_THEMES, see
  // above) so a pale ground never gets muddied.
  const themeCap = LIGHT_THEMES.has(theme) ? 0.05 : 0.1;
  const glowOpacity = themeCap * tuning.glowPeak * cloudFactor;
  const washOpacity = themeCap * tuning.washPeak * cloudFactor;

  return (
    <div aria-hidden className="kiosk-sky-layer pointer-events-none fixed inset-0" style={{ zIndex: -1 }}>
      {/* Reduced-motion fallback: the two blobs below transition top/opacity
          over 90s to ride the 15-min data cadence smoothly; `!important`
          here outranks their non-important inline `transition`, collapsing
          both to an instant cut for anyone who asked for less motion. */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .kiosk-sky-layer > div { transition: none !important; }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${washY}%`,
          width: "170%",
          height: "75%",
          transform: "translate(-50%, -50%)",
          borderRadius: "9999px",
          background: `radial-gradient(closest-side, rgba(${washColor},1) 0%, rgba(${washColor},0.4) 45%, transparent 75%)`,
          opacity: washOpacity,
          transition: SKY_TRANSITION,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${glowY}%`,
          width: "140%",
          height: "60%",
          transform: "translate(-50%, -50%)",
          borderRadius: "9999px",
          background: `radial-gradient(closest-side, rgba(${glowColor},1) 0%, rgba(${glowColor},0.45) 40%, transparent 72%)`,
          opacity: glowOpacity,
          transition: SKY_TRANSITION,
        }}
      />
    </div>
  );
}
