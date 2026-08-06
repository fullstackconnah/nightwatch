"use client";

/* THESIS (see kiosk-sunroom-weather.tsx's file-top comment for the layer's full
 * rationale): this is the third material, the one that needs an actual script
 * rather than a CSS keyframe — glass droplets, mist, and wind gusts. All three
 * are irregular, stateful particle systems (spawn/age/despawn, per-particle
 * drift with jitter) that a fixed set of CSS animations can't express without
 * either a huge hand-authored keyframe list or a visibly looping period. A
 * rAF loop is admissible here despite the rest of the layer's "no script"
 * discipline for the same reason the rest of it is allowed to animate at all:
 * it only ever runs during the weather that earns it (rain, fog, or a strong
 * gust), at a throttled 24fps, and it stops completely — no timers, no
 * listeners — the moment that weather clears or the tab is hidden.
 */

import { useEffect, useRef } from "react";

/** Backing-store cap. This is an 800x480 kiosk tablet, not a phone — a
 *  retina-scale canvas would be 4x the fill work for shapes that are already
 *  sub-0.08-alpha soft gradients no viewer is going to inspect for aliasing. */
const MAX_DPR = 1;

/** ~24fps. Weather atmosphere doesn't need 60 — the eye reads texture and
 *  drift, not per-frame smoothness, and every skipped frame is a frame the
 *  tablet's GPU isn't spending on a screen that's on for hours at a time. */
const FRAME_BUDGET_MS = 1000 / 24;

const TWO_PI = Math.PI * 2;

interface Droplet {
  x: number;
  y: number;
  r: number; // radius, px — also sets fall speed
  vx: number; // horizontal jitter, px/s
  vy: number; // current fall speed, px/s
  wobbleUntil: number; // ms timestamp — sits/condenses until this, then slides
  born: number;
  lastStampY: number; // y of the last trail stamp — see the moved-a-radius rule in frame()
}

interface MistBlob {
  baseY01: number; // 0-1, lower-third-weighted vertical anchor
  radius01: number; // fraction of viewport min-dimension
  crossSeconds: number; // time to drift fully across the width
  phase: number; // 0-1 starting offset along the horizontal drift
  breathePeriodS: number;
  breathePhase: number;
  dir: 1 | -1;
}

interface Gust {
  bandY: number; // px, top of the ~120px band this gust's streaks sit in
  streaks: Array<{ y: number; len: number; delay: number }>; // delay: ms before this streak starts
  born: number;
  durationMs: number;
}

export function KioskSunroomParticles({
  rain01,
  fog,
  windKmh,
  isDark,
  dusk01,
}: {
  rain01: number;
  fog: boolean;
  windKmh: number;
  isDark: boolean;
  dusk01: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Latest props read from inside the rAF loop without re-running the effect
  // (and re-allocating every particle) on every weather-poll tick.
  const propsRef = useRef({ rain01, fog, windKmh, isDark, dusk01 });
  propsRef.current = { rain01, fog, windKmh, isDark, dusk01 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Droplets need a canvas that PERSISTS between frames — the
    // destination-out fade below is what gives a sliding droplet its
    // dissolving wake, and that only works if last frame's paint survives
    // into this one. Mist and gusts need the opposite: a canvas fully wiped
    // every frame, because redrawing a low-alpha shape onto a canvas that
    // only fades by 0.045/frame settles into a ~0.5 equilibrium alpha, an
    // order of magnitude over this layer's contrast budget. One canvas can't
    // satisfy both, so droplets live entirely on this offscreen canvas
    // (never cleared, only faded) and get composited onto the visible,
    // clearRect'd canvas once per frame.
    const offscreen = document.createElement("canvas");
    const octx = offscreen.getContext("2d");
    if (!octx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const droplets: Droplet[] = [];
    let dropletSpawnAcc = 0;

    const mist: MistBlob[] = Array.from({ length: 5 }, (_, i) => ({
      baseY01: 0.55 + (i / 4) * 0.35 + (Math.random() - 0.5) * 0.1,
      radius01: 0.25 + Math.random() * 0.2,
      crossSeconds: 60 + Math.random() * 60,
      phase: Math.random(),
      breathePeriodS: 20 + Math.random() * 15,
      breathePhase: Math.random(),
      dir: Math.random() < 0.5 ? 1 : -1,
    }));

    let gusts: Gust[] = [];
    let nextGustAt = performance.now() + (5 + Math.random() * 7) * 1000;

    const spawnDroplet = (): Droplet => {
      const r = 1.5 + Math.random() * 2.5;
      const now = performance.now();
      const y = Math.random() * height * 0.8;
      return {
        x: Math.random() * width,
        y,
        r,
        vx: (Math.random() - 0.5) * 6,
        vy: 0,
        wobbleUntil: now + 400 + Math.random() * 900,
        born: now,
        lastStampY: y,
      };
    };

    const spawnGust = (nowMs: number): Gust => {
      const count = 4 + Math.floor(Math.random() * 4);
      const bandY = 40 + Math.random() * (height - 160);
      const streaks = Array.from({ length: count }, () => ({
        y: Math.random() * 120,
        len: 30 + Math.random() * 50,
        delay: Math.random() * 400,
      }));
      const speedScale = Math.min(60, propsRef.current.windKmh) / 60;
      return {
        bandY,
        streaks,
        born: nowMs,
        durationMs: (2 - speedScale * 0.8) * 1000, // ~1.2s at 60km/h up to ~2s calm
      };
    };

    let rafId = 0;
    let lastFrame = 0;
    let running = true;

    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const frame = (now: number) => {
      if (!running) return;
      rafId = requestAnimationFrame(frame);

      if (now - lastFrame < FRAME_BUDGET_MS) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000); // s, clamped so a tab-throttled gap doesn't jump particles
      lastFrame = now;

      const p = propsRef.current;
      const color = p.isDark ? "236, 242, 252" : "40, 52, 72";

      ctx.clearRect(0, 0, width, height);

      // --- A. Glass droplets ------------------------------------------------
      // Two draws per droplet, on two different canvases, and the split is
      // the contrast guarantee. The HEAD is drawn on the visible canvas,
      // which is cleared every frame, so its 0.07 alpha is exact no matter
      // how long the droplet sits beading up. The TRAIL is a low-alpha stamp
      // onto the persistent offscreen canvas — and it fires only once per
      // radius of travel, never per frame. Without that movement gate a
      // stationary droplet re-stamps the same pixels 24 times a second and
      // the destination-out fade can't keep up: the probe measured the
      // equilibrium at ~0.52 alpha, ten times this layer's budget. Gated by
      // distance, a pixel sees at most ~2 overlapping stamps before the fade
      // owns it, so the wake peaks near 0.07 and dissolves from there.
      if (p.rain01 > 0) {
        octx.globalCompositeOperation = "destination-out";
        octx.fillStyle = "rgba(0, 0, 0, 0.045)";
        octx.fillRect(0, 0, width, height);
        octx.globalCompositeOperation = "source-over";

        const targetCount = Math.round(6 + p.rain01 * 12);
        dropletSpawnAcc += dt * (targetCount / 3); // ~3s to reach target population from empty
        // Capped so a population sitting at target for hours doesn't let the
        // accumulator drift arbitrarily high and fire an instant burst
        // refill the moment a few droplets despawn together.
        dropletSpawnAcc = Math.min(dropletSpawnAcc, 3);
        while (dropletSpawnAcc >= 1 && droplets.length < targetCount) {
          droplets.push(spawnDroplet());
          dropletSpawnAcc -= 1;
        }

        const heads: Array<{ x: number; y: number; rr: number }> = [];
        for (let i = droplets.length - 1; i >= 0; i--) {
          const d = droplets[i];
          if (now >= d.wobbleUntil) {
            // Sliding: speed rides the radius (bigger drop, heavier, faster),
            // and accelerates slightly like a real bead gaining momentum.
            const targetV = (30 + d.r * 22) * (0.6 + p.rain01 * 0.6);
            d.vy += (targetV - d.vy) * Math.min(1, dt * 1.5);
            d.y += d.vy * dt;
            d.x += Math.sin(now / 400 + d.born) * d.vx * dt;
          }
          const age = (now - d.born) / 1000;
          const life = 6 + d.r; // seconds
          const fadeShrink = age > life * 0.7 ? 1 - (age - life * 0.7) / (life * 0.3) : 1;
          const rr = Math.max(0.3, d.r * Math.max(0, fadeShrink));

          if (d.y - rr > height || age > life || rr <= 0.3) {
            droplets.splice(i, 1);
            continue;
          }

          if (d.y - d.lastStampY >= rr) {
            d.lastStampY = d.y;
            const grad = octx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rr * 0.85);
            grad.addColorStop(0, `rgba(${color}, 0.035)`);
            grad.addColorStop(1, `rgba(${color}, 0)`);
            octx.fillStyle = grad;
            octx.beginPath();
            octx.arc(d.x, d.y, rr * 0.85, 0, TWO_PI);
            octx.fill();
          }
          heads.push({ x: d.x, y: d.y, rr });
        }

        // Composite the persistent trail layer onto the visible,
        // freshly-cleared canvas, then draw the heads over it. Destination
        // coords are in the CSS-pixel space `ctx`'s own dpr transform already
        // scales, and the offscreen canvas's backing store was sized
        // identically to the visible one in resize() above, so this maps 1:1
        // regardless of devicePixelRatio.
        ctx.drawImage(offscreen, 0, 0, width, height);
        for (const h of heads) {
          const grad = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.rr);
          grad.addColorStop(0, `rgba(${color}, 0.07)`);
          grad.addColorStop(1, `rgba(${color}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.rr, 0, TWO_PI);
          ctx.fill();
        }
      } else if (droplets.length) {
        droplets.length = 0;
        octx.clearRect(0, 0, width, height);
      }

      // --- B. Mist diffusion --------------------------------------------------
      // On the VISIBLE canvas, never the offscreen one: mist is redrawn in
      // full every frame, and stamping it onto the persistent droplet layer
      // would compound its alpha toward the ~0.5 equilibrium the two-canvas
      // split exists to prevent. Drawn after the droplet composite so mist
      // reads as the nearer material — fog sits between viewer and glass.
      if (p.fog) {
        const minDim = Math.min(width, height);
        const baseAlpha = 0.045 * (0.75 + 0.25 * p.dusk01);
        for (const m of mist) {
          const travel = ((now / 1000 / m.crossSeconds + m.phase) % 1) * m.dir;
          const x = ((travel % 1) + 1) % 1 * (width + minDim * m.radius01 * 2) - minDim * m.radius01;
          const breathe = Math.sin((now / 1000 / m.breathePeriodS + m.breathePhase) * TWO_PI) * 0.03 * height;
          const y = m.baseY01 * height + breathe;
          const r = minDim * m.radius01;

          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, `rgba(${color}, ${baseAlpha})`);
          grad.addColorStop(1, `rgba(${color}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TWO_PI);
          ctx.fill();
        }
      }

      // --- C. Wind gusts --------------------------------------------------
      // Gated by the caller to rain01 === 0: rain already communicates wind
      // via the streak angle, so a gust sweep running at the same time would
      // just be two signals for one fact — noise, not information.
      if (p.windKmh >= 30 && p.rain01 === 0) {
        if (now >= nextGustAt) {
          gusts.push(spawnGust(now));
          nextGustAt = now + (5 + Math.random() * 7) * 1000;
        }
        gusts = gusts.filter((g) => now - g.born < g.durationMs + 400);
        for (const g of gusts) {
          for (const s of g.streaks) {
            const t = (now - g.born - s.delay) / g.durationMs;
            if (t < 0 || t > 1) continue;
            const eased = easeInOut(t);
            const x = eased * (width + s.len) - s.len;
            const alpha = (t < 0.5 ? t * 2 : (1 - t) * 2) * 0.04;
            ctx.fillStyle = `rgba(${color}, ${Math.max(0, alpha)})`;
            ctx.fillRect(x, g.bandY + s.y, s.len, 1);
          }
        }
      } else if (gusts.length) {
        gusts = [];
      }
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
    const start = () => {
      if (running) return;
      running = true;
      lastFrame = 0;
      rafId = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    rafId = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Props are read live via propsRef so this setup — canvas sizing,
    // listeners, particle arrays — runs exactly once per mount rather than
    // re-allocating every particle system on every 15-minute weather tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // w-full/h-full are load-bearing: a canvas is a replaced element, so
  // `absolute inset-0` alone does NOT stretch it the way it stretches a div —
  // it keeps its intrinsic 300x150 and the overlay covers a corner of the
  // screen (the probe caught exactly that). Explicit 100% sizing is what
  // actually makes clientWidth/Height the viewport in resize().
  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
}
