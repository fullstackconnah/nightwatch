"use client";

/* THESIS: High-performance 3D atmospheric weather overlay powered by Three.js.
 *
 * Replaces 2D canvas drawing with a WebGLRenderer scene (instanced particle system,
 * fog sprite planes, and gust line segments). Runs with strict frame-budget gating (~24fps),
 * automatic tab-visibility pausing, and complete GPU resource disposal on unmount.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

const FRAME_BUDGET_MS = 1000 / 24;

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

/** Generates a soft radial droplet sprite texture for THREE.PointsMaterial */
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
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
  const texture = new THREE.CanvasTexture(canvas);
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

    let width = container.clientWidth;
    let height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // --- 1. Three.js Setup ----------------------------------------------------
    const scene = new THREE.Scene();

    // 2D orthographic projection matching container pixels (0..width, 0..height)
    const camera = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 1000);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    // --- 2. Shared Textures & Materials -------------------------------------
    const dropletTexture = createDropletTexture();
    const mistTexture = createMistTexture();

    // Droplets system (THREE.Points)
    const maxDroplets = 40;
    const dropletPositions = new Float32Array(maxDroplets * 3);
    const dropletSizes = new Float32Array(maxDroplets);
    const dropletOpacities = new Float32Array(maxDroplets);

    const dropletGeo = new THREE.BufferGeometry();
    dropletGeo.setAttribute("position", new THREE.BufferAttribute(dropletPositions, 3));
    dropletGeo.setAttribute("size", new THREE.BufferAttribute(dropletSizes, 1));
    dropletGeo.setAttribute("opacity", new THREE.BufferAttribute(dropletOpacities, 1));

    const dropletMat = new THREE.PointsMaterial({
      size: 16,
      map: dropletTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const dropletPoints = new THREE.Points(dropletGeo, dropletMat);
    scene.add(dropletPoints);

    // Fog / Mist System (Mesh planes with soft gradient textures)
    const mistPlaneGeo = new THREE.PlaneGeometry(1, 1);
    const mistBlobs: MistState[] = Array.from({ length: 5 }, (_, i) => {
      const mistMat = new THREE.MeshBasicMaterial({
        map: mistTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(mistPlaneGeo, mistMat);
      mesh.position.z = 1;
      scene.add(mesh);

      return {
        baseY01: 0.55 + (i / 4) * 0.35 + (Math.random() - 0.5) * 0.1,
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
    const maxGustLines = 32;
    const gustPositions = new Float32Array(maxGustLines * 6); // 2 vertices per line (x1,y1,z1, x2,y2,z2)
    const gustGeo = new THREE.BufferGeometry();
    gustGeo.setAttribute("position", new THREE.BufferAttribute(gustPositions, 3));
    const gustMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
    });
    const gustLines = new THREE.LineSegments(gustGeo, gustMat);
    scene.add(gustLines);

    // --- 3. Simulation State ------------------------------------------------
    const droplets: DropletState[] = [];
    let dropletSpawnAcc = 0;
    let gusts: GustState[] = [];
    let nextGustAt = performance.now() + (5 + Math.random() * 7) * 1000;

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

    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const frame = (now: number) => {
      if (!running) return;
      rafId = requestAnimationFrame(frame);

      if (now - lastFrame < FRAME_BUDGET_MS) return;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      const p = propsRef.current;
      const rgbColor = p.isDark ? 0xecf2fc : 0x283448;
      dropletMat.color.setHex(rgbColor);
      gustMat.color.setHex(rgbColor);

      // --- A. Rain Droplets Update ---
      if (p.rain01 > 0) {
        const targetCount = Math.round(6 + p.rain01 * 12);
        dropletSpawnAcc += dt * (targetCount / 3);
        dropletSpawnAcc = Math.min(dropletSpawnAcc, 3);
        while (dropletSpawnAcc >= 1 && droplets.length < targetCount) {
          droplets.push(spawnDroplet());
          dropletSpawnAcc -= 1;
        }

        const posAttr = dropletGeo.attributes.position as THREE.BufferAttribute;
        let activeCount = 0;

        for (let i = droplets.length - 1; i >= 0; i--) {
          const d = droplets[i];
          if (now >= d.wobbleUntil) {
            const targetV = (30 + d.r * 22) * (0.6 + p.rain01 * 0.6);
            d.vy += (targetV - d.vy) * Math.min(1, dt * 1.5);
            d.y += d.vy * dt;
            d.x += Math.sin(now / 400 + d.born) * d.vx * dt;
          }
          const age = (now - d.born) / 1000;
          const life = 6 + d.r;
          const fadeShrink = age > life * 0.7 ? 1 - (age - life * 0.7) / (life * 0.3) : 1;
          const rr = Math.max(0.3, d.r * Math.max(0, fadeShrink));

          if (d.y - rr > height || age > life || rr <= 0.3) {
            droplets.splice(i, 1);
            continue;
          }

          // Y is inverted in Three.js orthographic coordinates (top = 0, bottom = height)
          posAttr.setXYZ(activeCount, d.x, height - d.y, 2);
          activeCount++;
        }

        // Fill remaining buffer with zero/offscreen positions
        for (let i = activeCount; i < maxDroplets; i++) {
          posAttr.setXYZ(i, -9999, -9999, -9999);
        }
        posAttr.needsUpdate = true;
        dropletGeo.setDrawRange(0, activeCount);
      } else {
        if (droplets.length) droplets.length = 0;
        dropletGeo.setDrawRange(0, 0);
      }

      // --- B. Mist Diffusion Update ---
      const minDim = Math.min(width, height);
      const baseAlpha = 0.025 * (0.75 + 0.25 * p.dusk01);

      mistBlobs.forEach((m) => {
        if (p.fog) {
          const travel = ((now / 1000 / m.crossSeconds + m.phase) % 1) * m.dir;
          const x = ((travel % 1) + 1) % 1 * (width + minDim * m.radius01 * 2) - minDim * m.radius01;
          const breathe = Math.sin((now / 1000 / m.breathePeriodS + m.breathePhase) * Math.PI * 2) * 0.03 * height;
          const y = m.baseY01 * height + breathe;
          const r = minDim * m.radius01 * 2;

          m.mesh.position.set(x, height - y, 1);
          m.mesh.scale.set(r, r, 1);
          m.mesh.material.color.setHex(rgbColor);
          m.mesh.material.opacity = baseAlpha;
          m.mesh.visible = true;
        } else {
          m.mesh.visible = false;
        }
      });

      // --- C. Wind Gust Streaks Update ---
      if (p.windKmh >= 30 && p.rain01 === 0) {
        if (now >= nextGustAt) {
          gusts.push(spawnGust(now));
          nextGustAt = now + (5 + Math.random() * 7) * 1000;
        }
        gusts = gusts.filter((g) => now - g.born < g.durationMs + 400);

        const linePosAttr = gustGeo.attributes.position as THREE.BufferAttribute;
        let lineIdx = 0;

        for (const g of gusts) {
          for (const s of g.streaks) {
            if (lineIdx >= maxGustLines) break;
            const t = (now - g.born - s.delay) / g.durationMs;
            if (t < 0 || t > 1) continue;
            const eased = easeInOut(t);
            const x = eased * (width + s.len) - s.len;
            const y = g.bandY + s.y;

            linePosAttr.setXYZ(lineIdx * 2, x, height - y, 3);
            linePosAttr.setXYZ(lineIdx * 2 + 1, x + s.len, height - y, 3);
            lineIdx++;
          }
        }
        for (let i = lineIdx * 2; i < maxGustLines * 2; i++) {
          linePosAttr.setXYZ(i, -9999, -9999, -9999);
        }
        linePosAttr.needsUpdate = true;
        gustGeo.setDrawRange(0, lineIdx * 2);
      } else {
        if (gusts.length) gusts = [];
        gustGeo.setDrawRange(0, 0);
      }

      renderer.render(scene, camera);
    };

    // --- 5. Resize & Visibility Handlers ------------------------------------
    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      if (width === 0 || height === 0) return;

      camera.right = width;
      camera.top = height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
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

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    rafId = requestAnimationFrame(frame);

    // --- 6. Disposal & Cleanup ----------------------------------------------
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);

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
