# Three.js Weather Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the kiosk sunroom weather particle effects layer to Three.js WebGL rendering with a 24 FPS frame budget and full resource disposal.

**Architecture:** Replace the 2D canvas particle loop in `KioskSunroomParticles` with a Three.js `WebGLRenderer` scene managing instanced droplets, fog particle planes, and wind gust streaks.

**Tech Stack:** React 19, Next.js 15, Three.js (`three`), TypeScript 5.

## Global Constraints
- Target frame budget: 24 FPS (~41.6ms per frame).
- Must automatically pause rAF when `document.hidden` is true or reduced motion is enabled.
- Must dispose geometries, materials, textures, and renderer context on unmount/resize.
- Quality gate: `npx tsc --noEmit` and `npm run build` must pass with zero errors.

---

### Task 1: Install Three.js Dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: npm package registry
- Produces: `three` and `@types/three` packages available in `node_modules`

- [ ] **Step 1: Install `three` and `@types/three`**

Run: `npm install three && npm install -D @types/three`
Expected: Success with `three` added to dependencies.

- [ ] **Step 2: Verify package.json contains three**

Check `package.json` for `"three"` dependency entry.

- [ ] **Step 3: Commit dependency changes**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add package.json package-lock.json
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "chore: add three and @types/three dependencies"
```

---

### Task 2: Implement Three.js Weather Particle Engine

**Files:**
- Modify: `src/components/kiosk-sunroom-particles.tsx`

**Interfaces:**
- Consumes: Props `rain01`, `fog`, `windKmh`, `isDark`, `dusk01` from `KioskSunroomWeather`
- Produces: Three.js `WebGLRenderer` particle system mounted on a canvas element

- [ ] **Step 1: Refactor `KioskSunroomParticles` with Three.js scene setup**

Update `src/components/kiosk-sunroom-particles.tsx` to set up:
- `THREE.WebGLRenderer` with `alpha: true`, `powerPreference: "low-power"`.
- `THREE.PerspectiveCamera` and `THREE.Scene`.
- Rain droplet particle system (`THREE.Points` with radial canvas gradient texture).
- Fog mist particle planes (`THREE.Sprite` or low-poly quad planes) with breathing sine wave oscillation.
- Wind gust streak line segments (`THREE.LineSegments`).
- 24 FPS frame budget gate (`FRAME_BUDGET_MS = 1000 / 24`).
- Visibility listener (`visibilitychange`) to freeze rendering when `document.hidden`.
- Proper cleanup disposing all geometries, materials, textures, and renderer on unmount.

- [ ] **Step 2: Check TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit Three.js implementation**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add src/components/kiosk-sunroom-particles.tsx
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "feat: implement Three.js weather particle engine in KioskSunroomParticles"
```

---

### Task 3: Build Verification & Deployment Gate

**Files:**
- Build check: `personal/homelab-dashboard`

- [ ] **Step 1: Run full production build**

Run: `npm run build`
Expected: Next.js build finishes cleanly without compilation or type errors.

- [ ] **Step 2: Commit any final build fixes if needed**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard status
```
