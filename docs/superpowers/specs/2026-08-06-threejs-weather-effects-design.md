# Design Spec: Three.js Weather Particle System for Kiosk Sunroom

## Objective
Upgrade the `KioskSunroomParticles` component in `personal/homelab-dashboard` from Canvas 2D to Three.js (`three`), delivering high-quality 3D particle glass droplets, mist diffusion, and wind gust streaks while preserving strict low-power kiosk constraints (24 FPS frame budget, resource cleanup, reduced-motion pause).

## Dependencies
- Package: `three` (latest v0.170+)
- DevDependency: `@types/three`

## Component Structure & Architecture
- **Location:** `src/components/kiosk-sunroom-particles.tsx`
- **Props Interface:**
  - `rain01: number` (0 to 1 intensity)
  - `fog: boolean`
  - `windKmh: number`
  - `isDark: boolean`
  - `dusk01: number`
- **Render Engine:**
  - `THREE.WebGLRenderer` (alpha: true, antialias: false for low power consumption, powerPreference: "low-power")
  - `THREE.PerspectiveCamera` (fov 45, aspect matched to container)
  - `THREE.Scene` with transparent background

## Visual Effects & Particle Systems
1. **Glass Droplets (Rain):**
   - Instanced particle system (`THREE.Points` or sprite buffer geometry).
   - Radial opacity texture map mimicking condensation beads.
   - Per-particle state: position (x, y, z), velocity, wobble timer, sliding acceleration down the glass plane.
2. **Mist & Fog Diffusion:**
   - Alpha-blended quad planes (`THREE.Sprite` or low-poly plane meshes) positioned in 3D depth space.
   - Low-speed horizontal drift + breathing sine wave oscillation.
   - Opacity scaled to weather `fog` state and civil twilight `dusk01` parameter.
3. **Wind Gust Streaks:**
   - Instanced streak segments (`THREE.LineSegments` or stretched billboards).
   - Eased translation across X-axis when `windKmh >= 30` and `rain01 === 0`.

## Lifecycle & Performance Constraints
- **Frame Rate Cap:** 24 FPS budget (`1000 / 24` ms frame delta gate).
- **Tab Visibility Handling:** Attach `visibilitychange` listener; pause rAF loop completely when `document.hidden` is true.
- **Resource Disposal:** On unmount or resize re-initialization, call `.dispose()` on all geometries, materials, and textures, and `.dispose()` on `WebGLRenderer`.
- **Memory Footprint:** Buffer attributes pre-allocated; no per-frame object instantiations inside rAF.

## Verification Gate
- `npx tsc --noEmit` checks without errors.
- `npm run build` succeeds cleanly.
