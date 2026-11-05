"use client";

/* THESIS: High-performance 3D atmospheric weather overlay powered by Three.js.
 *
 * One WebGLRenderer scene: rain streaks (one mesh of quads), the puddle line
 * (rings on the wet floor, crowns on the forecast panel, a floor sheen: one
 * mesh), a lightning glow, fog banks (sprite planes) and gust line segments.
 * At most 9 draw calls a frame.
 * Runs with strict frame-budget gating (30fps in rain, ~24 otherwise),
 * automatic tab-visibility pausing, a single still frame under reduced motion
 * (the wet-floor sheen when it rains, plus fog), and complete GPU resource
 * disposal on unmount.
 *
 * ZONE-MASK CONTRACT. The loud marks (rings, crowns, the dark sheen) never
 * reach glance text or a floor control: the glance clock, the below-band stack,
 * light/timer row, Admin button and now-playing pill carry `data-rain-zone`
 * (slots: kiosk-weather-fx.ts RAIN_ZONE_SLOT), their rects are read into a mask,
 * and rings are masked to 0 inside them (and not spawned within 12 px).
 * Streaks and gust lines are multiplied by it too (streaks keep a floor,
 * gust lines go to 0). So the text gate is the zone floors, not low alphas;
 * see kiosk-weather-fx.ts (PUDDLE) and its tests.
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
  PUDDLE,
  flashEnvelope,
  leanAt,
  puddleParams,
  rainParams,
  hasGlanceZones,
  RAIN_ZONE_COUNT,
  RAIN_ZONE_SLOT,
  ringSpawnOk,
  sampleStreak,
  stepStrikes,
  zoneMask,
  type PuddleParams,
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

const MAX_GUST_LINES = 32;
const MIST_BLOBS = 5;

/** Peak alpha of one mist blob before the dusk/fade multipliers. Blobs overlap,
 *  so the on-screen worst case is a small multiple of this — it stays inside
 *  the same 0.03–0.06 band kiosk-sunroom-weather.tsx's CSS cloud layer is
 *  verified in. Fog is a lightening, so it is pale on every ground: a white
 *  veil raises a pale ground's luminance and widens its gap to the dark ink,
 *  where the old dark fog narrowed it. */
const MIST_PEAK_ALPHA = { dark: 0.055, light: 0.07 };

/** Same argument for the gust streaks. These are 1px hairlines alive for under
 *  two seconds, not a full-viewport wash, so they need a higher number than the
 *  wash band to register at all; 0.04 was invisible. */
const GUST_PEAK_ALPHA = 0.13;

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

/* The puddle line: one ShaderMaterial for rings (kind 2 + sigma offset), crown
   blobs (kind 3) and the floor sheen (kind 4). The zone mask runs per fragment
   on `vP`, the vertex's CSS-px position with y DOWN (the simulation's own
   coordinates, recovered from the scene's y-up position and the stage height).
   Never gl_FragCoord: that is in device pixels with y up. Output is
   premultiplied; the colour-space step runs before the alpha multiply. */
const PUDDLE_VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aKind;
  attribute float aFloor;
  uniform float uHeight;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vFloor;
  varying vec2 vP;
  void main() {
    vUv = uv;
    vColor = aColor;
    vKind = aKind;
    vFloor = aFloor;
    vP = vec2( position.x, uHeight - position.y );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const PUDDLE_FRAG = /* glsl */ `
  uniform vec4 uZones[${RAIN_ZONE_COUNT}];
  uniform float uFeather;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vFloor;
  varying vec2 vP;
  void main() {
    float a = vColor.a;
    float d = length( vUv * 2.0 - 1.0 );
    if ( vKind < 3.5 ) {
      if ( d > 1.0 ) discard;
      if ( vKind < 2.5 ) {
        float r = ( d - 0.84 ) / ( 0.09 + ( vKind - 2.0 ) * 0.1 );
        a *= exp( -r * r );
      } else {
        float f = 1.0 - d * d;
        a *= f * f;
      }
    }
    float m = 1.0;
    for ( int i = 0; i < ${RAIN_ZONE_COUNT}; i++ ) {
      vec4 z = uZones[i];
      vec2 dd = max( max( z.xy - vP, vP - z.zw ), 0.0 );
      m = min( m, smoothstep( 0.0, uFeather, length( dd ) ) );
    }
    a *= mix( vFloor, 1.0, m );
    if ( a < 0.002 ) discard;
    gl_FragColor = vec4( vColor.rgb, a );
    #include <colorspace_fragment>
    gl_FragColor.rgb *= a;
  }
`;

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
  /** Reduced motion: no loop at all. One still frame: the wet-floor sheen when it rains, plus fog. */
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
  // restart when reduced motion turns off; both go through redraw. A band or
  // storm change also re-reads the zone rects there.
  useEffect(() => {
    redrawRef.current?.();
  }, [reduced, fog, isDark, dusk01, band, storm]);

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
    const mistTexture = createMistTexture();

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

    /* The puddle line: rings on the wet floor, crowns on the forecast panel's
       top edge and a floor sheen, in ONE mesh of up to 192 indexed quads.
       WINDING: three culls clockwise (FrontSide) triangles, so every quad is
       counter-clockwise in the y-up scene: corners 0 bottom-left, 1 bottom-right,
       2 top-left, 3 top-right, triangles (0,1,2) and (2,1,3). Drawn just under
       the streaks (z 1.5 against 2), over the fog (z 1). */
    const PQ = PUDDLE.poolQuads;
    const puddlePositions = new Float32Array(PQ * 4 * 3);
    const puddleUvs = new Float32Array(PQ * 4 * 2);
    const puddleColors = new Float32Array(PQ * 4 * 4);
    const puddleKinds = new Float32Array(PQ * 4);
    const puddleFloors = new Float32Array(PQ * 4);
    const puddleIndex = new Uint16Array(PQ * 6);
    for (let i = 0; i < PQ; i++) {
      const v = i * 4;
      puddleIndex.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
      puddleUvs.set([0, 0, 1, 0, 0, 1, 1, 1], v * 2);
    }
    const puddleGeo = new THREE.BufferGeometry();
    const puddlePosAttr = new THREE.BufferAttribute(puddlePositions, 3).setUsage(THREE.DynamicDrawUsage);
    const puddleColorAttr = new THREE.BufferAttribute(puddleColors, 4).setUsage(THREE.DynamicDrawUsage);
    const puddleKindAttr = new THREE.BufferAttribute(puddleKinds, 1).setUsage(THREE.DynamicDrawUsage);
    const puddleFloorAttr = new THREE.BufferAttribute(puddleFloors, 1).setUsage(THREE.DynamicDrawUsage);
    puddleGeo.setAttribute("position", puddlePosAttr);
    puddleGeo.setAttribute("uv", new THREE.BufferAttribute(puddleUvs, 2));
    puddleGeo.setAttribute("aColor", puddleColorAttr);
    puddleGeo.setAttribute("aKind", puddleKindAttr);
    puddleGeo.setAttribute("aFloor", puddleFloorAttr);
    puddleGeo.setIndex(new THREE.BufferAttribute(puddleIndex, 1));
    puddleGeo.setDrawRange(0, 0);
    // RAIN_ZONE_COUNT zone rects in CSS px, y down; unused slots sit far off-stage, where the mask is 1.
    const uZones = Array.from({ length: RAIN_ZONE_COUNT }, () => new THREE.Vector4());
    const puddleMat = new THREE.ShaderMaterial({
      uniforms: { uZones: { value: uZones }, uFeather: { value: PUDDLE.feather }, uHeight: { value: height } },
      vertexShader: PUDDLE_VERT,
      fragmentShader: PUDDLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat);
    puddleMesh.frustumCulled = false;
    puddleMesh.position.z = 1.5;
    scene.add(puddleMesh);

    /* Zone rects (glance text) and the forecast panel, read from the DOM tags
       `data-rain-zone` / `data-rain-panel`. Same-named elements are unioned (every
       widget in the glance centre column shares the "sentence" zone). Re-read on mount, on
       container resize, on a prop change and then at most once a second from the
       frame loop, so tags that appear late (weather data), vanish or move
       (glance <-> full) are picked up within a second. */
    const NZ = RAIN_ZONE_COUNT;
    const zoneRects = new Float32Array(NZ * 4);
    const panelRect = new Float32Array(4);
    let panelOk = false;
    let glance = false;
    let rectsAt = 0;
    const readRects = () => {
      rectsAt = performance.now();
      const o = container.getBoundingClientRect();
      for (let i = 0; i < NZ; i++) {
        zoneRects[i * 4] = zoneRects[i * 4 + 1] = Infinity;
        zoneRects[i * 4 + 2] = zoneRects[i * 4 + 3] = -Infinity;
      }
      document.querySelectorAll<HTMLElement>("[data-rain-zone]").forEach((el) => {
        const slot = RAIN_ZONE_SLOT[el.dataset.rainZone as keyof typeof RAIN_ZONE_SLOT];
        const r = el.getBoundingClientRect();
        if (slot === undefined || r.width * r.height === 0) return;
        const k = slot * 4;
        zoneRects[k] = Math.min(zoneRects[k], r.left - o.left);
        zoneRects[k + 1] = Math.min(zoneRects[k + 1], r.top - o.top);
        zoneRects[k + 2] = Math.max(zoneRects[k + 2], r.right - o.left);
        zoneRects[k + 3] = Math.max(zoneRects[k + 3], r.bottom - o.top);
      });
      for (let i = 0; i < NZ; i++) {
        const k = i * 4;
        if (zoneRects[k] === Infinity) zoneRects.fill(-1e5, k, k + 4);
        uZones[i].set(zoneRects[k], zoneRects[k + 1], zoneRects[k + 2], zoneRects[k + 3]);
      }
      glance = hasGlanceZones(zoneRects);
      const panel = document.querySelector<HTMLElement>("[data-rain-panel]")?.getBoundingClientRect();
      panelOk = !!panel && panel.width > 40;
      if (panel) {
        panelRect[0] = panel.left - o.left;
        panelRect[1] = panel.top - o.top;
        panelRect[2] = panel.right - o.left;
        panelRect[3] = panel.bottom - o.top;
      }
    };

    // One quad into the pool, in simulation coordinates (y down). aTop/aBot are the alpha at the quad's top and bottom edge.
    let pq = 0;
    const putQuad = (
      x0: number,
      yTop: number,
      x1: number,
      yBot: number,
      c: THREE.Color,
      aTop: number,
      aBot: number,
      kind: number,
      floor: number,
    ) => {
      if (pq >= PQ) return;
      const v = pq++ * 4;
      const yb = height - yBot;
      const yt = height - yTop;
      puddlePosAttr.setXYZ(v, x0, yb, 0);
      puddlePosAttr.setXYZ(v + 1, x1, yb, 0);
      puddlePosAttr.setXYZ(v + 2, x0, yt, 0);
      puddlePosAttr.setXYZ(v + 3, x1, yt, 0);
      puddleColorAttr.setXYZW(v, c.r, c.g, c.b, aBot);
      puddleColorAttr.setXYZW(v + 1, c.r, c.g, c.b, aBot);
      puddleColorAttr.setXYZW(v + 2, c.r, c.g, c.b, aTop);
      puddleColorAttr.setXYZW(v + 3, c.r, c.g, c.b, aTop);
      for (let k = 0; k < 4; k++) {
        puddleKindAttr.setX(v + k, kind);
        puddleFloorAttr.setX(v + k, floor);
      }
    };

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
    // Puddle line state: typed arrays sized once at their pool maximum, packed [0, count), swap-removed.
    const ringX = new Float32Array(PUDDLE.poolRings);
    const ringY = new Float32Array(PUDDLE.poolRings);
    const ringR = new Float32Array(PUDDLE.poolRings);
    const ringAge = new Float32Array(PUDDLE.poolRings);
    const ringLife = new Float32Array(PUDDLE.poolRings);
    let ringCount = 0;
    let ringAcc = 0;
    const crownX = new Float32Array(PUDDLE.poolCrowns);
    const crownY = new Float32Array(PUDDLE.poolCrowns);
    const crownVx = new Float32Array(PUDDLE.poolCrowns);
    const crownVy = new Float32Array(PUDDLE.poolCrowns);
    const crownAge = new Float32Array(PUDDLE.poolCrowns);
    let crownCount = 0;
    let crownAcc = 0;
    let pp0 = { band: "none" as WetBand, storm: false, isDark: false, w: 0, h: 0 };
    let pp: PuddleParams | null = null;
    // Mark colours, linear working space like every other colour here.
    const whiteInk = new THREE.Color(0xffffff);
    const dayInk = new THREE.Color(0x283448);
    const nightInk = new THREE.Color(0xecf2fc);
    // ?wx= preview only: time the puddle step, log once.
    let timeSum = 0;
    let timeMax = 0;
    let timeN = 0;
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
      gustMat.color.setHex(ink);
      streakMat.color.setHex(ink);
      // Fog is always a lightening; see MIST_PEAK_ALPHA.
      mistBlobs.forEach((m) => m.mesh.material.color.setHex(isDark ? 0xecf2fc : 0xffffff));
    };

    const getPuddle = (band: WetBand, storm: boolean, isDark: boolean): PuddleParams => {
      if (!pp || band !== pp0.band || storm !== pp0.storm || isDark !== pp0.isDark || width !== pp0.w || height !== pp0.h) {
        pp0 = { band, storm, isDark, w: width, h: height };
        pp = puddleParams(band, storm, isDark, width, height);
      }
      return pp;
    };

    /** True when (x, y) is inside a zone rect grown by `g` px. */
    const inGrownZone = (x: number, y: number, g: number): boolean => {
      for (let i = 0; i < NZ * 4; i += 4) {
        if (x > zoneRects[i] - g && x < zoneRects[i + 2] + g && y > zoneRects[i + 1] - g && y < zoneRects[i + 3] + g) return true;
      }
      return false;
    };

    /** The wet-floor sheen quad: full width, 0.70H to H, clear at the top. */
    const putSheen = (q: PuddleParams, isDark: boolean, still = false) =>
      still
        ? putQuad(0, height * 0.7, width, height, isDark ? nightInk : dayInk, 0, q.stillSheenAlpha, 4, q.stillSheenFloor)
        : putQuad(0, height * 0.7, width, height, isDark ? nightInk : whiteInk, 0, q.sheenAlpha, 4, q.sheenFloor);

    const flushPuddle = () => {
      if (pq > 0) {
        puddlePosAttr.needsUpdate = true;
        puddleColorAttr.needsUpdate = true;
        puddleKindAttr.needsUpdate = true;
        puddleFloorAttr.needsUpdate = true;
      }
      puddleGeo.setDrawRange(0, pq * 6);
    };

    /** One frame of the puddle line: sheen, rings, crowns. No allocation. */
    const stepPuddle = (dt: number, q: PuddleParams, isDark: boolean, timed: boolean) => {
      const t0 = timed ? performance.now() : 0;
      const sc = Math.min(width / 1280, height / 800);
      const mark = isDark ? nightInk : dayInk;
      pq = 0;
      putSheen(q, isDark);

      // Rings: spawn on the floor band, away from the text zones (20 tries, then skip).
      ringAcc = Math.min(ringAcc + q.ringRate * dt, 8);
      for (; ringAcc >= 1; ringAcc--) {
        if (!glance || ringCount >= PUDDLE.poolRings) continue; // the hub has no quiet gaps, so no rings
        for (let tries = 0; tries < 20; tries++) {
          const y = height * (0.75 + 0.25 * Math.sqrt(Math.random()));
          const persp = 0.6 + (0.4 * (y - height * 0.75)) / (height * 0.25);
          const r = (q.ringR0 + q.ringRSpan * Math.random()) * persp;
          const x = Math.random() * width;
          if (!ringSpawnOk(x, y, r, zoneRects, NZ)) continue;
          ringX[ringCount] = x;
          ringY[ringCount] = y;
          ringR[ringCount] = r;
          ringAge[ringCount] = 0;
          ringLife[ringCount] = q.ringLife;
          ringCount++;
          break;
        }
      }
      for (let i = ringCount - 1; i >= 0; i--) {
        ringAge[i] += dt;
        const p = ringAge[i] / ringLife[i];
        if (p >= 1) {
          const last = --ringCount;
          ringX[i] = ringX[last];
          ringY[i] = ringY[last];
          ringR[i] = ringR[last];
          ringAge[i] = ringAge[last];
          ringLife[i] = ringLife[last];
          continue;
        }
        const rx = ringR[i] * (1 - (1 - p) * (1 - p)) + 1.5;
        const ry = 0.3 * rx + 1;
        // One fade for day and night: a soft attack, then a linear fade.
        const fall = Math.min(1, p / 0.08) * (1 - p);
        if (q.ringCrest) {
          const sx = rx * 0.86;
          const sy = 0.26 * sx + 1;
          const cy = ringY[i] + PUDDLE.ringCrestDy;
          const a = q.ringCrestAlpha * fall;
          putQuad(ringX[i] - sx, cy - sy, ringX[i] + sx, cy + sy, whiteInk, a, a, q.ringKind, 0);
        }
        const a = q.ringAlpha * fall;
        putQuad(ringX[i] - rx, ringY[i] - ry, ringX[i] + rx, ringY[i] + ry, mark, a, a, q.ringKind, 0);
      }

      // Crowns: three blobs thrown up off the forecast panel's top edge.
      if (panelOk && glance) {
        crownAcc = Math.min(crownAcc + q.crownRate * dt, 8);
        for (; crownAcc >= 1; crownAcc--) {
          const x = panelRect[0] + 20 + Math.random() * Math.max(0, panelRect[2] - panelRect[0] - 40);
          for (let k = 0; k < 3 && crownCount < PUDDLE.poolCrowns; k++, crownCount++) {
            crownX[crownCount] = x;
            crownY[crownCount] = panelRect[1] - 1;
            crownVx[crownCount] = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 40) * sc;
            crownVy[crownCount] = -(120 + Math.random() * 100) * sc;
            crownAge[crownCount] = 0;
          }
        }
      } else crownCount = 0;
      const rad = PUDDLE.crownRadius * Math.max(sc, 0.5);
      for (let i = crownCount - 1; i >= 0; i--) {
        crownAge[i] += dt;
        crownVy[i] += 900 * sc * dt;
        crownX[i] += crownVx[i] * dt;
        crownY[i] += crownVy[i] * dt;
        if (crownY[i] > panelRect[1] || crownAge[i] >= PUDDLE.crownLife || inGrownZone(crownX[i], crownY[i], 8)) {
          const last = --crownCount;
          crownX[i] = crownX[last];
          crownY[i] = crownY[last];
          crownVx[i] = crownVx[last];
          crownVy[i] = crownVy[last];
          crownAge[i] = crownAge[last];
          continue;
        }
        const a = q.crownAlpha * (1 - crownAge[i] / PUDDLE.crownLife);
        putQuad(crownX[i] - rad, crownY[i] - rad, crownX[i] + rad, crownY[i] + rad, isDark ? nightInk : dayInk, a, a, 3, PUDDLE.crownFloor);
      }
      flushPuddle();

      if (timed) {
        const ms = performance.now() - t0;
        timeSum += ms;
        timeMax = Math.max(timeMax, ms);
        if (++timeN === 150) console.info(`[wx] puddle step ${(timeSum / timeN).toFixed(2)} ms avg, ${timeMax.toFixed(2)} ms max, ${pq} quads`);
      }
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

    /** Reduced motion: the still wet floor (the sheen alone, when it rains) and
     *  fog at full strength, one frame. No rings, crowns, streaks or flash. */
    const renderStill = () => {
      const p = propsRef.current;
      readRects(); // zones may have moved since mount; the still frame is never redrawn by the loop
      applyGround(p.isDark);
      gusts.length = 0;
      live = 0;
      ringCount = crownCount = 0;
      strike = null;
      streakGeo.setDrawRange(0, 0);
      gustGeo.setDrawRange(0, 0);
      flashMesh.visible = false;
      pq = 0;
      if (p.band !== "none") putSheen(getPuddle(p.band, p.storm, p.isDark), p.isDark, true);
      flushPuddle();
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
      if (now - rectsAt > 1000) readRects();

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
        const pq0 = getPuddle(p.band, p.storm, p.isDark);
        const lean = (leanAt(params, now / 1000) * Math.PI) / 180;
        const sinL = Math.sin(lean);
        const cosL = Math.cos(lean);
        const tanL = sinL / cosL;
        const peak = params.alphaNear[mode];

        if (live === 0) {
          // Already raining when it appears: never a curtain entering from the top.
          for (; live < pq0.streakCount; live++) placeStreak(live, params, p.band, tanL, true);
          streakSpawnAcc = 0;
        } else if (live < pq0.streakCount) {
          // A heavier band fills in over about 3s, from the top.
          streakSpawnAcc = Math.min(streakSpawnAcc + (dt * pq0.streakCount) / 3, pq0.streakCount - live);
          for (; streakSpawnAcc >= 1; streakSpawnAcc--) placeStreak(live++, params, p.band, tanL, false);
        }

        for (let i = live - 1; i >= 0; i--) {
          const s = streaks[i];
          s.x += s.speed * sinL * dt;
          s.y += s.speed * cosL * dt;
          if (s.y - s.length * cosL <= height && s.x - s.length * sinL <= width) continue;
          // Off-screen. A lighter band lets the excess go rather than popping it.
          if (live > pq0.streakCount) {
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
          /* Quieter near glance text: the streak's alpha takes the smallest zone
             mask of its head, middle and tail, so no pixel inside a zone can
             exceed peak x floor (the contrast gate's assumption). */
          const mask = glance
            ? Math.min(
                zoneMask(s.x, s.y, zoneRects, NZ),
                zoneMask((s.x + tx) / 2, (s.y + ty) / 2, zoneRects, NZ),
                zoneMask(tx, ty, zoneRects, NZ),
              )
            : 0; // the hub: zone floor everywhere
          // Clear at the tail, full at the head.
          const a = peak * s.aMult * (pq0.streakFloor + (1 - pq0.streakFloor) * mask);
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
        stepPuddle(dt, pq0, p.isDark, p.firstStrikeMs !== undefined);
      } else {
        live = 0;
        streakGeo.setDrawRange(0, 0);
        ringCount = crownCount = 0;
        ringAcc = crownAcc = 0;
        pq = 0;
        flushPuddle();
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
            // Out of every text zone by construction: floor 0 on the mask.
            gustColorAttr.setXYZW(tail, 1, 1, 1, env * 0.12 * zoneMask(x, y, zoneRects, NZ));
            gustColorAttr.setXYZW(head, 1, 1, 1, env * zoneMask(x + s.len, y, zoneRects, NZ));
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
         still renders, so the last frame is erased rather than frozen. */
      const drawing =
        live > 0 || flashMesh.visible || puddleGeo.drawRange.count > 0 || mistAlpha > 0.001 || gustGeo.drawRange.count > 0;
      if (drawing || drewLastFrame) renderer.render(scene, camera);
      drewLastFrame = drawing;
    };

    // --- 5. Resize & Visibility Handlers ------------------------------------
    const resize = () => {
      readRects();
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
      puddleMat.uniforms.uHeight.value = h;
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
      readRects();
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
    readRects();
    rafId = requestAnimationFrame(frame);

    // --- 6. Disposal & Cleanup ----------------------------------------------
    return () => {
      stop();
      redrawRef.current = null;
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);

      scene.clear();

      streakGeo.dispose();
      streakMat.dispose();
      puddleGeo.dispose();
      puddleMat.dispose();
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
