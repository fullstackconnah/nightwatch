"use client";

/* THESIS: High-performance 3D atmospheric weather overlay powered by Three.js.
 *
 * One WebGLRenderer scene: rain streaks (one mesh of quads), a lightning
 * glow, droplets on the glass (points), fog banks (sprite planes) and gust
 * line segments. At most 9 draw calls a frame. Runs with strict frame-budget
 * gating (30fps in rain, ~24 otherwise), automatic tab-visibility pausing, a
 * single still frame under reduced motion (fog only), and complete GPU
 * resource disposal on unmount.
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
import {
  FLASH_PEAK_ALPHA,
  MAX_RAIN_STREAKS,
  flashEnvelope,
  leanAt,
  rainParams,
  sampleStreak,
  stepStrikes,
  type RainBand,
  type RainParams,
  type StreakSpec,
  type WetBand,
} from "@/lib/kiosk-weather-fx";

/* ~24fps when dry. On a 60Hz panel this lands on every third vsync (an even
   20fps) rather than jittering, and soft blobs and hairlines gain nothing from
   a higher rate. While rain falls it is 30fps: a 1500 px/s streak steps 75px a
   frame at 20fps. The 2ms tolerance stops vsync jitter dropping it back to 20. */
const FRAME_BUDGET_MS = 1000 / 24;
const RAIN_FRAME_BUDGET_MS = 1000 / 30 - 2;

const MAX_DROPLETS = 40;
const MAX_GUST_LINES = 32;
const MIST_BLOBS = 5;

/** Peak alpha of one mist blob before the dusk/fade multipliers. Blobs overlap,
 *  so the on-screen worst case is a small multiple of this — it stays inside
 *  the same 0.03–0.06 band kiosk-sunroom-weather.tsx's CSS cloud layer is
 *  verified in. Fog is a lightening, so it is pale on every ground: a white
 *  veil raises a pale ground's luminance and widens its gap to the dark ink,
 *  where the old dark fog narrowed it. */
const MIST_PEAK_ALPHA = { dark: 0.055, light: 0.07 };

/** Droplet peak opacity. The old 0.9 was about 15x louder than the streaks and
 *  drowned them. */
const DROPLET_OPACITY = { dark: 0.16, light: 0.12 };

/** How wet the glass gets per band; drizzle leaves it dry. */
const GLASS_WETNESS: Record<RainBand, number> = { none: 0, drizzle: 0, light: 0.4, moderate: 0.7, heavy: 1 };

/** Same argument for the gust streaks. These are 1px hairlines alive for under
 *  two seconds, not a full-viewport wash, so they need a higher number than the
 *  wash band to register at all; 0.04 was invisible. */
const GUST_PEAK_ALPHA = 0.13;

/** Droplet sprite radius (px) per unit of simulated droplet radius. The sprite
 *  texture's bright core is its inner ~40%, so the point has to be drawn
 *  several times larger than the droplet it depicts. */
const DROPLET_PX_PER_R = 2.6;

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
  band,
  storm,
  reduced,
  fog,
  windKmh,
  isDark,
  dusk01,
  firstStrikeMs,
}: {
  band: RainBand;
  storm: boolean;
  /** Reduced motion: no loop at all. Only fog mounts, drawn as one still frame. */
  reduced: boolean;
  fog: boolean;
  windKmh: number;
  isDark: boolean;
  dusk01: number;
  /** ?wx= preview only: the first strike lands this long after mount. */
  firstStrikeMs?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ band, storm, reduced, fog, windKmh, isDark, dusk01, firstStrikeMs });
  propsRef.current = { band, storm, reduced, fog, windKmh, isDark, dusk01, firstStrikeMs };
  const redrawRef = useRef<(() => void) | null>(null);
  // A still frame has no loop to pick up a change, and a stopped loop must
  // restart when reduced motion turns off; both go through redraw.
  useEffect(() => {
    redrawRef.current?.();
  }, [reduced, fog, isDark, dusk01]);

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

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      // No WebGL (blocked after GPU resets, or switched off): no rain layer; the CSS cloud and star layers stay.
      return;
    }
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
        uOpacity: { value: DROPLET_OPACITY.dark },
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

    /* Rain streaks: one mesh of indexed quads, one draw call for up to 400.
       Quads, not LineSegments, because WebGL line width is pinned at 1px on
       iPad Safari and the near band is 1.5px. RGBA vertex colour for the same
       reason as the gust lines: each streak fades from a clear tail to its
       head, which one material opacity cannot say. */
    const streakPositions = new Float32Array(MAX_RAIN_STREAKS * 4 * 3);
    const streakColors = new Float32Array(MAX_RAIN_STREAKS * 4 * 4);
    const streakIndex = new Uint16Array(MAX_RAIN_STREAKS * 6);
    for (let i = 0; i < MAX_RAIN_STREAKS; i++) {
      const v = i * 4;
      // Counter-clockwise on screen (y up): a clockwise quad is back-face culled and draws nothing.
      streakIndex.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const streakGeo = new THREE.BufferGeometry();
    const streakPosAttr = new THREE.BufferAttribute(streakPositions, 3).setUsage(THREE.DynamicDrawUsage);
    const streakColorAttr = new THREE.BufferAttribute(streakColors, 4).setUsage(THREE.DynamicDrawUsage);
    streakGeo.setAttribute("position", streakPosAttr);
    streakGeo.setAttribute("color", streakColorAttr);
    streakGeo.setIndex(new THREE.BufferAttribute(streakIndex, 1));
    streakGeo.setDrawRange(0, 0);
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xecf2fc,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const streakMesh = new THREE.Mesh(streakGeo, streakMat);
    streakMesh.frustumCulled = false;
    streakMesh.position.z = 2;
    scene.add(streakMesh);

    const mistPlaneGeo = new THREE.PlaneGeometry(1, 1);

    // Lightning: one soft glow from the mist sprite, hidden between strikes so
    // it costs no draw call.
    const flashMat = new THREE.MeshBasicMaterial({
      map: mistTexture,
      color: 0xecf2fc,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0,
    });
    const flashMesh = new THREE.Mesh(mistPlaneGeo, flashMat);
    flashMesh.frustumCulled = false;
    flashMesh.visible = false;
    flashMesh.position.z = 0.5;
    scene.add(flashMesh);

    // Fog / Mist System (Mesh planes with soft gradient textures)
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
    const mountedAt = performance.now();
    const droplets: DropletState[] = [];
    let dropletSpawnAcc = 0;
    const gusts: GustState[] = [];
    /* The first gust comes sooner than the steady-state cadence below. The
       layer only mounts once it is genuinely windy, and opening with 5–12s of
       empty screen reads as "nothing here" rather than as a lull. */
    let nextGustAt = performance.now() + (1 + Math.random() * 3) * 1000;
    /* Fog arrives and clears over minutes in the real world and over one SWR
       tick here. Without an eased mix, a 15-minute poll that flips `fog` makes
       five blobs appear at full strength between two frames. */
    let fogMix = 0;
    let lastDark: boolean | null = null;
    let drewLastFrame = true;

    // Streaks are packed: slots [0, live) are falling, the rest are free.
    const streaks: Array<StreakSpec & { x: number; y: number }> = [];
    let live = 0;
    let streakSpawnAcc = 0;
    let rainKey = "";
    let rp: RainParams | null = null;

    // Lightning schedule: armed when a storm starts, disarmed when it ends.
    const strikeClock = { nextAt: Infinity, firstUsed: false };
    let strike: { at: number; hold: number; double: boolean } | null = null;

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

    /** Puts streak `i` just above the top edge (or anywhere, for the first
     *  fill), across the upwind span a leaning field needs to fill its corner. */
    const placeStreak = (i: number, params: RainParams, band: WetBand, tanLean: number, scatter: boolean) => {
      const s = (streaks[i] ??= { depth: "far", speed: 0, length: 0, width: 1, aMult: 0, x: 0, y: 0 });
      Object.assign(s, sampleStreak(params, band, Math.random));
      s.y = scatter ? Math.random() * (height + s.length) : -Math.random() * height * 0.15;
      s.x = -height * tanLean + Math.random() * (width + height * tanLean);
      if (scatter) s.x += s.y * tanLean;
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

    // A gust enters fast and trails off; it does not ease into existence.
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const applyGround = (isDark: boolean) => {
      // setHex runs an sRGB->working-space conversion; it does not need to run
      // every frame to answer a boolean that changes twice a day.
      if (isDark === lastDark) return;
      lastDark = isDark;
      const ink = isDark ? 0xecf2fc : 0x283448;
      dropletMat.uniforms.uColor.value.setHex(ink);
      dropletMat.uniforms.uOpacity.value = isDark ? DROPLET_OPACITY.dark : DROPLET_OPACITY.light;
      gustMat.color.setHex(ink);
      streakMat.color.setHex(ink);
      // Fog is always a lightening; see MIST_PEAK_ALPHA.
      mistBlobs.forEach((m) => m.mesh.material.color.setHex(isDark ? 0xecf2fc : 0xffffff));
    };

    /** Moves the fog banks; returns the alpha drawn this frame (0 = none). */
    const updateMist = (now: number, dt: number, instant: boolean): number => {
      const p = propsRef.current;
      const fogTarget = p.fog ? 1 : 0;
      if (instant) fogMix = fogTarget;
      else if (fogMix !== fogTarget) {
        // ~2.5s to cross the full range, framerate-independent.
        fogMix += Math.sign(fogTarget - fogMix) * Math.min(Math.abs(fogTarget - fogMix), dt / 2.5);
      }

      const minDim = Math.min(width, height);
      const baseAlpha = (p.isDark ? MIST_PEAK_ALPHA.dark : MIST_PEAK_ALPHA.light) * (0.7 + 0.3 * p.dusk01) * fogMix;

      mistBlobs.forEach((m) => {
        if (baseAlpha <= 0.001) {
          m.mesh.visible = false;
          return;
        }
        const r = minDim * m.radius01 * 2;
        // Banks, not puffs: wide and flat. Travel runs a bank's own half width
        // past each edge so it never pops in.
        const halfW = r * 1.2;
        const travel = ((now / 1000 / m.crossSeconds + m.phase) % 1) * m.dir;
        const span = width + halfW * 2;
        const x = ((((travel % 1) + 1) % 1) * span) - halfW;
        const breathe = Math.sin((now / 1000 / m.breathePeriodS + m.breathePhase) * Math.PI * 2) * 0.03 * height;
        const y = m.baseY01 * height + breathe;

        m.mesh.position.set(x, height - y, 1);
        m.mesh.scale.set(r * 2.4, r * 0.8, 1);
        m.mesh.material.opacity = baseAlpha;
        m.mesh.visible = true;
      });
      return baseAlpha;
    };

    /** Reduced motion: fog at full strength, nothing else, one frame. */
    const renderStill = () => {
      applyGround(propsRef.current.isDark);
      droplets.length = 0;
      gusts.length = 0;
      live = 0;
      strike = null;
      dropletGeo.setDrawRange(0, 0);
      streakGeo.setDrawRange(0, 0);
      gustGeo.setDrawRange(0, 0);
      flashMesh.visible = false;
      updateMist(performance.now(), 0, true);
      renderer.render(scene, camera);
      drewLastFrame = true;
    };

    // --- 4. Render Loop (24fps dry, 30fps in rain) --------------------------
    let rafId = 0;
    let lastFrame = 0;
    let running = true;

    const frame = (now: number) => {
      if (!running) return;
      const p = propsRef.current;
      if (p.reduced) {
        stop();
        renderStill();
        return;
      }
      rafId = requestAnimationFrame(frame);

      if (now - lastFrame < (p.band === "none" ? FRAME_BUDGET_MS : RAIN_FRAME_BUDGET_MS)) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      applyGround(p.isDark);
      const mode = p.isDark ? "dark" : "light";

      // --- A. Rain streaks ---
      if (p.band !== "none") {
        const key = `${p.band}|${p.windKmh}|${width}|${height}`;
        if (key !== rainKey || !rp) {
          rainKey = key;
          rp = rainParams(p.band, p.windKmh, width, height);
        }
        const params = rp;
        const lean = (leanAt(params, now / 1000) * Math.PI) / 180;
        const sinL = Math.sin(lean);
        const cosL = Math.cos(lean);
        const tanL = sinL / cosL;
        const peak = params.alphaNear[mode];

        if (live === 0) {
          // Already raining when it appears: never a curtain entering from the top.
          for (; live < params.count; live++) placeStreak(live, params, p.band, tanL, true);
          streakSpawnAcc = 0;
        } else if (live < params.count) {
          // A heavier band fills in over about 3s, from the top.
          streakSpawnAcc = Math.min(streakSpawnAcc + (dt * params.count) / 3, params.count - live);
          for (; streakSpawnAcc >= 1; streakSpawnAcc--) placeStreak(live++, params, p.band, tanL, false);
        }

        for (let i = live - 1; i >= 0; i--) {
          const s = streaks[i];
          s.x += s.speed * sinL * dt;
          s.y += s.speed * cosL * dt;
          if (s.y - s.length * cosL <= height && s.x - s.length * sinL <= width) continue;
          // Off-screen. A lighter band lets the excess go rather than popping it.
          if (live > params.count) {
            live--;
            [streaks[i], streaks[live]] = [streaks[live], streaks[i]];
          } else placeStreak(i, params, p.band, tanL, false);
        }

        for (let i = 0; i < live; i++) {
          const s = streaks[i];
          const tx = s.x - s.length * sinL;
          const ty = s.y - s.length * cosL;
          // Half-width across the streak, perpendicular to its fall.
          const hx = (cosL * s.width) / 2;
          const hy = (-sinL * s.width) / 2;
          const v = i * 4;
          streakPosAttr.setXYZ(v, tx - hx, height - (ty - hy), 2);
          streakPosAttr.setXYZ(v + 1, tx + hx, height - (ty + hy), 2);
          streakPosAttr.setXYZ(v + 2, s.x - hx, height - (s.y - hy), 2);
          streakPosAttr.setXYZ(v + 3, s.x + hx, height - (s.y + hy), 2);
          // Clear at the tail, full at the head.
          const a = peak * s.aMult;
          streakColorAttr.setXYZW(v, 1, 1, 1, 0);
          streakColorAttr.setXYZW(v + 1, 1, 1, 1, 0);
          streakColorAttr.setXYZW(v + 2, 1, 1, 1, a);
          streakColorAttr.setXYZW(v + 3, 1, 1, 1, a);
        }
        if (live > 0) {
          streakPosAttr.needsUpdate = true;
          streakColorAttr.needsUpdate = true;
        }
        streakGeo.setDrawRange(0, live * 6);
      } else {
        live = 0;
        streakGeo.setDrawRange(0, 0);
      }

      // --- B. Lightning ---
      const started = stepStrikes(
        strikeClock,
        now,
        p.storm,
        Math.random,
        p.firstStrikeMs === undefined ? undefined : mountedAt + p.firstStrikeMs,
      );
      if (started) {
        strike = started;
        flashMesh.position.set((0.15 + Math.random() * 0.7) * width, height - Math.random() * 0.4 * height, 0.5);
        flashMesh.scale.set(width * 1.6, height * 1.2, 1);
      }
      const level = strike ? flashEnvelope(now - strike.at, strike) : 0;
      if (strike && level === 0 && now - strike.at > 100) strike = null;
      flashMesh.visible = level > 0;
      flashMat.opacity = level * FLASH_PEAK_ALPHA[mode];

      // --- C. Glass droplets ---
      const wet = GLASS_WETNESS[p.band];
      if (wet > 0) {
        const targetCount = Math.round(6 + wet * 12);
        dropletSpawnAcc += dt * (targetCount / 3);
        dropletSpawnAcc = Math.min(dropletSpawnAcc, 3);
        while (dropletSpawnAcc >= 1 && droplets.length < targetCount) {
          droplets.push(spawnDroplet());
          dropletSpawnAcc -= 1;
        }

        // Wind pushes water across the glass to the right, the way the rain leans.
        const windDrift = Math.min(60, p.windKmh) * 0.25;
        let activeCount = 0;

        for (let i = droplets.length - 1; i >= 0; i--) {
          const d = droplets[i];
          if (now >= d.wobbleUntil) {
            const targetV = (30 + d.r * 22) * (0.6 + wet * 0.6);
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

      // --- D. Mist ---
      const mistAlpha = updateMist(now, dt, false);

      // --- E. Wind gusts (dry only: in rain the lean already says it) ---
      if (p.windKmh >= 30 && p.band === "none") {
        if (now >= nextGustAt) {
          gusts.push(spawnGust(now));
          nextGustAt = now + (5 + Math.random() * 7) * 1000;
        }
        // Compact in place rather than allocating a filtered array every frame.
        let keep = 0;
        for (const g of gusts) if (now - g.born < g.durationMs + 400) gusts[keep++] = g;
        gusts.length = keep;

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
        if (gusts.length) gusts.length = 0;
        gustGeo.setDrawRange(0, 0);
      }

      /* Nothing to draw and nothing drawn last frame means the canvas already
         holds the correct (empty) image. The one frame after everything clears
         still renders, so the last droplet is erased rather than frozen. */
      const drawing =
        live > 0 || flashMesh.visible || dropletGeo.drawRange.count > 0 || mistAlpha > 0.001 || gustGeo.drawRange.count > 0;
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
      // setSize clears the canvas, and a still frame has no loop to repaint it.
      if (propsRef.current.reduced) renderStill();
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

    // Props changed: a still frame repaints, a live loop (re)starts.
    redrawRef.current = () => {
      if (document.hidden) return;
      if (propsRef.current.reduced) renderStill();
      else start();
    };

    // three re-uploads everything on restore; a still frame has no loop to repaint it.
    const onContextRestored = () => {
      if (propsRef.current.reduced) renderStill();
    };
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    const onVisibility = () => {
      if (document.hidden) stop();
      else redrawRef.current?.();
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
      redrawRef.current = null;
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);

      scene.clear();

      dropletGeo.dispose();
      dropletMat.dispose();
      dropletTexture.dispose();

      streakGeo.dispose();
      streakMat.dispose();
      flashMat.dispose();

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
