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
import { KIOSK_LIGHT_THEMES, useKioskTheme } from "@/components/kiosk-theme";
import { sunroomIsDark } from "@/lib/sunroom-light";

const SKY_REFRESH_MS = 15 * 60_000;

type SunPhase = "night" | "dawn" | "day" | "dusk";

interface SkyWeatherOk {
  status: "ok";
  current?: { cloudCoverPct?: number };
  sun?: { elevationDeg: number; phase: SunPhase; progress01: number; hourAngleDeg?: number };
}

type SkyWeatherResponse = SkyWeatherOk | { status: "unconfigured" | "unreachable"; detail?: string };

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

/* transform + opacity only, deliberately no `top`: both are compositor-only
   properties, so this 90s crossfade never triggers layout on a tablet that
   stays on this screen for hours. See the translateY composition note where
   this is applied. */
const SKY_TRANSITION = "transform 90s linear, opacity 90s linear";

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
  // ~0.10 total layer opacity, light ones at ~0.05 (KIOSK_LIGHT_THEMES,
  // imported from kiosk-theme.tsx) so a pale ground never gets muddied.
  /* Sunroom is the one theme whose ground lightness is not a constant — it
     runs on the same sun this layer does and goes genuinely dark at night, so
     reading the static KIOSK_LIGHT_THEMES set for it would cap a near-black
     midnight ground at the pale-ground opacity and leave this layer invisible
     exactly when it has the most room. Every other theme is still answered by
     the set, which is correct for them. */
  const groundIsLight =
    theme === "sunroom"
      ? !sunroomIsDark({ elevationDeg: sun.elevationDeg, hourAngleDeg: sun.hourAngleDeg ?? 0 })
      : KIOSK_LIGHT_THEMES.has(theme);
  const themeCap = groundIsLight ? 0.05 : 0.1;
  const glowOpacity = themeCap * tuning.glowPeak * cloudFactor;
  const washOpacity = themeCap * tuning.washPeak * cloudFactor;

  return (
    <div aria-hidden className="kiosk-sky-layer pointer-events-none fixed inset-0" style={{ zIndex: -1 }}>
      {/* Reduced-motion fallback: the two blobs below transition transform/
          opacity over 90s to ride the 15-min data cadence smoothly;
          `!important` here outranks their non-important inline
          `transition`, collapsing both to an instant cut for anyone who
          asked for less motion. */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .kiosk-sky-layer > div { transition: none !important; }
        }
      `}</style>
      {/* `top` is pinned at a constant 50% (of the viewport, since this
          layer's ancestor is `fixed inset-0`) instead of animating — the
          sun's vertical drift now lives entirely in `transform`, as a `vh`
          offset composed with the existing self-centering `-50%`. `vh` and
          `%` can share one calc() even though they resolve against
          different boxes (viewport vs. this element's own height): with a
          fixed-position ancestor sized to the viewport, `Nvh` here is
          numerically identical to what `top: N%` used to mean, so the
          drift range and the centring both survive unchanged — only the
          property that carries them changed, from layout to compositor. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "170%",
          height: "75%",
          transform: `translate(-50%, calc(-50% + ${washY - 50}vh))`,
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
          top: "50%",
          width: "140%",
          height: "60%",
          transform: `translate(-50%, calc(-50% + ${glowY - 50}vh))`,
          borderRadius: "9999px",
          background: `radial-gradient(closest-side, rgba(${glowColor},1) 0%, rgba(${glowColor},0.45) 40%, transparent 72%)`,
          opacity: glowOpacity,
          transition: SKY_TRANSITION,
        }}
      />
    </div>
  );
}
