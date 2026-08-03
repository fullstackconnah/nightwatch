"use client";

/* THESIS: the weather, as atmosphere rather than as a widget.
 *
 * The kiosk already SAYS "8° Drizzle" in words. This layer is for the thing
 * words are bad at — the feeling of standing in a room while it rains — and it
 * earns its place only if you never catch it working. Two materials, both
 * driven by the same feed the rest of sunroom runs on:
 *
 *   RAIN falls, angled by the wind, at a speed and density set by the actual
 *   mm/hr from the nowcast. Nothing falls when nothing is falling outside.
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
 * and for that the peak alphas below are deliberately in the 0.03–0.06 band —
 * a few percent of a colour already close to the ground it sits on. That is
 * small enough to be verified rather than argued about: the harness samples
 * real rendered pixels across animation frames and computes the worst-case
 * contrast the ink ever sees.
 *
 * MOTION DISCIPLINE: everything animated here is `transform` and nothing else,
 * on a handful of composited layers, because this tablet holds one screen for
 * hours and a layout-triggering animation would burn it down. Under reduced
 * motion the rain is removed outright — a frozen streak field reads as
 * scratches on the glass, not as rain — while the cloud layer stays as a
 * static soft variation, which is still true and still atmospheric.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/client";
import { useKioskTheme } from "@/components/kiosk-theme";
import { sunroomIsDark } from "@/lib/sunroom-light";
import { prefersReducedMotion } from "@/lib/kiosk-motion";

const WEATHER_REFRESH_MS = 15 * 60_000;

/** Same scale the palette uses: 4 mm/hr is the top of the ramp, solidly heavy
 *  in temperate rain. Above it everything is already at full intensity. */
const RAIN_FULL_MM_HR = 4;

/** Below this there is nothing to draw — a nowcast of 0.01 mm/hr is not rain,
 *  and a single ghostly streak crossing the screen is worse than none. */
const RAIN_FLOOR_MM_HR = 0.05;

/** Cover below this is "a few clouds": the drift layer stays off rather than
 *  putting a permanent grey smudge on a blue-sky afternoon. */
const CLOUD_FLOOR = 0.15;

interface WeatherOk {
  status: "ok";
  current?: { cloudCoverPct?: number; precipMm?: number; windKmh?: number };
  rain?: { nowcast?: Array<{ minutesFromNow: number; precipMmHr: number }> };
  sun?: { elevationDeg: number; progress01: number; hourAngleDeg?: number };
}

type WeatherResponse = WeatherOk | { status: "unconfigured" | "unreachable"; detail?: string };

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function KioskSunroomWeather() {
  const theme = useKioskTheme();
  const { data } = useSWR<WeatherResponse>("/kiosk/api/weather", fetcher, {
    refreshInterval: WEATHER_REFRESH_MS,
    keepPreviousData: true,
  });

  const ok = data && data.status === "ok" ? data : null;
  const sun = ok?.sun;
  if (theme !== "sunroom" || !ok || !sun) return null;

  const isDark = sunroomIsDark({ elevationDeg: sun.elevationDeg, hourAngleDeg: sun.hourAngleDeg ?? 0 });
  const reduced = prefersReducedMotion();

  const mmHr = ok.rain?.nowcast?.[0]?.precipMmHr ?? ok.current?.precipMm ?? 0;
  const rain01 = mmHr >= RAIN_FLOOR_MM_HR ? clamp01(mmHr / RAIN_FULL_MM_HR) : 0;
  const cloud01 = clamp01((ok.current?.cloudCoverPct ?? 0) / 100);
  const windKmh = Math.max(0, ok.current?.windKmh ?? 0);

  /* Rain leans with the wind, but only so far: past about 18° a streak field
     stops reading as weather and starts reading as a screen-door texture. 40
     km/h is a genuinely windy day here and maps to the ceiling. */
  const windDeg = Math.min(18, (windKmh / 40) * 18);

  /* Heavier rain is denser (columns closer together), longer-streaked and
     faster. Real rain falls fast enough that the streak is the point — too
     slow and it reads as drifting ash. */
  const columnPx = Math.round(40 - rain01 * 20);
  const dashPx = Math.round(12 + rain01 * 10);
  const periodPx = Math.round(70 - rain01 * 26);
  const pxPerSecond = 240 + rain01 * 220;
  // Duration for ONE period of travel — see the keyframe's comment on why the
  // loop is expressed in px rather than a percentage of the element.
  const fallSeconds = periodPx / pxPerSecond;

  /* On a pale ground rain is a darkening; on a dark one it catches what little
     light there is and lifts. Both stay near-neutral — this layer must not
     introduce a hue that argues with KioskSky's coloured sun. */
  const streak = isDark ? "236, 242, 252" : "40, 52, 72";
  const streakA = (isDark ? 0.05 : 0.045) * (0.35 + rain01 * 0.65);

  const cloudRgb = isDark ? "0, 2, 8" : "26, 34, 52";
  /* Cloud shadow strength rides cover, floored so a broken sky still shows
     something and capped well inside the band the contrast harness verifies. */
  const cloudA = cloud01 < CLOUD_FLOOR ? 0 : (isDark ? 0.055 : 0.045) * clamp01((cloud01 - CLOUD_FLOOR) / 0.6);

  /* Real cloud crosses a window slowly. 70s at a dead calm out to ~28s in a
     gale — still far slower than anything else that moves on this screen, which
     is what keeps it below the threshold of "something is animating at me". */
  const driftSeconds = Math.max(28, 70 - windKmh * 1.05);

  const showRain = rain01 > 0 && !reduced;
  const showCloud = cloudA > 0;
  if (!showRain && !showCloud) return null;

  return (
    <div aria-hidden className="kiosk-sr-weather pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: -1 }}>
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

      {showRain && (
        /* Rotation lives on the wrapper and the fall lives on the child, so the
           animation stays a pure translate. Combining both in one transform
           would mean re-composing the rotation every frame for no reason. The
           wrapper is oversized because a rotated rect leaves triangular gaps at
           the corners of the viewport otherwise. */
        <div
          className="absolute"
          style={{
            left: "-30%",
            top: "-30%",
            width: "160%",
            height: "160%",
            transform: `rotate(${windDeg}deg)`,
          }}
        >
          {[0, 1].map((layer) => {
            /* Two passes, near and far. The far one is finer, dimmer, slower
               and offset — one pass alone reads as a printed texture, two at
               different speeds read as depth, which is the whole difference
               between "rain" and "lines". */
            const far = layer === 1;
            const col = far ? Math.round(columnPx * 1.6) : columnPx;
            const per = far ? Math.round(periodPx * 1.35) : periodPx;
            const dash = far ? Math.round(dashPx * 0.7) : dashPx;
            const a = far ? streakA * 0.55 : streakA;
            const width = far ? 1 : 1.5;
            return (
              <div
                key={layer}
                className="kiosk-sr-rain"
                style={
                  {
                    "--sr-rain-period": `${per}px`,
                    // Thin vertical columns...
                    backgroundImage: `repeating-linear-gradient(90deg, rgba(${streak},${a}) 0 ${width}px, rgba(${streak},0) ${width}px ${col}px)`,
                    // ...cut into falling dashes by the mask.
                    WebkitMaskImage: `repeating-linear-gradient(180deg, #000 0 ${dash}px, transparent ${dash}px ${per}px)`,
                    maskImage: `repeating-linear-gradient(180deg, #000 0 ${dash}px, transparent ${dash}px ${per}px)`,
                    // Offset the far pass so the two never line up into a grid.
                    backgroundPositionX: far ? `${Math.round(col / 3)}px` : "0",
                    animationDuration: `${far ? fallSeconds * 1.45 : fallSeconds}s`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
