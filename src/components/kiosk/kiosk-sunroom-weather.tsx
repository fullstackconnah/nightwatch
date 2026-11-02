"use client";

/* THESIS: the weather, as atmosphere rather than as a widget.
 *
 * The kiosk already SAYS "8° Drizzle" in words. This layer is for the thing
 * words are bad at — the feeling of standing in a room while it rains — and it
 * earns its place only if you never catch it working. Two materials, both
 * driven by the same feed the rest of sunroom runs on:
 *
 *   RAIN falls, leaning right with the wind, in a band (drizzle, light,
 *   moderate, heavy) set by the actual mm/hr from the nowcast, with the
 *   condition code as a floor. Nothing falls when nothing is falling outside.
 *   It is drawn by the particle layer below, not here.
 *
 *   CLOUD SHADOWS drift across the ground, as slow as real cloud (a minute or
 *   more to cross), at a speed set by the real wind and a strength set by real
 *   cover. This is the half that works on a dry overcast day, when rain has
 *   nothing to say.
 *
 * WHY THIS CAN'T HURT CONTRAST, structurally rather than by luck: the layer is
 * `fixed` at a negative z-index inside the kiosk's isolated stacking context,
 * so it paints above the theme's ground and BELOW every panel. Panels have
 * opaque backgrounds, so every word inside one is untouched by definition. The
 * only text sharing space with this layer is glance-mode copy on open ground,
 * and for that the loud marks (rain rings, crowns, the dark floor sheen) are
 * masked out of the glance text rects, and the streaks keep a floor over them
 * (the zone-mask contract in kiosk-sunroom-particles.tsx); the CSS layers here
 * stay at peak alphas of 0.03–0.06, a few percent of a colour already close to
 * the ground it sits on. The gates
 * are `scripts/sunroom-contrast.mjs` (the palette stops) and the pure tests in
 * src/lib/kiosk-weather-fx.test.ts, which composite the peak lightning glow
 * and the loudest streak or droplet over every ground and check the ink stays
 * at 4.5:1 and the flash's luminance step stays at or under 0.05. Nothing
 * samples rendered frames; these numbers are the check.
 *
 * MOTION DISCIPLINE: everything CSS-animated here is `transform` or
 * `opacity` and nothing else, on a handful of composited layers, because this
 * tablet holds one screen for hours and a layout-triggering animation would
 * burn it down. Under reduced motion the rain and lightning are replaced by a
 * still wet floor (one frame: a soft sheen along the bottom edge, no streaks
 * or rings, because a frozen streak field reads as scratches on the glass, not
 * as rain), while the cloud layer and fog stay as static soft variation, which
 * is still true and still atmospheric.
 *
 * A THIRD MATERIAL, script-driven rather than CSS-driven: the rain itself,
 * storm lightning, droplets on the glass, fog banks and short wind-gust
 * streaks — see kiosk-sunroom-particles.tsx. Rain needs a random position,
 * speed and length per streak, which a repeating CSS pattern can only fake as
 * a lattice, so all of it runs on one WebGL rAF loop. The loop exists only
 * while qualifying weather is active, runs throttled (30fps in rain, ~24
 * otherwise), and halts the instant the tab is hidden or the weather that
 * justified it clears.
 */

import dynamic from "next/dynamic";
import { useKioskWeather, useWxParams } from "@/lib/kiosk-client";
import { fetcher } from "@/lib/client";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { sunroomIsDark } from "@/lib/sunroom-light";
import { prefersReducedMotion } from "@/lib/kiosk-motion";
import { WX_PRESETS, clamp01, effectiveMmHr, rainBand } from "@/lib/kiosk-weather-fx";

/**
 * three.js is ~560 kB of chunk, and this module is reached from
 * kiosk/layout.tsx — which mounts on EVERY kiosk theme, not just sunroom. A
 * static import therefore put a WebGL renderer in the first-load graph of all
 * 16 themes, for a component that only ever renders on one of them, only in
 * rain/fog/wind, and under reduced motion only for the wet floor and fog (see `showParticles`).
 * Verified against .next/app-build-manifest.json: /kiosk/layout used to list
 * both three chunks eagerly.
 *
 * `ssr: false` costs nothing that wasn't already deferred — the theme itself
 * is read from localStorage in an effect (kiosk-theme.tsx's useKioskTheme
 * SSR-seeds "default"), so this subtree never rendered on the server anyway.
 * `loading: () => null` keeps the gap silent rather than flashing a
 * placeholder over the backdrop.
 */
const KioskSunroomParticles = dynamic(
  () => import("@/components/kiosk/kiosk-sunroom-particles").then((m) => m.KioskSunroomParticles),
  { ssr: false, loading: () => null },
);


/** Same scale the palette uses: 4 mm/hr is the top of the ramp, solidly heavy
 *  in temperate rain. Above it everything is already at full intensity. */
const RAIN_FULL_MM_HR = 4;

/** Cover below this is "a few clouds": the drift layer stays off rather than
 *  putting a permanent grey smudge on a blue-sky afternoon. */
const CLOUD_FLOOR = 0.15;

/** Above this much cover there are no stars to see, so none are drawn. The
 *  field also fades continuously below it rather than switching off at the
 *  line — a sky that goes from clear to broken should lose stars gradually,
 *  the way it actually does. */
const STAR_CLOUD_CEILING = 0.55;

/* A fixed, hand-placed field rather than a random one. Randomness would give
   a different sky on every render and, worse, a different sky on every 60s
   tick — stars that wander are the one thing a real night sky never does.
   Percentages, so the field scales with the viewport instead of clustering
   in a corner on the larger tablet. Kept to the upper two-thirds: the lower
   third of this screen is where the hub's own content sits, and stars behind
   a control panel read as dust on the glass.
   `s` is a size multiplier — a few brighter ones give the field depth; a
   uniform grid of identical dots reads as a texture, not a sky. */
const STARS: Array<{ x: number; y: number; s: number }> = [
  { x: 6, y: 12, s: 1 }, { x: 13, y: 31, s: 0.7 }, { x: 19, y: 8, s: 1.4 },
  { x: 24, y: 22, s: 0.8 }, { x: 31, y: 41, s: 1 }, { x: 37, y: 15, s: 0.7 },
  { x: 42, y: 33, s: 1.2 }, { x: 48, y: 6, s: 0.9 }, { x: 54, y: 26, s: 0.7 },
  { x: 59, y: 44, s: 1.1 }, { x: 63, y: 17, s: 0.8 }, { x: 68, y: 36, s: 1.5 },
  { x: 73, y: 10, s: 0.7 }, { x: 78, y: 29, s: 1 }, { x: 83, y: 47, s: 0.8 },
  { x: 87, y: 20, s: 1.2 }, { x: 91, y: 38, s: 0.7 }, { x: 95, y: 13, s: 0.9 },
  { x: 9, y: 49, s: 0.8 }, { x: 27, y: 55, s: 0.7 }, { x: 45, y: 52, s: 0.9 },
  { x: 71, y: 57, s: 0.7 }, { x: 88, y: 60, s: 0.8 }, { x: 16, y: 63, s: 0.7 },
];


export function KioskSunroomWeather() {
  const theme = useKioskTheme();
  const { data } = useKioskWeather();
  // Only a ?wx= preview times the first lightning strike, so a capture can land on it.
  const { wx } = useWxParams();

  const ok = data && data.status === "ok" ? data : null;
  const sun = ok?.sun;
  if (theme !== "sunroom" || !ok || !sun) return null;

  const isDark = sunroomIsDark({ elevationDeg: sun.elevationDeg, hourAngleDeg: sun.hourAngleDeg ?? 0 });
  const reduced = prefersReducedMotion();

  const mmHr = effectiveMmHr(ok);
  const band = rainBand(mmHr, ok.current?.code);
  const storm = ok.current?.code === "thunderstorm" && !reduced;
  // Only the star fade still reads a 0..1 rain level.
  const rain01 = band === "none" ? 0 : clamp01(mmHr / RAIN_FULL_MM_HR);
  const cloud01 = clamp01((ok.current?.cloudCoverPct ?? 0) / 100);
  const windKmh = Math.max(0, ok.current?.windKmh ?? 0);
  const fog = ok.current?.code === "fog";

  // Civil-twilight band: peaks at -2° elevation (sun just under the horizon,
  // the classic "mist deepens at dusk" light) and fades to 0 by +6°/-10°.
  const dusk01 = clamp01(1 - Math.abs(sun.elevationDeg + 2) / 8);

  // Rain already shows wind via the streak lean — a gust sweep on top of that
  // would be two signals for one fact, so gusts are rain-exclusive.
  const gust = windKmh >= 30 && band === "none";
  // Fog and rain mount even under reduced motion: the layer draws one still frame
  // (the wet-floor sheen when it rains, plus the fog).
  const showParticles = (!reduced && gust) || band !== "none" || fog;

  const cloudRgb = isDark ? "0, 2, 8" : "26, 34, 52";
  /* Cloud shadow strength rides cover, floored so a broken sky still shows
     something and capped well inside the band the contrast harness verifies. */
  const cloudA = cloud01 < CLOUD_FLOOR ? 0 : (isDark ? 0.055 : 0.045) * clamp01((cloud01 - CLOUD_FLOOR) / 0.6);

  /* Real cloud crosses a window slowly. 70s at a dead calm out to ~28s in a
     gale — still far slower than anything else that moves on this screen, which
     is what keeps it below the threshold of "something is animating at me". */
  const driftSeconds = Math.max(28, 70 - windKmh * 1.05);

  /* Stars are night-only and clear-sky-only, and they fade out as cover comes
     in rather than vanishing at a threshold. Rain suppresses them too: it is
     not raining out of a starry sky. Peak alpha is deliberately below the
     rain streaks' — on a near-black ground a 0.5-alpha dot is a headlight. */
  const starFade = clamp01((STAR_CLOUD_CEILING - cloud01) / STAR_CLOUD_CEILING);
  const starA = isDark ? 0.42 * starFade * (1 - rain01) : 0;
  const showStars = starA > 0.02;

  const showCloud = cloudA > 0;
  if (!showCloud && !showStars && !showParticles) return null;

  return (
    <div aria-hidden className="kiosk-sr-weather pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: -1 }}>
      {showStars && (
        /* One absolutely-positioned dot each rather than a canvas or an SVG:
           24 tiny composited divs cost nothing next to the two full-viewport
           gradient layers already here, and it keeps the twinkle to a plain
           CSS `opacity` animation per element with no script running at all.
           Under reduced motion the animation is dropped in CSS and the field
           simply sits still — a static star field is still a star field. */
        /* The field's overall strength lives HERE, on the wrapper, not on each
           star. The twinkle is a CSS `opacity` animation, and an animation
           beats an inline style in the cascade — putting starA inline on the
           dots would have been silently overridden the moment the keyframes
           ran, leaving every star at full brightness on a near-black ground.
           Wrapper opacity multiplies with the animated one instead, so the
           two compose the way they read. */
        <div className="absolute inset-0" style={{ opacity: starA }}>
          {STARS.map((s, i) => (
            <span
              key={i}
              className="kiosk-sr-star"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: `${s.s * 2}px`,
                height: `${s.s * 2}px`,
                // Per-star brightness rides the FILL, for the same reason —
                // and off --color-ink, not white, so the field is lit by the
                // same colour the theme is using for everything else at night.
                background: `color-mix(in srgb, var(--color-ink) ${Math.round((0.55 + s.s * 0.3) * 100)}%, transparent)`,
                // Prime-ish spread so no two neighbours pulse together and the
                // field never falls into a visible collective rhythm.
                animationDuration: `${7 + ((i * 7) % 12)}s`,
                animationDelay: `${-((i * 13) % 17)}s`,
              }}
            />
          ))}
        </div>
      )}

      {showCloud && (
        <>
          {/* Three blobs at different sizes, speeds and heights so the pattern
              never visibly repeats. Negative delays start them mid-journey —
              without those, all three enter from the left edge together on
              load and the first pass reads as a wipe. */}
          <div
            className="kiosk-sr-cloud"
            style={{
              top: "-18%",
              width: "58%",
              height: "78%",
              background: `radial-gradient(closest-side, rgba(${cloudRgb},${cloudA}) 0%, rgba(${cloudRgb},0) 72%)`,
              animationDuration: `${driftSeconds}s`,
              animationDelay: `${-driftSeconds * 0.15}s`,
            }}
          />
          <div
            className="kiosk-sr-cloud"
            style={{
              top: "22%",
              width: "76%",
              height: "92%",
              background: `radial-gradient(closest-side, rgba(${cloudRgb},${cloudA * 0.8}) 0%, rgba(${cloudRgb},0) 70%)`,
              animationDuration: `${driftSeconds * 1.55}s`,
              animationDelay: `${-driftSeconds * 0.9}s`,
            }}
          />
          <div
            className="kiosk-sr-cloud"
            style={{
              top: "48%",
              width: "48%",
              height: "70%",
              background: `radial-gradient(closest-side, rgba(${cloudRgb},${cloudA * 0.65}) 0%, rgba(${cloudRgb},0) 74%)`,
              animationDuration: `${driftSeconds * 2.2}s`,
              animationDelay: `${-driftSeconds * 1.7}s`,
            }}
          />
        </>
      )}

      {showParticles && (
        <KioskSunroomParticles
          band={band}
          storm={storm}
          reduced={reduced}
          fog={fog}
          windKmh={windKmh}
          isDark={isDark}
          dusk01={dusk01}
          firstStrikeMs={wx && Object.hasOwn(WX_PRESETS, wx) ? 1500 : undefined}
        />
      )}
    </div>
  );
}
