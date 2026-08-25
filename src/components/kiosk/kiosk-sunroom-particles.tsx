"use client";

/* THESIS: High-performance 3D atmospheric weather overlay powered by Three.js.
 *
 * Replaces 2D canvas drawing with a WebGLRenderer scene (a points system for
 * droplets, fog sprite planes, and gust line segments). Runs with strict
 * frame-budget gating (~24fps), automatic tab-visibility pausing, and complete
 * GPU resource disposal on unmount.
 *
 * COORDINATE CONVENTION — the one thing to get right in this file. The
 * orthographic camera is set up as (left 0, right width, TOP height, BOTTOM 0),
 * i.e. a normal maths orientation with y increasing UPWARD. The simulation
 * below thinks in screen space (y increasing downward, 0 at the top edge),
 * because that is how rain, mist height and gust bands are naturally described.
 * Every write into a position buffer therefore converts once, as `height - y`,
 * and nowhere else. Flipping the camera instead of the coordinates would break
 * `resize()`, which can only ever set `camera.top`/`camera.right` — with the
 * frustum inverted, `top` and `bottom` would both end up at `height`, the
 * projection's y-scale would divide by zero, and the whole overlay would
 * silently disappear on the first resize.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ~24fps. On a 60Hz panel this lands on every third vsync (an even 20fps)
   rather than jittering, and this layer is soft blobs and hairlines — there is
   nothing here whose motion a higher rate would improve. */
const FRAME_BUDGET_MS = 1000 / 24;

const MAX_DROPLETS = 40;
const MAX_GUST_LINES = 32;
const MIST_BLOBS = 5;

/** Peak alpha of one mist blob before the dusk/fade multipliers. Blobs overlap,
 *  so the on-screen worst case is a small multiple of this — it stays inside
 *  the same 0.03–0.06 band kiosk-sunroom-weather.tsx's CSS cloud layer is
 *  verified in. The previous 0.025 was below the threshold of visibility on
 *  this tablet: fog was mounting a renderer to draw nothing. */
const MIST_PEAK_ALPHA = 0.055;

/** Same argument for the gust streaks. These are 1px hairlines alive for under
 *  two seconds, not a full-viewport wash, so they need a higher number than the
 *  wash band to register at all; 0.04 was invisible. */
const GUST_PEAK_ALPHA = 0.13;

/** Droplet sprite radius (px) per unit of simulated droplet radius. The sprite
 *  texture's bright core is its inner ~40%, so the point has to be drawn
 *  several times larger than the droplet it depicts. */
const DROPLET_PX_PER_R = 4.2;

interface DropletState {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  wobbleUntil: number;
  born: number;
}

interface MistState {
  baseY01: number;
  radius01: number;
  crossSeconds: number;
  phase: number;
  breathePeriodS: number;
  breathePhase: number;
  dir: 1 | -1;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

interface GustState {
  bandY: number;
  streaks: Array<{ y: number; len: number; delay: number }>;
  born: number;
  durationMs: number;
}

/* Per-point size and alpha, which THREE.PointsMaterial cannot express: its
   `size` is one uniform for the whole system. The droplet simulation has always
   computed a per-droplet radius and an age-based shrink — under PointsMaterial
   both were discarded every frame and all 40 droplets drew as identical 16px
   dots that vanished the instant they aged out. These two shaders are the
   smallest thing that actually applies them. */
const DROPLET_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const DROPLET_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float a = texture2D( uMap, gl_PointCoord ).a * vAlpha * uOpacity;
    // Fully-faded droplets still cost a blend without this.
    if ( a < 0.003 ) discard;
    gl_FragColor = vec4( uColor, a );
    #include <colorspace_fragment>
  }
`;

/** Generates a soft radial droplet sprite texture */
function createDropletTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  grad.addColorStop(0.4, "rgba(255, 255, 255, 0.3)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return finishTexture(new THREE.CanvasTexture(canvas));
}

/** Generates a soft volumetric mist sprite texture */
function createMistTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.8)");
  grad.addColorStop(0.5, "rgba(255, 255, 255, 0.25)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return finishTexture(new THREE.CanvasTexture(canvas));
}

/** Both sprites are drawn once at a fixed on-screen size and never minified, so
 *  a mip chain is pure upload cost and VRAM for levels that are never sampled. */
function finishTexture(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ rain01, fog, windKmh, isDark, dusk01 });
  propsRef.current = { rain01, fog, windKmh, isDark, dusk01 };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* Never bail on a zero-sized container. This subtree is dynamically
       imported into a `fixed inset-0` parent, so a first measurement of 0 is a
       timing accident, not a permanent state — the ResizeObserver below corrects
       it. Returning early here would leave the overlay dead for the session. */
    let width = Math.max(1, container.clientWidth);
    let height = Math.max(1, container.clientHeight);

    // --- 1. Three.js Setup ----------------------------------------------------
    const scene = new THREE.Scene();

    // Pixel-for-pixel orthographic projection, y UP. See the coordinate note
    // at the top of this file before touching these four numbers.
    const camera = new THREE.OrthographicCamera(0, width, height, 0, 0.1, 1000);
    camera.position.z = 10;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);
    // `false` keeps the canvas sized by CSS (100%/100% below) instead of having
    // setSize stamp px dimensions over it every resize.
    renderer.setSize(width, height, false);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    // --- 2. Shared Textures & Materials -------------------------------------
    const dropletTexture = createDropletTexture();
    const mistTexture = createMistTexture();

    // Droplets system (THREE.Points)
    const dropletPositions = new Float32Array(MAX_DROPLETS * 3);
    const dropletSizes = new Float32Array(MAX_DROPLETS);
    const dropletAlphas = new Float32Array(MAX_DROPLETS);

    const dropletGeo = new THREE.BufferGeometry();
    const dropletPosAttr = new THREE.BufferAttribute(dropletPositions, 3).setUsage(THREE.DynamicDrawUsage);
    const dropletSizeAttr = new THREE.BufferAttribute(dropletSizes, 1).setUsage(THREE.DynamicDrawUsage);
    const dropletAlphaAttr = new THREE.BufferAttribute(dropletAlphas, 1).setUsage(THREE.DynamicDrawUsage);
    dropletGeo.setAttribute("position", dropletPosAttr);
    dropletGeo.setAttribute("aSize", dropletSizeAttr);
    dropletGeo.setAttribute("aAlpha", dropletAlphaAttr);
    dropletGeo.setDrawRange(0, 0);

    const dropletMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: dropletTexture },
        uColor: { value: new THREE.Color(0xecf2fc) },
        uOpacity: { value: 0.9 },
      },
      vertexShader: DROPLET_VERT,
      fragmentShader: DROPLET_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const dropletPoints = new THREE.Points(dropletGeo, dropletMat);
    // Every object here is authored directly in screen space and is on-screen
    // by construction. Culling would need a bounding sphere recomputed from a
    // buffer that changes every frame, for a test that can never fail.
    dropletPoints.frustumCulled = false;
    scene.add(dropletPoints);

    // Fog / Mist System (Mesh planes with soft gradient textures)
    const mistPlaneGeo = new THREE.PlaneGeometry(1, 1);
    const mistBlobs: MistState[] = Array.from({ length: MIST_BLOBS }, (_, i) => {
      const mistMat = new THREE.MeshBasicMaterial({
        map: mistTexture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(mistPlaneGeo, mistMat);
      mesh.position.z = 1;
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);

      return {
        // Lower half of the screen: this is ground fog pooling, not overcast.
        baseY01: 0.55 + (i / (MIST_BLOBS - 1)) * 0.35 + (Math.random() - 0.5) * 0.1,
        radius01: 0.25 + Math.random() * 0.2,
        crossSeconds: 60 + Math.random() * 60,
        phase: Math.random(),
        breathePeriodS: 20 + Math.random() * 15,
        breathePhase: Math.random(),
        dir: Math.random() < 0.5 ? 1 : -1,
        mesh,
      };
    });

    // Wind Gust Lines System (THREE.LineSegments)
    const gustPositions = new Float32Array(MAX_GUST_LINES * 6); // 2 vertices per line
    /* RGBA per vertex, not RGB. Three enables per-vertex ALPHA only when the
       colour attribute has itemSize 4, and that alpha is the entire reason this
       attribute exists: one LineBasicMaterial cannot give each streak its own
       fade envelope, so without it every gust popped on and off at full
       strength and every streak was equally bright end to end. */
    const gustColors = new Float32Array(MAX_GUST_LINES * 8);
    const gustGeo = new THREE.BufferGeometry();
    const gustPosAttr = new THREE.BufferAttribute(gustPositions, 3).setUsage(THREE.DynamicDrawUsage);
    const gustColorAttr = new THREE.BufferAttribute(gustColors, 4).setUsage(THREE.DynamicDrawUsage);
    gustGeo.setAttribute("position", gustPosAttr);
    gustGeo.setAttribute("color", gustColorAttr);
    gustGeo.setDrawRange(0, 0);
    const gustMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: GUST_PEAK_ALPHA,
      depthWrite: false,
      depthTest: false,
    });
    const gustLines = new THREE.LineSegments(gustGeo, gustMat);
    gustLines.frustumCulled = false;
    scene.add(gustLines);

    // --- 3. Simulation State ------------------------------------------------
    const droplets: DropletState[] = [];
    let dropletSpawnAcc = 0;
    let gusts: GustState[] = [];
    /* The first gust comes sooner than the steady-state cadence below. The
       layer only mounts once it is genuinely windy, and opening with 5–12s of
       empty screen reads as "nothing here" rather than as a lull. */
    let nextGustAt = performance.now() + (1 + Math.random() * 3) * 1000;
    /* Fog arrives and clears over minutes in the real world and over one SWR
       tick here. Without an eased mix, a 15-minute poll that flips `fog` makes
       five blobs appear at full strength between two frames. */
    let fogMix = 0;
    let lastColorHex = -1;
    let drewLastFrame = true;

    const spawnDroplet = (): DropletState => {
      const r = 1.5 + Math.random() * 2.5;
      const now = performance.now();
      return {
        x: Math.random() * width,
        y: Math.random() * height * 0.8,
        r,
        vx: (Math.random() - 0.5) * 6,
        vy: 0,
        wobbleUntil: now + 400 + Math.random() * 900,
        born: now,
      };
    };

    const spawnGust = (nowMs: number): GustState => {
      const count = 4 + Math.floor(Math.random() * 4);
      const bandY = 40 + Math.random() * Math.max(1, height - 160);
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
        durationMs: (2 - speedScale * 0.8) * 1000,
      };
    };

    // --- 4. Render Loop (24 FPS Budget) -------------------------------------
    let rafId = 0;
    let lastFrame = 0;
    let running = true;

    // A gust enters fast and trails off; it does not ease into existence.
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const frame = (now: number) => {
      if (!running) return;
      rafId = requestAnimationFrame(frame);

      if (now - lastFrame < FRAME_BUDGET_MS) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      const p = propsRef.current;
      const colorHex = p.isDark ? 0xecf2fc : 0x283448;
      // setHex runs an sRGB->working-space conversion; it does not need to run
      // 20 times a second to answer a boolean that changes twice a day.
      if (colorHex !== lastColorHex) {
        lastColorHex = colorHex;
        dropletMat.uniforms.uColor.value.setHex(colorHex);
        gustMat.color.setHex(colorHex);
        mistBlobs.forEach((m) => m.mesh.material.color.setHex(colorHex));
      }

      // --- A. Rain Droplets Update ---
      if (p.rain01 > 0) {
        const targetCount = Math.round(6 + p.rain01 * 12);
        dropletSpawnAcc += dt * (targetCount / 3);
        dropletSpawnAcc = Math.min(dropletSpawnAcc, 3);
        while (dropletSpawnAcc >= 1 && droplets.length < targetCount) {
          droplets.push(spawnDroplet());
          dropletSpawnAcc -= 1;
        }

        /* Wind pushes water across the glass as it runs. Capped at 60km/h and
           scaled to stay under the ~18° lean the CSS streak layer uses, so the
           two halves of the rain read as one weather rather than two. */
        const windDrift = Math.min(60, p.windKmh) * 0.25;
        let activeCount = 0;

        for (let i = droplets.length - 1; i >= 0; i--) {
          const d = droplets[i];
          if (now >= d.wobbleUntil) {
            const targetV = (30 + d.r * 22) * (0.6 + p.rain01 * 0.6);
            d.vy += (targetV - d.vy) * Math.min(1, dt * 1.5);
            d.y += d.vy * dt;
            d.x += (Math.sin(now / 400 + d.born) * d.vx + windDrift) * dt;
          }
          const age = (now - d.born) / 1000;
          const life = 6 + d.r;
          const fadeShrink = age > life * 0.7 ? 1 - (age - life * 0.7) / (life * 0.3) : 1;
          const rr = Math.max(0.3, d.r * Math.max(0, fadeShrink));

          if (d.y - rr > height || age > life || rr <= 0.3) {
            droplets.splice(i, 1);
            continue;
          }

          // Condensation forms, it does not appear. 350ms in, ~1s of fade out.
          const fadeIn = Math.min(1, (now - d.born) / 350);

          dropletPosAttr.setXYZ(activeCount, d.x, height - d.y, 2);
          dropletSizeAttr.setX(activeCount, Math.max(3, rr * DROPLET_PX_PER_R));
          dropletAlphaAttr.setX(activeCount, fadeIn * Math.min(1, fadeShrink));
          activeCount++;
        }

        // drawRange bounds the draw, so the tail of the buffer is never read —
        // there is nothing to clear and no reason to write to it.
        if (activeCount > 0) {
          dropletPosAttr.needsUpdate = true;
          dropletSizeAttr.needsUpdate = true;
          dropletAlphaAttr.needsUpdate = true;
        }
        dropletGeo.setDrawRange(0, activeCount);
      } else {
        if (droplets.length) droplets.length = 0;
        dropletGeo.setDrawRange(0, 0);
      }

      // --- B. Mist Diffusion Update ---
      const fogTarget = p.fog ? 1 : 0;
      if (fogMix !== fogTarget) {
        // ~2.5s to cross the full range, framerate-independent.
        fogMix += Math.sign(fogTarget - fogMix) * Math.min(Math.abs(fogTarget - fogMix), dt / 2.5);
      }

      const minDim = Math.min(width, height);
      const baseAlpha = MIST_PEAK_ALPHA * (0.7 + 0.3 * p.dusk01) * fogMix;

      mistBlobs.forEach((m) => {
        if (baseAlpha <= 0.001) {
          m.mesh.visible = false;
          return;
        }
        const travel = ((now / 1000 / m.crossSeconds + m.phase) % 1) * m.dir;
        const span = width + minDim * m.radius01 * 2;
        const x = ((((travel % 1) + 1) % 1) * span) - minDim * m.radius01;
        const breathe = Math.sin((now / 1000 / m.breathePeriodS + m.breathePhase) * Math.PI * 2) * 0.03 * height;
        const y = m.baseY01 * height + breathe;
        const r = minDim * m.radius01 * 2;

        m.mesh.position.set(x, height - y, 1);
        m.mesh.scale.set(r, r, 1);
        m.mesh.material.opacity = baseAlpha;
        m.mesh.visible = true;
      });

      // --- C. Wind Gust Streaks Update ---
      if (p.windKmh >= 30 && p.rain01 === 0) {
        if (now >= nextGustAt) {
          gusts.push(spawnGust(now));
          nextGustAt = now + (5 + Math.random() * 7) * 1000;
        }
        gusts = gusts.filter((g) => now - g.born < g.durationMs + 400);

        let lineIdx = 0;

        for (const g of gusts) {
          for (const s of g.streaks) {
            if (lineIdx >= MAX_GUST_LINES) break;
            const t = (now - g.born - s.delay) / g.durationMs;
            if (t < 0 || t > 1) continue;
            const eased = easeOutCubic(t);
            const x = eased * (width + s.len) - s.len;
            const y = g.bandY + s.y;
            // In and out over the streak's life, so nothing pops.
            const env = Math.sin(Math.PI * t);

            const tail = lineIdx * 2;
            const head = tail + 1;
            gustPosAttr.setXYZ(tail, x, height - y, 3);
            gustPosAttr.setXYZ(head, x + s.len, height - y, 3);
            // Bright at the leading edge, dissolving behind it: the shape a
            // streak of moving air actually has.
            gustColorAttr.setXYZW(tail, 1, 1, 1, env * 0.12);
            gustColorAttr.setXYZW(head, 1, 1, 1, env);
            lineIdx++;
          }
        }
        if (lineIdx > 0) {
          gustPosAttr.needsUpdate = true;
          gustColorAttr.needsUpdate = true;
        }
        gustGeo.setDrawRange(0, lineIdx * 2);
      } else {
        if (gusts.length) gusts = [];
        gustGeo.setDrawRange(0, 0);
      }

      /* Nothing to draw and nothing drawn last frame means the canvas already
         holds the correct (empty) image. The one frame after everything clears
         still renders, so the last droplet is erased rather than frozen. */
      const drawing = dropletGeo.drawRange.count > 0 || baseAlpha > 0.001 || gustGeo.drawRange.count > 0;
      if (drawing || drewLastFrame) renderer.render(scene, camera);
      drewLastFrame = drawing;
    };

    // --- 5. Resize & Visibility Handlers ------------------------------------
    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      if (w === width && h === height) return;
      width = w;
      height = h;

      // Only `right` and `top` move; `left`/`bottom` stay pinned at 0. This is
      // exactly why the frustum is authored y-up — see the note at the top.
      camera.right = w;
      camera.top = h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      drewLastFrame = true;
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

    // The container tracks the viewport but can also be resized by a layout
    // change that fires no window `resize` (orientation, panel reflow).
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    document.addEventListener("visibilitychange", onVisibility);
    rafId = requestAnimationFrame(frame);

    // --- 6. Disposal & Cleanup ----------------------------------------------
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);

      scene.clear();

      dropletGeo.dispose();
      dropletMat.dispose();
      dropletTexture.dispose();

      mistPlaneGeo.dispose();
      mistTexture.dispose();
      mistBlobs.forEach((m) => m.mesh.material.dispose());

      gustGeo.dispose();
      gustMat.dispose();

      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} aria-hidden className="absolute inset-0 h-full w-full pointer-events-none" />;
}
