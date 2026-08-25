# AC Auto-Off (Nightly Sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kiosk-configured nightly schedule that turns off any Home Assistant AC (`climate.*` entity) still running at a set time, with a 5-minute warning banner and a "skip tonight" escape.

**Architecture:** Client-side engine in the always-open kiosk tab (the house pattern — no server daemons). Pure schedule math in a testable lib module; persisted config in `data/config.json` behind a new validated public kiosk route; a hook in the kiosk hub fires one off-volley per night through the existing `/kiosk/api/ha/action` allowlist; UI is a Climate-header pill → settings sheet (container-transform overlay) plus an inline warning strip.

**Tech Stack:** Next.js 15 / React 19 / Tailwind v4, SWR, lucide-react, node:test (`--experimental-strip-types`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-ac-auto-off-design.md`

## Global Constraints

- Every git command needs `-c safe.directory=F:/Projects/personal/homelab-dashboard` (dubious-ownership abort otherwise).
- No new runtime dependencies (PRODUCT.md).
- Quality gate: `npx tsc --noEmit && npm run build`. **Never run `npm run build` while the dev server is running** (shared `.next`).
- Tests: `node --test --experimental-strip-types <file>` (see `src/lib/cache.test.ts` for house style — relative imports include the `.ts` extension).
- Kiosk is OWN-WORLD: use `.panel`, `.microlabel`, `.kiosk-press`, token colors (`text-accent`, `text-ink`, `text-ink-dim`, `text-warn`), never components from `/settings` or `/smarthome`. `text-ink-faint` is **never** used on an interactive control's own label (WCAG headroom rule in CLAUDE.md).
- Touch targets ≥ 44px (`h-11`).
- Never write a literal NUL byte into a `.ts` file (git will classify the file binary).
- Commit message footer (every commit):
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011qTkfw2L9KjTAzvZesDNyh
  ```

---

### Task 1: Pure schedule math + POST validator, with tests

**Files:**
- Create: `src/lib/climate-auto-off.ts`
- Test: `src/lib/climate-auto-off.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — no React, no Node APIs, no imports).
- Produces (used by Tasks 2, 3, 4):
  - `interface ClimateAutoOffConfig { enabled: boolean; time: string; skipDate?: string; lastRunDate?: string }`
  - `interface SweepWindow { dateKey: string; startMs: number; endMs: number }`
  - `type AutoOffStatus = { kind: "off" } | { kind: "scheduled"; window: SweepWindow } | { kind: "skipped"; window: SweepWindow } | { kind: "done" }`
  - `interface ClimateAutoOffPatch { enabled?: boolean; time?: string; skipDate?: string | null; lastRunDate?: string }`
  - `SWEEP_WINDOW_MS`, `WARN_LEAD_MS`, `DEFAULT_AUTO_OFF_TIME`
  - `parseTime(time: string): { hour: number; minute: number } | null`
  - `localDateKey(d: Date): string`
  - `activeWindow(now: Date, time: string): SweepWindow | null`
  - `upcomingWindow(now: Date, time: string): SweepWindow | null`
  - `shouldFire(cfg: ClimateAutoOffConfig, now: Date): SweepWindow | null`
  - `warnWindow(cfg: ClimateAutoOffConfig, now: Date): SweepWindow | null`
  - `statusFor(cfg: ClimateAutoOffConfig, now: Date): AutoOffStatus`
  - `parseClimateAutoOffPatch(value: unknown): ClimateAutoOffPatch | { error: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/climate-auto-off.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeWindow,
  localDateKey,
  parseClimateAutoOffPatch,
  parseTime,
  shouldFire,
  statusFor,
  upcomingWindow,
  warnWindow,
  type ClimateAutoOffConfig,
} from "./climate-auto-off.ts";

/** All date math is LOCAL time — construct via the local Date constructor,
 *  never ISO strings, so these tests are timezone-independent. */
const at = (h: number, m: number, day = 23) => new Date(2026, 7, day, h, m);

const cfg = (over: Partial<ClimateAutoOffConfig> = {}): ClimateAutoOffConfig => ({
  enabled: true,
  time: "23:00",
  ...over,
});

describe("parseTime", () => {
  it("parses valid 24h times", () => {
    assert.deepEqual(parseTime("23:00"), { hour: 23, minute: 0 });
    assert.deepEqual(parseTime("00:15"), { hour: 0, minute: 15 });
  });
  it("rejects malformed times", () => {
    assert.equal(parseTime("24:00"), null);
    assert.equal(parseTime("9:00"), null);
    assert.equal(parseTime("23:60"), null);
    assert.equal(parseTime(""), null);
  });
});

describe("activeWindow", () => {
  it("is null before the scheduled time", () => {
    assert.equal(activeWindow(at(22, 0), "23:00"), null);
  });
  it("covers the 60 minutes from the scheduled time", () => {
    const w = activeWindow(at(23, 30), "23:00");
    assert.ok(w);
    assert.equal(w.dateKey, "2026-08-23");
    assert.equal(w.startMs, at(23, 0).getTime());
  });
  it("is null once the window has passed", () => {
    assert.equal(activeWindow(at(0, 30, 24), "23:00"), null);
  });
  it("spans midnight: a 23:40 schedule is still active at 00:20 with yesterday's dateKey", () => {
    const w = activeWindow(at(0, 20, 24), "23:40");
    assert.ok(w);
    assert.equal(w.dateKey, "2026-08-23");
  });
});

describe("upcomingWindow", () => {
  it("returns today's window while it is still ahead", () => {
    assert.equal(upcomingWindow(at(22, 58), "23:00")?.dateKey, "2026-08-23");
  });
  it("rolls to tomorrow once today's start has passed", () => {
    assert.equal(upcomingWindow(at(23, 30), "23:00")?.dateKey, "2026-08-24");
  });
  it("is null for a malformed time", () => {
    assert.equal(upcomingWindow(at(22, 0), "nope"), null);
  });
});

describe("shouldFire", () => {
  it("fires inside the window", () => {
    assert.equal(shouldFire(cfg(), at(23, 10))?.dateKey, "2026-08-23");
  });
  it("does not fire when disabled, already run, or skipped", () => {
    assert.equal(shouldFire(cfg({ enabled: false }), at(23, 10)), null);
    assert.equal(shouldFire(cfg({ lastRunDate: "2026-08-23" }), at(23, 10)), null);
    assert.equal(shouldFire(cfg({ skipDate: "2026-08-23" }), at(23, 10)), null);
  });
  it("yesterday's lastRunDate does not block tonight", () => {
    assert.equal(shouldFire(cfg({ lastRunDate: "2026-08-22" }), at(23, 10))?.dateKey, "2026-08-23");
  });
});

describe("warnWindow", () => {
  it("warns inside the 5-minute lead", () => {
    assert.equal(warnWindow(cfg(), at(22, 56))?.dateKey, "2026-08-23");
  });
  it("does not warn earlier, when skipped, or when disabled", () => {
    assert.equal(warnWindow(cfg(), at(22, 54)), null);
    assert.equal(warnWindow(cfg({ skipDate: "2026-08-23" }), at(22, 56)), null);
    assert.equal(warnWindow(cfg({ enabled: false }), at(22, 56)), null);
  });
});

describe("statusFor", () => {
  it("off when disabled", () => {
    assert.equal(statusFor(cfg({ enabled: false }), at(12, 0)).kind, "off");
  });
  it("scheduled before the window", () => {
    const s = statusFor(cfg(), at(12, 0));
    assert.equal(s.kind, "scheduled");
  });
  it("skipped when tonight's window is skipped", () => {
    assert.equal(statusFor(cfg({ skipDate: "2026-08-23" }), at(22, 0)).kind, "skipped");
  });
  it("done inside the window after firing, back to scheduled after it", () => {
    assert.equal(statusFor(cfg({ lastRunDate: "2026-08-23" }), at(23, 10)).kind, "done");
    const later = statusFor(cfg({ lastRunDate: "2026-08-23" }), at(1, 0, 24));
    assert.equal(later.kind, "scheduled");
  });
});

describe("parseClimateAutoOffPatch", () => {
  it("accepts a valid partial patch", () => {
    assert.deepEqual(parseClimateAutoOffPatch({ enabled: true, time: "22:30" }), {
      enabled: true,
      time: "22:30",
    });
  });
  it("accepts null skipDate (un-skip)", () => {
    assert.deepEqual(parseClimateAutoOffPatch({ skipDate: null }), { skipDate: null });
  });
  it("rejects unknown fields, bad types, bad formats, and empty patches", () => {
    assert.ok("error" in parseClimateAutoOffPatch({ nope: 1 }));
    assert.ok("error" in parseClimateAutoOffPatch({ enabled: "yes" }));
    assert.ok("error" in parseClimateAutoOffPatch({ time: "9pm" }));
    assert.ok("error" in parseClimateAutoOffPatch({ lastRunDate: "23-08-2026" }));
    assert.ok("error" in parseClimateAutoOffPatch({}));
    assert.ok("error" in parseClimateAutoOffPatch(null));
    assert.ok("error" in parseClimateAutoOffPatch([]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --experimental-strip-types src/lib/climate-auto-off.test.ts`
Expected: FAIL — cannot find module `./climate-auto-off.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/climate-auto-off.ts`:

```ts
/* Pure schedule math + request validation for the kiosk's AC auto-off
 * nightly sweep. No React, no Node APIs — every function takes `now`
 * explicitly so the whole nightly lifecycle is unit-testable without a
 * clock. Local time throughout: the kiosk lives on a wall in this house,
 * and "23:00" means 23:00 on that wall, DST included (the local Date
 * constructor absorbs DST shifts). */

export interface ClimateAutoOffConfig {
  enabled: boolean;
  /** "HH:MM", 24h. */
  time: string;
  /** "YYYY-MM-DD" — skip the sweep whose window STARTS on this local date. */
  skipDate?: string;
  /** "YYYY-MM-DD" — a sweep already fired for this window date. */
  lastRunDate?: string;
}

export interface SweepWindow {
  /** Local date the window STARTS on — the sweep's identity, so a
   *  near-midnight schedule spilling past 00:00 still counts as one night. */
  dateKey: string;
  startMs: number;
  endMs: number;
}

export type AutoOffStatus =
  | { kind: "off" }
  | { kind: "scheduled"; window: SweepWindow }
  | { kind: "skipped"; window: SweepWindow }
  | { kind: "done" };

/** Catch-up window: a kiosk tab that was reloading at the scheduled minute
 *  still sweeps when it comes back, up to an hour late. Past that the night
 *  is missed by design (spec: no server daemon). */
export const SWEEP_WINDOW_MS = 60 * 60_000;
export const WARN_LEAD_MS = 5 * 60_000;
export const DEFAULT_AUTO_OFF_TIME = "23:00";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTime(time: string): { hour: number; minute: number } | null {
  if (!TIME_RE.test(time)) return null;
  const [h, m] = time.split(":");
  return { hour: Number(h), minute: Number(m) };
}

export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function windowStartingOn(now: Date, dayOffset: number, hour: number, minute: number): SweepWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute);
  return { dateKey: localDateKey(start), startMs: start.getTime(), endMs: start.getTime() + SWEEP_WINDOW_MS };
}

/** The window containing `now`, if any. Checks today's start and
 *  yesterday's, because a window opened at 23:40 is still open at 00:20. */
export function activeWindow(now: Date, time: string): SweepWindow | null {
  const t = parseTime(time);
  if (!t) return null;
  for (const dayOffset of [0, -1]) {
    const w = windowStartingOn(now, dayOffset, t.hour, t.minute);
    if (now.getTime() >= w.startMs && now.getTime() < w.endMs) return w;
  }
  return null;
}

/** The next window whose start is at or after `now` (today or tomorrow). */
export function upcomingWindow(now: Date, time: string): SweepWindow | null {
  const t = parseTime(time);
  if (!t) return null;
  for (const dayOffset of [0, 1]) {
    const w = windowStartingOn(now, dayOffset, t.hour, t.minute);
    if (w.startMs >= now.getTime()) return w;
  }
  return null;
}

/** Non-null → the engine should fire the off-volley for this window now. */
export function shouldFire(cfg: ClimateAutoOffConfig, now: Date): SweepWindow | null {
  if (!cfg.enabled) return null;
  const w = activeWindow(now, cfg.time);
  if (!w) return null;
  if (w.dateKey === cfg.lastRunDate || w.dateKey === cfg.skipDate) return null;
  return w;
}

/** Non-null → the pre-sweep warning strip should be visible. */
export function warnWindow(cfg: ClimateAutoOffConfig, now: Date): SweepWindow | null {
  if (!cfg.enabled) return null;
  const w = upcomingWindow(now, cfg.time);
  if (!w) return null;
  if (w.dateKey === cfg.lastRunDate || w.dateKey === cfg.skipDate) return null;
  const ms = now.getTime();
  return ms >= w.startMs - WARN_LEAD_MS && ms < w.startMs ? w : null;
}

export function statusFor(cfg: ClimateAutoOffConfig, now: Date): AutoOffStatus {
  if (!cfg.enabled) return { kind: "off" };
  const active = activeWindow(now, cfg.time);
  if (active && cfg.lastRunDate === active.dateKey) return { kind: "done" };
  const target = active ?? upcomingWindow(now, cfg.time);
  if (!target) return { kind: "off" }; // unparseable time — treat as unconfigured
  if (cfg.skipDate === target.dateKey) return { kind: "skipped", window: target };
  return { kind: "scheduled", window: target };
}

/* ── POST body validation (shared with the public kiosk route) ──────────── */

export interface ClimateAutoOffPatch {
  enabled?: boolean;
  time?: string;
  /** null clears the skip ("resume tonight"). */
  skipDate?: string | null;
  lastRunDate?: string;
}

/** Same defense-in-depth discipline as /kiosk/api/ha/action's parseBody:
 *  this feeds an UNAUTHENTICATED route, so unknown keys are rejected and
 *  every field is shape-checked — a LAN device can flip this feature's own
 *  settings (same exposure class as flipping the AC itself) and nothing
 *  else. */
export function parseClimateAutoOffPatch(value: unknown): ClimateAutoOffPatch | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Request body must be a JSON object." };
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!["enabled", "time", "skipDate", "lastRunDate"].includes(key)) {
      return { error: `Unknown field "${key}".` };
    }
  }
  const patch: ClimateAutoOffPatch = {};
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { error: "enabled must be a boolean." };
    patch.enabled = v.enabled;
  }
  if ("time" in v) {
    if (typeof v.time !== "string" || !TIME_RE.test(v.time)) return { error: "time must be HH:MM (24h)." };
    patch.time = v.time;
  }
  if ("skipDate" in v) {
    if (v.skipDate !== null && (typeof v.skipDate !== "string" || !DATE_RE.test(v.skipDate))) {
      return { error: "skipDate must be YYYY-MM-DD or null." };
    }
    patch.skipDate = v.skipDate as string | null;
  }
  if ("lastRunDate" in v) {
    if (typeof v.lastRunDate !== "string" || !DATE_RE.test(v.lastRunDate)) {
      return { error: "lastRunDate must be YYYY-MM-DD." };
    }
    patch.lastRunDate = v.lastRunDate;
  }
  if (Object.keys(patch).length === 0) return { error: "No recognized fields in request." };
  return patch;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types src/lib/climate-auto-off.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add src/lib/climate-auto-off.ts src/lib/climate-auto-off.test.ts
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "feat: pure schedule math + validation for AC auto-off sweep"
```
(with the standard footer from Global Constraints)

---

### Task 2: Config block + public kiosk route

**Files:**
- Modify: `src/lib/config.ts` (inside `interface AppConfig`, after the `pinnedFolders` field ~line 146)
- Create: `src/app/kiosk/api/climate-auto-off/route.ts`

**Interfaces:**
- Consumes: `parseClimateAutoOffPatch`, `DEFAULT_AUTO_OFF_TIME` from Task 1; `loadConfig`/`saveConfig` from `src/lib/config.ts`.
- Produces (used by Task 3):
  - `AppConfig.climateAutoOff?: { enabled?: boolean; time?: string; skipDate?: string; lastRunDate?: string; updatedAt?: string }`
  - `GET /kiosk/api/climate-auto-off` → `{ enabled: boolean; time: string; skipDate: string | null; lastRunDate: string | null }` (defaults `{enabled: false, time: "23:00", skipDate: null, lastRunDate: null}` when the block is absent)
  - `POST /kiosk/api/climate-auto-off` with a `ClimateAutoOffPatch` body → same response shape; 400 `{ error }` on validation failure.

- [ ] **Step 1: Add the config block**

In `src/lib/config.ts`, add to `AppConfig` (after `pinnedFolders`):

```ts
  /** Kiosk AC auto-off nightly sweep (docs/superpowers/specs/
   *  2026-08-23-ac-auto-off-design.md). skipDate/lastRunDate live here —
   *  server-side, not localStorage — so two kiosk devices can't double-fire
   *  a sweep and a mid-night tab reload can't re-run one. Written ONLY by
   *  the public POST /kiosk/api/climate-auto-off route (strictly validated;
   *  same LAN-exposure class as the kiosk's existing HA action route). */
  climateAutoOff?: {
    enabled?: boolean;
    /** "HH:MM" 24h, local kiosk time. */
    time?: string;
    /** "YYYY-MM-DD" — skip the sweep whose window starts this date. */
    skipDate?: string;
    /** "YYYY-MM-DD" — sweep already fired for this window date. */
    lastRunDate?: string;
    updatedAt?: string;
  };
```

- [ ] **Step 2: Create the route**

Create `src/app/kiosk/api/climate-auto-off/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { DEFAULT_AUTO_OFF_TIME, parseClimateAutoOffPatch } from "@/lib/climate-auto-off";

export const dynamic = "force-dynamic";

/* Public (unauthenticated LAN) read/write for the AC auto-off schedule —
 * same exposure class as /kiosk/api/ha/action, which already lets any LAN
 * device flip these same ACs directly. parseClimateAutoOffPatch (lib) is
 * the whole write surface: four shape-checked fields, unknown keys
 * rejected, nothing else in config.json reachable from here. */

function responseShape(cfg: ReturnType<typeof loadConfig>["climateAutoOff"]) {
  return {
    enabled: cfg?.enabled ?? false,
    time: cfg?.time ?? DEFAULT_AUTO_OFF_TIME,
    skipDate: cfg?.skipDate ?? null,
    lastRunDate: cfg?.lastRunDate ?? null,
  };
}

export async function GET() {
  return NextResponse.json(responseShape(loadConfig().climateAutoOff));
}

export async function POST(req: NextRequest) {
  const parsed = parseClimateAutoOffPatch(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const config = loadConfig();
  const prev = config.climateAutoOff;
  const next = {
    enabled: parsed.enabled ?? prev?.enabled ?? false,
    time: parsed.time ?? prev?.time ?? DEFAULT_AUTO_OFF_TIME,
    // Explicit null = "resume tonight"; absent = keep the stored value.
    skipDate: parsed.skipDate === null ? undefined : (parsed.skipDate ?? prev?.skipDate),
    lastRunDate: parsed.lastRunDate ?? prev?.lastRunDate,
    updatedAt: new Date().toISOString(),
  };
  saveConfig({ ...config, climateAutoOff: next });
  return NextResponse.json(responseShape(next));
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors in the two touched files).

- [ ] **Step 4: Smoke the route against the dev server** (only if one is already running; otherwise defer to Task 6's test-stack pass)

```bash
curl -s http://localhost:3005/kiosk/api/climate-auto-off
curl -s -X POST http://localhost:3005/kiosk/api/climate-auto-off -H "Content-Type: application/json" -d '{"enabled":true,"time":"23:00"}'
curl -s -X POST http://localhost:3005/kiosk/api/climate-auto-off -H "Content-Type: application/json" -d '{"bogus":1}'
```
Expected: defaults JSON; updated JSON with `enabled:true`; 400 `{"error":"Unknown field \"bogus\"."}`.

- [ ] **Step 5: Commit**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add src/lib/config.ts src/app/kiosk/api/climate-auto-off/route.ts
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "feat: climateAutoOff config block + public kiosk schedule route"
```

---

### Task 3: Client engine hook

**Files:**
- Create: `src/lib/kiosk/use-climate-auto-off.ts`

**Interfaces:**
- Consumes: Task 1's schedule functions; Task 2's route; `UseKioskHaResult` (type-only) from `@/components/kiosk/kiosk-hub` (precedent: `kiosk-climate.tsx` imports it the same way); `fetcher`, `postJson` from `@/lib/client`; `HaEntities` from `@/lib/types/ha`.
- Produces (used by Task 4/5):

```ts
export interface ClimateAutoOffServerState {
  enabled: boolean; time: string; skipDate: string | null; lastRunDate: string | null;
}
export interface UseClimateAutoOffResult {
  state: ClimateAutoOffServerState | undefined; // undefined until first GET lands
  status: AutoOffStatus | null;
  warn: SweepWindow | null;   // non-null → warning strip window
  onCount: number;            // climates with hvacMode !== "off", live
  notice: string | null;      // quiet failure notice after a given-up sweep
  saving: boolean;
  update: (patch: ClimateAutoOffPatch) => Promise<boolean>;
  skipTonight: () => Promise<boolean>;
}
export function useClimateAutoOff(ha: UseKioskHaResult): UseClimateAutoOffResult
```

- [ ] **Step 1: Write the hook**

Create `src/lib/kiosk/use-climate-auto-off.ts`:

```ts
"use client";

/* THESIS: the app's first autonomous HA-writer. Every performHaAction call
 * before this one was user-tap-triggered; this hook fires ONE off-volley
 * per night from the always-open kiosk tab (spec: no server daemon, the
 * tab IS the scheduler). One volley, never a converge-loop — these IR
 * units take up to ~7.6s to report a write back (climate-controls.ts's
 * measurements), and a human who turns an AC back ON after the sweep must
 * be respected until tomorrow. lastRunDate/skipDate live server-side so a
 * reload or a second kiosk can't double-fire; set_hvac_mode "off" is
 * idempotent anyway, so the worst race is a harmless duplicate. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher, postJson } from "@/lib/client";
import {
  shouldFire,
  statusFor,
  warnWindow,
  type AutoOffStatus,
  type ClimateAutoOffConfig,
  type ClimateAutoOffPatch,
  type SweepWindow,
} from "@/lib/climate-auto-off";
import type { UseKioskHaResult } from "@/components/kiosk/kiosk-hub";

const CONFIG_KEY = "/kiosk/api/climate-auto-off";
/** Engine tick + config re-read cadence. 30s is fine-grained enough for a
 *  5-minute warn lead and a 60-minute fire window, and cheap enough to run
 *  all day (the config GET is a local file read server-side). */
const TICK_MS = 30_000;
/** Retry budget when HA is unreachable at fire time: one attempt per tick,
 *  20 ticks ≈ 10 minutes (spec), then give up loudly-but-quietly. */
const MAX_FIRE_ATTEMPTS = 20;

export interface ClimateAutoOffServerState {
  enabled: boolean;
  time: string;
  skipDate: string | null;
  lastRunDate: string | null;
}

export interface UseClimateAutoOffResult {
  state: ClimateAutoOffServerState | undefined;
  status: AutoOffStatus | null;
  warn: SweepWindow | null;
  onCount: number;
  notice: string | null;
  saving: boolean;
  update: (patch: ClimateAutoOffPatch) => Promise<boolean>;
  skipTonight: () => Promise<boolean>;
}

function toConfig(state: ClimateAutoOffServerState): ClimateAutoOffConfig {
  return {
    enabled: state.enabled,
    time: state.time,
    skipDate: state.skipDate ?? undefined,
    lastRunDate: state.lastRunDate ?? undefined,
  };
}

export function useClimateAutoOff(ha: UseKioskHaResult): UseClimateAutoOffResult {
  const { data: state, mutate } = useSWR<ClimateAutoOffServerState>(CONFIG_KEY, fetcher, {
    refreshInterval: TICK_MS,
    keepPreviousData: true,
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const attemptsRef = useRef(0);

  const entities = ha.data?.entities;
  const onCount = useMemo(
    () => entities?.climates.filter((c) => c.hvacMode !== "off").length ?? 0,
    [entities],
  );

  /* The engine: evaluated on every tick and on every config/HA-data change.
   * busyRef makes the volley single-flight; a FAILED volley leaves
   * lastRunDate unset so the next tick retries (against the then-current
   * on-list — units that did turn off drop out naturally), bounded by
   * MAX_FIRE_ATTEMPTS. */
  useEffect(() => {
    if (!state || busyRef.current) return;
    const win = shouldFire(toConfig(state), new Date(nowMs));
    if (!win) return;

    busyRef.current = true;
    void (async () => {
      try {
        if (!entities) {
          // HA states unavailable (unreachable/unconfigured) — counts as a
          // failed attempt; the volley can't even be aimed yet.
          attemptsRef.current += 1;
        } else {
          const on = entities.climates.filter((c) => c.hvacMode !== "off");
          let allOk = true;
          // Cumulative optimistic entities: each confirmed send flips its
          // tile immediately, same feel as a manual tap.
          let optimistic = entities;
          for (const c of on) {
            optimistic = {
              ...optimistic,
              climates: optimistic.climates.map((x) =>
                x.entityId === c.entityId ? { ...x, hvacMode: "off" } : x,
              ),
            };
            const ok = await ha.runAction(
              { entityId: c.entityId, action: "set_hvac_mode", hvacMode: "off" },
              optimistic,
            );
            if (!ok) allOk = false;
          }
          if (allOk) {
            await postJson(CONFIG_KEY, { lastRunDate: win.dateKey });
            attemptsRef.current = 0;
            setNotice(null);
            await mutate();
            return;
          }
          attemptsRef.current += 1;
        }
        if (attemptsRef.current >= MAX_FIRE_ATTEMPTS) {
          // Close the window server-side even on failure — without this the
          // engine would re-volley every tick for the rest of the hour,
          // fighting a human who turned a unit back on mid-outage.
          await postJson(CONFIG_KEY, { lastRunDate: win.dateKey }).catch(() => {});
          setNotice("Auto-off couldn't reach every AC tonight — check Home Assistant.");
          attemptsRef.current = 0;
          await mutate();
        }
      } finally {
        busyRef.current = false;
      }
    })();
  }, [nowMs, state, entities, ha, mutate]);

  const update = useCallback(
    async (patch: ClimateAutoOffPatch) => {
      setSaving(true);
      try {
        await postJson(CONFIG_KEY, patch);
        await mutate();
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [mutate],
  );

  const status = state ? statusFor(toConfig(state), new Date(nowMs)) : null;
  const warn = state ? warnWindow(toConfig(state), new Date(nowMs)) : null;

  const skipTonight = useCallback(async () => {
    // The skip target is whichever window the user is being warned about /
    // is scheduled next; statusFor carries it for both cases.
    const target =
      warn ??
      (status && (status.kind === "scheduled" || status.kind === "skipped") ? status.window : null);
    if (!target) return false;
    return update({ skipDate: target.dateKey });
  }, [warn, status, update]);

  return useMemo(
    () => ({ state, status, warn, onCount, notice, saving, update, skipTonight }),
    [state, status, warn, onCount, notice, saving, update, skipTonight],
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`status`/`warn` recompute per render is fine — the component tree below is small; do NOT memo them against `nowMs` only, config changes must land immediately.)

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add src/lib/kiosk/use-climate-auto-off.ts
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "feat: client engine hook for AC auto-off nightly sweep"
```

---

### Task 4: UI — pill, settings sheet, warning strip

**Files:**
- Create: `src/components/kiosk/kiosk-climate-auto-off.tsx`

**Interfaces:**
- Consumes: `UseClimateAutoOffResult` from Task 3; `parseTime`, `AutoOffStatus` from Task 1; `KIOSK_POP_MS`, `containerExpand`, `containerCollapse` from `@/lib/kiosk-motion`; `cn` from `@/lib/utils`; lucide `Moon`, `Minus`, `Plus`, `X`.
- Produces (used by Task 5):
  - `ClimateAutoOffPill({ autoOff }: { autoOff: UseClimateAutoOffResult })` — header pill; owns sheet open state + origin rect.
  - `ClimateAutoOffBanner({ autoOff }: { autoOff: UseClimateAutoOffResult })` — warning strip / failure notice; renders `null` when idle.

Design decisions (from the confirmed impeccable brief — implement as stated):
- Pill: `Moon` glyph + mono time in `text-accent` when enabled; glyph + "off" in `text-ink-dim` when disabled (**never** `text-ink-faint` — interactive label). `h-11`, `kiosk-press`, `focus-visible:ring-1 ring-accent`.
- Sheet: same dialog contract as `kiosk-timers.tsx`'s overlay (scrim `fixed inset-0 z-50 bg-bg/90 backdrop-blur-sm`, `.panel` shell, `role="dialog" aria-modal="true"`, focus trap, Escape → single `requestClose()`, `containerExpand`/`containerCollapse` from the pill's rect, `KIOSK_POP_MS + 80` close safety-net). Copy the trap/close code from `kiosk-timers.tsx:320-416` — it is the canonical implementation.
- Time picker: stepper chips (hour ±1 wrapping 0–23, minute ±15 wrapping 0–45), large mono readout (`text-3xl font-mono tabular-nums`), NOT a native `<input type="time">`. Steppers disabled (attr + `opacity-40`) while the schedule is off.
- Autosave: toggle POSTs immediately; time steppers update local state and debounce the POST by 600ms (rapid taps = one write). On failure show "Couldn't save — try again." in `text-warn` and re-sync from server state.
- Banner: inline strip, not a modal. `role="status"`, `.panel`, `Moon` + `microlabel` "Auto-off" + "`N` AC(s) turning off at `HH:MM`" + `Skip tonight` button (`h-11`, bordered). Failure `notice` reuses the same strip with `text-warn` tone and no button.

- [ ] **Step 1: Write the component file**

Create `src/components/kiosk/kiosk-climate-auto-off.tsx`. Skeleton with all behavior-bearing code (the dialog scaffold marked "as kiosk-timers" means: copy that file's `useEffect` focus restore, `useLayoutEffect` expand, `requestClose`, and `onDialogKeyDown` verbatim, renaming the `aria-labelledby` id to `kiosk-auto-off-title`):

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Moon, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIOSK_POP_MS, containerCollapse, containerExpand } from "@/lib/kiosk-motion";
import { parseTime, type AutoOffStatus } from "@/lib/climate-auto-off";
import type { UseClimateAutoOffResult } from "@/lib/kiosk/use-climate-auto-off";

const SAVE_DEBOUNCE_MS = 600;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function statusLine(status: AutoOffStatus | null, time: string): string {
  if (!status || status.kind === "off") return "Off — ACs are never turned off automatically.";
  if (status.kind === "done") return "Done for tonight.";
  if (status.kind === "skipped") return "Skipped tonight — resumes tomorrow.";
  return `Next sweep at ${time} — any AC still on turns off.`;
}

export function ClimateAutoOffPill({ autoOff }: { autoOff: UseClimateAutoOffResult }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<DOMRect | null>(null);
  const { state } = autoOff;
  if (!state) return null; // config not loaded yet — pill appears once known
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={
          state.enabled ? `AC auto-off at ${state.time} — change schedule` : "AC auto-off is off — configure"
        }
        onClick={() => {
          originRef.current = btnRef.current?.getBoundingClientRect() ?? null;
          setOpen(true);
        }}
        className="kiosk-press flex h-11 items-center gap-1.5 rounded-md px-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <Moon size={14} className={state.enabled ? "text-accent" : "text-ink-dim"} aria-hidden />
        <span
          className={cn("font-mono text-xs tabular-nums", state.enabled ? "text-accent" : "text-ink-dim")}
        >
          {state.enabled ? state.time : "off"}
        </span>
      </button>
      {open && (
        <ClimateAutoOffSheet autoOff={autoOff} onClose={() => setOpen(false)} originRect={originRef.current} />
      )}
    </>
  );
}

function ClimateAutoOffSheet({
  autoOff,
  onClose,
  originRect,
}: {
  autoOff: UseClimateAutoOffResult;
  onClose: () => void;
  originRect: DOMRect | null;
}) {
  const { state, status, update, skipTonight } = autoOff;
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const closeFiredRef = useRef(false);
  const [saveError, setSaveError] = useState(false);

  // Local time while stepping; server state is the source of truth between
  // edits. Debounced POST so five fast taps are one write.
  const [localTime, setLocalTime] = useState(state?.time ?? "23:00");
  useEffect(() => {
    if (state) setLocalTime(state.time);
  }, [state]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  function step(field: "hour" | "minute", dir: 1 | -1) {
    const t = parseTime(localTime);
    if (!t) return;
    const next =
      field === "hour"
        ? `${pad2((t.hour + dir + 24) % 24)}:${pad2(t.minute)}`
        : `${pad2(t.hour)}:${pad2((t.minute + dir * 15 + 60) % 60)}`;
    setLocalTime(next);
    setSaveError(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void update({ time: next }).then((ok) => setSaveError(!ok));
    }, SAVE_DEBOUNCE_MS);
  }

  // Focus restore, containerExpand entrance, requestClose (collapse +
  // KIOSK_POP_MS+80 safety net) and Tab/Escape trap: copied verbatim from
  // kiosk-timers.tsx's overlay (the canonical dialog contract), with
  // aria-labelledby="kiosk-auto-off-title".
  /* ... [dialog contract code as kiosk-timers] ... */

  if (!state) return null;
  const enabled = state.enabled;
  const stepBtn =
    "kiosk-press flex h-11 w-11 items-center justify-center rounded-md border border-line text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 px-4 py-6 backdrop-blur-sm" /* scrim handlers as kiosk-timers */>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-auto-off-title"
        tabIndex={-1}
        /* onKeyDown={onDialogKeyDown} */
        className="panel flex max-h-full w-full max-w-sm flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Moon size={15} className="text-accent" aria-hidden />
            <h2 id="kiosk-auto-off-title" className="text-sm font-semibold tracking-tight">
              AC auto-off
            </h2>
          </div>
          {/* close X as kiosk-timers */}
        </div>

        <div className="space-y-5 overflow-y-auto px-4 py-4">
          <button
            ref={firstFocusRef}
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => {
              setSaveError(false);
              void update({ enabled: !enabled }).then((ok) => setSaveError(!ok));
            }}
            className={cn(
              "kiosk-press flex h-11 w-full items-center justify-between rounded-md border px-3 outline-none focus-visible:ring-1 focus-visible:ring-accent",
              enabled ? "border-accent-dim text-accent" : "border-line text-ink-dim",
            )}
          >
            <span className="text-sm font-semibold">Nightly auto-off</span>
            <span className="font-mono text-xs">{enabled ? "on" : "off"}</span>
          </button>

          <div className={cn("space-y-2", !enabled && "opacity-40")} aria-disabled={!enabled}>
            <span className="microlabel block">Sweep time</span>
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center gap-2">
                <button type="button" disabled={!enabled} onClick={() => step("hour", 1)} aria-label="Hour up" className={stepBtn}><Plus size={16} /></button>
                <button type="button" disabled={!enabled} onClick={() => step("hour", -1)} aria-label="Hour down" className={stepBtn}><Minus size={16} /></button>
              </div>
              <span className="font-mono text-3xl tabular-nums text-ink" aria-live="polite">{localTime}</span>
              <div className="flex flex-col items-center gap-2">
                <button type="button" disabled={!enabled} onClick={() => step("minute", 1)} aria-label="Minutes up" className={stepBtn}><Plus size={16} /></button>
                <button type="button" disabled={!enabled} onClick={() => step("minute", -1)} aria-label="Minutes down" className={stepBtn}><Minus size={16} /></button>
              </div>
            </div>
          </div>

          <p className="text-xs text-ink-dim">{statusLine(status, localTime)}</p>
          {status?.kind === "skipped" && (
            <button
              type="button"
              onClick={() => void update({ skipDate: null })}
              className="kiosk-press h-11 w-full rounded-md border border-line text-xs font-semibold text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent"
            >
              Resume tonight
            </button>
          )}
          {status?.kind === "scheduled" && (
            <button
              type="button"
              onClick={() => void skipTonight()}
              className="kiosk-press h-11 w-full rounded-md border border-line text-xs font-semibold text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent"
            >
              Skip tonight
            </button>
          )}
          {saveError && <p className="text-xs text-warn">Couldn't save — try again.</p>}
        </div>
      </div>
    </div>
  );
}

export function ClimateAutoOffBanner({ autoOff }: { autoOff: UseClimateAutoOffResult }) {
  const { warn, onCount, notice, skipTonight, state } = autoOff;
  if (notice) {
    return (
      <div role="status" className="panel flex flex-wrap items-center gap-2 px-4 py-3">
        <Moon size={14} className="text-warn" aria-hidden />
        <span className="microlabel !text-warn">Auto-off</span>
        <span className="text-xs text-ink-dim">{notice}</span>
      </div>
    );
  }
  if (!warn || onCount === 0 || !state) return null;
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-2.5 px-4 py-2.5">
      <Moon size={14} className="text-accent" aria-hidden />
      <span className="microlabel">Auto-off</span>
      <span className="text-xs text-ink-dim">
        {onCount === 1 ? "1 AC" : `${onCount} ACs`} turning off at{" "}
        <span className="font-mono tabular-nums text-ink">{state.time}</span>
      </span>
      <button
        type="button"
        onClick={() => void skipTonight()}
        className="kiosk-press ml-auto h-11 rounded-md border border-line px-3 text-xs font-semibold text-ink outline-none hover:border-line-bright focus-visible:ring-1 focus-visible:ring-accent"
      >
        Skip tonight
      </button>
    </div>
  );
}
```

The three `/* ... as kiosk-timers ... */` sites are the ONLY permitted copy-from-precedent spots, and each names its exact source (`kiosk-timers.tsx:320-346` focus+expand, `:352-376` requestClose, `:383-416` key trap, `:419-434` scrim handlers, `:453-460` close button). Everything else is written above.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add src/components/kiosk/kiosk-climate-auto-off.tsx
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "feat: AC auto-off pill, settings sheet and warning strip"
```

---

### Task 5: Wire into the kiosk hub

**Files:**
- Modify: `src/components/kiosk/kiosk-hub.tsx` (`ClimateSection` ~line 643-720 and `KioskHub` ~line 848-905)

**Interfaces:**
- Consumes: `useClimateAutoOff` (Task 3), `ClimateAutoOffPill` / `ClimateAutoOffBanner` (Task 4).
- Produces: the feature is live on `/kiosk`.

- [ ] **Step 1: Instantiate the hook and render the banner in `KioskHub`**

In `KioskHub()` (`kiosk-hub.tsx:848`), the hook must be called before the early returns (Rules of Hooks):

```tsx
export function KioskHub() {
  const ha = useKioskHa();
  const autoOff = useClimateAutoOff(ha);
  const { data, error, isLoading } = ha;
  // ... existing early returns unchanged ...
```

Inside the returned `space-y-2.5` div, render the banner first (above the stale tag/sections — it is the one time-critical line on the surface):

```tsx
    <div className="space-y-2.5">
      <ClimateAutoOffBanner autoOff={autoOff} />
      {stale && ( /* ... unchanged ... */ )}
```

Pass `autoOff` into the climate section:

```tsx
      {entities.climates.length > 0 && (
        <ClimateSection ha={ha} climates={entities.climates} entities={entities} riseIndex={3} autoOff={autoOff} />
      )}
```

Imports to add at the top of the file:

```tsx
import { useClimateAutoOff, type UseClimateAutoOffResult } from "@/lib/kiosk/use-climate-auto-off";
import { ClimateAutoOffBanner, ClimateAutoOffPill } from "@/components/kiosk/kiosk-climate-auto-off";
```

- [ ] **Step 2: Add the pill to `ClimateSection`'s header**

`ClimateSection` is `memo`ized — add `autoOff: UseClimateAutoOffResult` to its props (the hook's `useMemo`d result keeps the memo effective), and wrap the existing header:

```tsx
      <div className="flex items-center justify-between gap-2">
        <SectionHeader icon={Thermometer} label="Climate" />
        <ClimateAutoOffPill autoOff={autoOff} />
      </div>
```

(If `SectionHeader` carries its own bottom margin, keep it on the wrapper's first child — match whatever the existing render produces visually; the pill right-aligns on the same line as the "Climate" label.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build` (dev server NOT running)
Expected: both clean.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (existing `cache.test.ts`, `integration-client.test.ts`, new `climate-auto-off.test.ts`).

- [ ] **Step 5: Commit**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add src/components/kiosk/kiosk-hub.tsx
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "feat: wire AC auto-off into kiosk hub (pill + banner)"
```

---

### Task 6: Verification pass (contrast, states, test stack)

**Files:**
- No new files. Possibly small fixups from findings.

**Interfaces:**
- Consumes: everything above, `scripts/kiosk-overlay-contrast.mjs`, the test-stack runbook in `CLAUDE.md`.
- Produces: verified feature; evidence for the completion claim.

- [ ] **Step 1: Contrast sweep**

Run: `node scripts/kiosk-overlay-contrast.mjs`
Expected: every theme×role pair still ≥ 4.5:1. The new UI uses only existing token roles (`accent`, `ink`, `ink-dim`, `warn` on `panel`/`bg`), so no new pairs should appear — if the script takes explicit targets, add the new component's classes to its sweep list per its own usage docs.

- [ ] **Step 2: Walk every state in the browser** (dev server or test stack)

Reduce `WARN_LEAD_MS`-relevant waiting by setting the sweep time a few minutes ahead via the sheet. Verify each, at 1440px and 390px, zero horizontal overflow:
1. Disabled: muted pill "off"; no banner ever.
2. Enable + set time: steppers debounce to one save; readout mono; `data/config.json` gains the block.
3. Warning strip appears at T−5 with correct count; "Skip tonight" makes it vanish and status line reads "Skipped tonight"; "Resume tonight" un-skips.
4. Fire: at T, on-ACs flip off (optimistic tiles), `lastRunDate` lands in config, strip gone, status "Done for tonight". Turn an AC back on after — nothing re-fires.
5. Reload mid-window before firing → catch-up fires once. Reload after firing → nothing.
6. HA unreachable at fire time (stop the test-stack proxy) → retries, then the `text-warn` notice.
7. Sheet dialog contract: Escape closes, Tab cycles, focus returns to pill, reduced-motion shows no FLIP.
8. `prefers-reduced-motion`: sheet appears/disappears instantly.

For real-HA behavior (steps 4–6), deploy to the **test stack** per CLAUDE.md's runbook (tar → build → `docker compose -f docker-compose.test.yml up -d` on port 3006; tear down after). Never test against production (3005). Note: the dev checkout has no `homeassistant` config block — HA states only exist on the server stacks.

Browser automation, if needed: reuse the sibling Playwright install per CLAUDE.md (`createRequire("F:/Projects/work/SlotCoordination-TestAutomation/package.json")("playwright")`, `chromium.launch({ channel: "chrome" })`).

- [ ] **Step 3: Fix anything found, re-run `npx tsc --noEmit && npm run build && npm test`, and commit fixups**

```bash
git -c safe.directory=F:/Projects/personal/homelab-dashboard add -A src/
git -c safe.directory=F:/Projects/personal/homelab-dashboard commit -m "fix: AC auto-off verification findings"
```
(Skip the commit if nothing changed.)

- [ ] **Step 4: Tear down the test stack**

```bash
ssh server "cd /mnt/docker/stacks/homelab-dashboard-test && sudo docker compose -f docker-compose.test.yml down"
```
