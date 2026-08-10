# nightwatch — architecture optimisation plan

Analysed 2026-08-10 against `src/` at 265 files / ~54.5k lines
(components 27.0k, lib 19.1k, app 10.2k).

**Verdict up front:** this is not rescue work. The codebase is already better than
most — thin route handlers, a shared telemetry pub/sub instead of per-tab Docker
polling, `memo`/`useDeferredValue` on the hot `/resources` page, a real strategy
registry in `src/lib/widgets/`, and comment density that explains *why* rather than
*what*. The wins below are consolidation of patterns that were each written
correctly but written 6–12 separate times, plus three genuine performance defects.

Constraints honoured throughout: **no new runtime dependencies** (PRODUCT.md), and
the only automated gate is `npx tsc --noEmit && npm run build` — there is no test
runner and no ESLint config. Every phase below is therefore designed to be
**type-checkable**, which is the only safety net available. See §6.

---

## 1. Performance defects (ranked by measured impact)

### P1 — `three` ships to every kiosk load, on every theme

`src/app/kiosk/layout.tsx` statically imports `KioskSunroomWeather`, which imports
`kiosk-sunroom-particles.tsx`, which does `import * as THREE from "three"`.
`three` is 25 MB on disk; the tree-shaken runtime slice is still several hundred KB
of parsed JS.

The layout is a **server component that always renders all four backdrops** —
sky, sunroom light, sunroom weather, glass weather — and each one decides
internally whether it is the active theme. So a wall tablet on the `glass` theme
downloads, parses and instantiates the WebGL particle system it will never show.

There is **zero use of `next/dynamic` anywhere in the repository** — this is the
first and largest instance of a general gap.

**Fix:** make backdrop selection the thing that splits the bundle, not a runtime
`if`. Lift the active theme to a client boundary component and render backdrops
through `next/dynamic(..., { ssr: false })`. Register them in a
`Record<KioskTheme, () => Promise<Component>>` map so adding a theme is one map
entry (this is the polymorphism point in §3.4 — same shape as
`src/lib/widgets/actions.ts`).

**Expected:** largest single reduction in kiosk first-paint JS. Measure with
`npm run build`'s per-route First Load JS for `/kiosk` before and after.

### P2 — `getHostVitals()` has no cache, and two poll paths hit it

`src/lib/host-metrics.ts:519` runs `si.currentLoad()` + `si.mem()` + `si.fsSize()`
+ `si.networkStats()` + `si.cpuTemperature()` on **every request**. Only
`staticInfo` (os/cpu model/cores) is cached — line 504.

`si.currentLoad()` samples `/proc/stat` with an internal delay; `si.fsSize()`
shells out per filesystem. Meanwhile:

- `useHost(5000)` → `/api/host` (dashboard, authenticated)
- `useKioskVitals(5000)` → `/kiosk/api/vitals` (kiosk, public)

Different SWR keys, so SWR's dedupe cannot help. **A desk browser plus a wall
tablet = four full host collections every 5 seconds**, three of which return
values indistinguishable from the one before.

**Fix:** one 2 s TTL + in-flight-dedup memo around `getHostVitals()`. Both routes
read through it. 2 s is below the 5 s poll so no reading is ever served stale
relative to what the client asked for, and concurrent callers share one collection.

### P3 — Docker socket fan-out on stats and inspect

- `src/lib/docker.ts:315-334` — `getContainerStats()` maps every running container
  to its own `container.stats({ stream: false })` call. At ~26 containers
  (PRODUCT.md), that is 26 concurrent socket round-trips behind a 5 s TTL.
- `src/lib/docker.ts:155-168` — `listContainersWithRuntime()` issues one
  `.inspect()` per id behind a 3 s TTL.

The TTLs are correct and the `Promise.allSettled` is correct. What is missing is
**in-flight deduplication**: two requests arriving 50 ms apart on a cold TTL both
start the full fan-out. On a 5 s poll from two clients that is routine, not rare.

**Fix:** same memo helper as P2. This is a one-line change per call site once the
helper exists, and it is the reason the helper is worth building.

### P4 — twelve hand-rolled TTL caches, one of which does it properly

`briefing.ts:240-282` is the only cache in the codebase with in-flight dedup
(`inflight: { date, promise }`). The other eleven are `let cached` +
`Date.now() - cached.ts < TTL`:

`attention.ts:38`, `config.ts:196`, `disk-usage.ts:62/310/525`,
`docker.ts:124/286/348/550`, `forgejo.ts:28/443`, `ha-doorbell.ts:60`,
`npm.ts:49` (token), `oidc.ts:79/128`, `processes.ts:32/275`.

Three separate storage idioms are in play: module-level `let` (most),
`globalThis.__statsCache` (docker.ts only, for HMR survival), and closure state.
The `globalThis` variant is the correct one in dev — the others silently reset
on every hot reload, which is a real source of "it behaves differently in dev".

**Fix:** §3.1.

### P5 — polling cadence is 25 scattered magic numbers with no idle policy

`refreshInterval` appears at ~25 call sites as a raw literal, each with a comment
justifying it. The comments are good; the scattering is not. There is no single
place to answer "what does a wall tablet cost per hour", and no global response to
idleness — `src/lib/kiosk-activity.ts` exists and tracks idle, but only
`kiosk-hub.tsx:150` consumes it (`refreshInterval: paused ? 0 : pollMs`).

A kiosk left on overnight polls vitals + health + nowplaying + doorbell +
downloads + alerts + weather at full rate against a screen nobody is looking at.

**Fix:** §3.3 — a cadence module plus an idle-aware wrapper. Low risk, and it makes
P5's cost visible for the first time.

### P6 — five SWR subscribers on one weather key

`kiosk-display.tsx:199`, `kiosk-glass-weather.tsx:120`, `kiosk-sky.tsx:81`,
`kiosk-sunroom-weather.tsx:114`, `kiosk-sunroom.tsx:168` each call
`useSWR("/kiosk/api/weather", ...)` with their own local `WEATHER_REFRESH_MS`
constant and their own response type.

SWR dedupes the *network* correctly (`kiosk-glass-weather.tsx:39` says so
explicitly), so this is **not** a request-count bug. It is a maintenance hazard:
five copies of the interval constant that must stay identical for the dedupe to
hold, and five structurally different views of the same payload.

**Fix:** one `useKioskWeather()` in `kiosk-client.ts` returning the full snapshot;
callers select the slice they need. Deletes four constants and four response
interfaces. Behaviour-neutral.

### P7 — no code splitting for the heavy dashboard views

`/resources` (`page.tsx`, 1139 lines) statically imports `treemap.tsx`
(d3-hierarchy), `gpu-view.tsx` (500), and `process-table.tsx` (990) — the last
two render inside tab panels the page itself notes are "one of six"
(`client.ts` `useProcesses`'s `enabled` comment). The data is correctly gated
behind a null SWR key; **the code is not gated at all**.

**Fix:** `next/dynamic` on the tab panels, matching the split that already exists
in the data layer.

---

## 2. Readability defects

1. **Four files over 900 lines** carrying multiple concerns:
   `kiosk-climate.tsx` (1709 — 2 custom hooks, 4 sub-components, a modal, a
   slider, localStorage persistence), `resources/page.tsx` (1139),
   `process-table.tsx` (990), `kiosk-surface.tsx` (970, 23 imports).
2. **`globals.css` at 1862 lines** — larger than any component, and the shared
   token surface for all 16 kiosk themes.
3. **128 of 265 files are `"use client"`** (48%). Some are unavoidable (this is a
   live dashboard), but the boundary has never been audited.
4. **Six near-identical integration clients** — see §3.2.
5. **`memo` used 6 times** across 91 components while `useMemo` is used 60 times.
   The value-level memoisation is thorough; the component-level memoisation is
   almost absent outside `resources/page.tsx:446`. On surfaces re-rendering at 1 Hz
   from the telemetry SSE, that asymmetry is backwards.

---

## 3. The four pillars, applied

Each pillar below names one concrete artefact, not a principle.

### 3.1 Encapsulation — `src/lib/cache.ts`

Cache state is currently public mutable module scope: `let cached`, `let inflight`,
`let tokenCache`, `globalThis.__statsCache`. Any function in the file can mutate
it; the invalidation rule is re-implemented at each read site; and only one of the
twelve handles concurrent callers.

```ts
/** TTL memo with in-flight dedup. Survives HMR via globalThis (the pattern
 *  docker.ts already uses, generalised). */
export class Memo<T> {
  constructor(key: string, ttlMs: number, load: () => Promise<T>)
  get(): Promise<T>          // shared promise while in flight
  peek(): T | null           // cached value without triggering a load
  invalidate(): void
}
export function keyedMemo<K extends string, T>(...): { get(k: K): Promise<T> }
```

Replaces the eleven ad-hoc caches. Fixes P2, P3 and P4 in one move — every call
site becomes `await hostVitalsMemo.get()`. The TTL constants stay where they are,
in the modules that own the domain knowledge; only the *mechanism* moves.

**This is the highest-leverage change in the plan.** It is also the least risky:
purely additive, and each migration is independently type-checkable.

### 3.2 Abstraction — `src/lib/integration-client.ts`

Six modules speak HTTP to a homelab service, and all six independently implement:
credential lookup → `fetch` with `AbortSignal.timeout(TIMEOUT_MS)` → status
classification → a human `detail` string.

| module | timeout const | auth style | status union |
|---|---|---|---|
| `ha.ts` (646) | `TIMEOUT_MS` ×3 sites | Bearer | `HaStatus` |
| `forgejo.ts` (486) | `FORGEJO_TIMEOUT_MS`, `GITHUB_TIMEOUT_MS` | token | `GitStatus` |
| `npm.ts` | `API_TIMEOUT_MS`, `HEALTH_TIMEOUT_MS` | cached JWT | inline |
| `hermes-ctl.ts` | `TIMEOUT_MS` | Bearer | inline ×3 |
| `jellyfin.ts` | `TIMEOUT_MS` ×2 | `X-Emby-Token` | inline |
| `ha-doorbell.ts` (412) | `TIMEOUT_MS`, `SNAPSHOT_TIMEOUT_MS` | Bearer | inline |

`ha.ts` alone produces the string `"Home Assistant returned a non-JSON response."`
at two separate lines, and the `unconfigured | unreachable | unauthorized | ok`
union is declared four times in four shapes (twice as a named type, twice inline).

```ts
export type ProbeStatus = "unconfigured" | "unreachable" | "unauthorized" | "ok";
export type Probe<T> =
  | { status: "ok"; data: T }
  | { status: Exclude<ProbeStatus, "ok">; detail: string };

export abstract class IntegrationClient {
  protected abstract readonly name: string;      // "Home Assistant"
  protected abstract readonly timeoutMs: number;
  protected abstract credentials(): Creds | null;
  protected abstract authHeaders(c: Creds): HeadersInit;

  protected async getJson<T>(path: string): Promise<Probe<T>>;
  protected async postJson<T>(path: string, body: unknown): Promise<Probe<T>>;
}
```

The `detail` strings become one templated set (`` `${this.name} returned HTTP
${res.status}.` ``), which also fixes the inconsistency where some modules say
"unreachable" for a 500 and others say "error".

**Non-negotiable invariant to preserve:** `/api/ha/states/route.ts` documents that
an upstream 401 must **never** surface as an HTTP 401 to the browser, because
`client.ts`'s `fetcher` treats 401 as *this app's* session expiring and redirects
to `/login`. The base class must encode that as a type-level guarantee — it returns
a `Probe`, never a `Response` — so no future subclass can reintroduce the bug.

### 3.3 Inheritance — collectors and cadence

Two hierarchies, both shallow and both earning their keep:

**(a) `SnapshotSource<T>`.** Seven read-only routes are byte-for-byte the same
shape — `export const dynamic = "force-dynamic"` plus
`return NextResponse.json(await getXSnapshot())`, with a comment explaining the
always-200 contract (`/api/smart`, `/api/network`, `/api/git`, `/api/ha/states`,
`/api/proxy-manager`, `/api/transcodes`, `/api/host`). Four of those comments say
"mirrors /api/…" — the codebase already knows it is repeating itself.

Define `SnapshotSource<T> { ttlMs; collect(): Promise<T> }`, a
`snapshotRoute(source)` factory returning the `GET` handler, and let the source
carry its own `Memo` from §3.1. The always-200 contract then lives in **one**
place instead of seven comments that must stay in agreement.

Note `/api/host` is the odd one out — it is the only one that 500s on failure. Fold
it in by giving it an error snapshot state like the others, or leave it explicitly
outside the factory. Decide, don't drift.

**(b) `IntegrationClient` subclasses** — `HaClient extends IntegrationClient`,
`ForgejoClient`, `NpmClient` (overriding `authHeaders` to do its JWT refresh),
`HermesClient`, `JellyfinClient`. `HaDoorbellClient extends HaClient`, since it is
genuinely a specialisation of the same host and token, currently duplicating
`ha.ts`'s credential lookup and its own `statesCache` (`ha-doorbell.ts:60`)
alongside `ha.ts`'s.

Keep both hierarchies **one level deep**. Composition over inheritance everywhere
else — the widget system in §3.4 shows why.

### 3.4 Polymorphism — extend the pattern already in `src/lib/widgets/`

`src/lib/widgets/builtins.ts` already does this correctly: a `WidgetFetcher`
function type, a `Record<type, WidgetFetcher>` registry, and callers that never
switch on type. `actions.ts` does the same for verbs. **This is the model the rest
of the codebase should follow** — cite it in review, don't re-invent it.

Three places that still branch where they could dispatch:

1. **Kiosk backdrops** → `Record<KioskTheme, () => Promise<ComponentType>>`.
   This is the same change as P1: making the registry lazy *is* the bundle fix.
   One entry per theme; adding a 17th theme stops meaning "edit `layout.tsx`".
2. **Widget actions** → already a registry; extend `arrCommand`'s "shared verb,
   different name" trick rather than adding per-service branches.
3. **Kiosk tile freshness** → `useFreshness` (`kiosk-client.ts:22`) is already the
   right abstraction. Every kiosk tile should route its loading/stale/error states
   through it instead of hand-checking `data`/`error`. The doc comment there
   already explains the exact bug that hand-checking causes.

---

## 4. Sequenced plan

Each phase ends green on `npx tsc --noEmit && npm run build`, and is independently
deployable to the test stack (port 3006, `-f docker-compose.test.yml`).

| # | Phase | Scope | Effort | Risk |
|---|---|---|---|---|
| 1 | `src/lib/cache.ts` + migrate `host-metrics`, `docker`, `forgejo` | fixes P2, P3, part of P4 | ~3 h | low — additive |
| 2 | `next/dynamic` theme registry for kiosk backdrops | fixes P1 | ~3 h | medium — visual |
| 3 | Migrate remaining 8 caches to `Memo` | finishes P4 | ~2 h | low |
| 4 | `IntegrationClient` + migrate `ha`, `ha-doorbell`, `jellyfin` | §3.2 | ~5 h | medium |
| 5 | `snapshotRoute` factory over the 7 read-only routes | §3.3a | ~2 h | low |
| 6 | `useKioskWeather` consolidation | fixes P6 | ~1 h | low |
| 7 | Cadence module + idle-aware polling | fixes P5 | ~3 h | low |
| 8 | `next/dynamic` on `/resources` tab panels | fixes P7 | ~2 h | low |
| 9 | Split `kiosk-climate.tsx`, `kiosk-surface.tsx` | §2.1 | ~4 h | medium |
| 10 | Migrate `forgejo`/`npm`/`hermes-ctl` to `IntegrationClient` | §3.2 tail | ~4 h | medium |

**Total ≈ 29 h.** Phases 1–3 deliver most of the performance win in ~8 h and can
stop there cleanly. Phases 4–5 and 9–10 are the readability payload.

Phase ordering is not arbitrary: 1 must precede 3 and 5 (they consume `Memo`);
4 must precede 10; 2 is independent and can run in parallel with 1.

---

## 5. Explicitly out of scope

- **Rewriting the comment style.** The density is unusual and it is an asset —
  `client.ts`'s telemetry visibility handling and `kiosk-client.ts`'s `useFreshness`
  comment both encode bugs that were found the hard way. Do not compress them
  during a refactor.
- **Adding a chart library, a state manager, or a test framework as a runtime
  dep.** PRODUCT.md forbids new runtime deps; a test runner would be a devDep and
  is discussed in §6, but it is a separate decision from this plan.
- **Reworking the auth or socket-proxy scope model.** Least-privilege Docker
  access is a stated product principle and the current scopes were deliberately
  approved.
- **Converting client components to server components wholesale.** The 48% figure
  is worth auditing, but this is a live-polling dashboard — most of those
  boundaries are correct and the audit is its own task.

---

## 6. The real risk: there is no test suite

`npx tsc --noEmit && npm run build` is the entire automated gate. No ESLint config,
no test runner. That makes a 29-hour refactor across the cache layer, the HTTP
layer and the route layer meaningfully dangerous.

Three mitigations, in order of value:

1. **Bias every phase towards type-level safety.** `Memo<T>` and `Probe<T>` are
   chosen partly because a botched migration becomes a compile error rather than a
   runtime surprise. Prefer discriminated unions over optional fields for the same
   reason.
2. **Test-stack walkthrough per phase**, per CLAUDE.md: every state (empty,
   loading, error, offline), at 1440 px and 390 px, zero horizontal overflow. For
   phases 2 and 9, add a contrast re-check — the kiosk theme sweep documents that
   `--color-ink-faint` has almost no headroom left at 4.5:1.
3. **Consider a devDependency test runner before phase 4.** `node:test` needs no
   install at all and would cover the pure logic that phases 1 and 3 create —
   `Memo` TTL/dedup semantics, `Probe` status classification, the format helpers.
   That is exactly the code where a silent regression is hardest to see in a browser.

---

## 7. First action

Phase 1, step 1: create `src/lib/cache.ts` with `Memo<T>`, then wrap
`getHostVitals()` (`src/lib/host-metrics.ts:519`) in a 2 s instance and point both
`/api/host` and `/kiosk/api/vitals` at it. That single change removes ~3 of every 4
host collections with a two-browser setup, and it is ~40 lines.
