# Coverage critique — nightwatch dashboard audit (non-kiosk)

Read-only critic pass. No source or report file edited. Ground truth: 198 non-kiosk
files / 35,701 LOC (measured 35,503 via `wc -l` on `.ts`/`.tsx` only, the extra ~200
lines are non-`.ts(x)` files not in scope here) — 15 routes, 2 layouts, 63 components,
63 lib files, 53 API routes, `middleware.ts`.

## Files never audited

**UI surface (routes/layouts/components) — fully covered, no gaps.** Cross-referencing
the coverage tables in all four applicable reports (`a11y-core.md` + `a11y-tools.md`
between them list all 15 routes, both layouts, and all 63 `src/components/**` files;
`responsive-core.md` + `responsive-tools.md` independently list the same 78 files) found
**zero** components or routes absent from every report. Every file in
`src/app/(dash)/**`, `src/app/layout.tsx`, `src/app/login/**`, and `src/components/**`
(including `ui/*`) is cited by name in at least one coverage table.

**lib/ and API surface — the opposite is true.** Of 63 files in `src/lib/`, **47 are
never named in any of the seven reports** (checked by exact whole-word filename match,
not substring):

```
ansi-escapes.ts, attention.ts, auth-server.ts, auth.ts, briefing.ts, config.ts,
container-rank.ts, disk-scan.ts, disk-usage.ts, docker.ts, forgejo-types.ts, format.ts,
gpu-types.ts, gpu.ts, ha-types.ts, hermes-ctl.ts, hermes-types.ts, host-metrics.ts,
jellyfin.ts, labels.ts, log-export.ts, log-levels.ts, metrics-history.ts,
network-types.ts, network.ts, npm-types.ts, oidc.ts, process-types.ts, processes.ts,
smart-types.ts, smart.ts, telemetry-types.ts, tiles.ts, transcode-types.ts,
use-voice.ts, utils.ts, voice.ts, weather.ts,
lib/mcp/auth.ts, lib/mcp/errors.ts, lib/mcp/protocol.ts, lib/mcp/resources.ts, lib/mcp/tools.ts,
lib/widgets/actions.ts, lib/widgets/builtins.ts, lib/widgets/index.ts, lib/widgets/jsonpath.ts
```

The remaining 16 lib files (`client.ts`, `use-ha.ts`, `use-forgejo.ts`, `use-npm.ts`,
`use-hermes.ts`, `use-log-stream.ts`, `use-log-archive.ts`, `use-now.ts`, `log-types.ts`,
`log-archive.ts`, `telemetry.ts`, `ha.ts`, `npm.ts`, `forgejo.ts`,
`widgets/types.ts`, and one more SWR hook) are cited **only** in `performance.md`'s
polling-cadence table — for request interval and visibility-pause behavior, never for
correctness of the logic inside the file. No report opens any of these 16 files to
review what they actually do beyond "polls every Ns."

**All 53 files under `src/app/api/**/route.ts` and `src/middleware.ts` are never
mentioned in any report** — 0 hits for `route.ts`, `middleware.ts`, `auth.ts`,
`auth-server.ts`, or `oidc.ts` across all seven files (one incidental "api/" substring
hit in `responsive-tools.md` is inside an unrelated URL example, not a route citation).

Net: **101 of 198 files (51%) were never opened by any of the seven audits** — the
entire server-side/business-logic half of the app. The UI half (97 files: 78 above plus
`globals.css` and the two markdown specs) was audited exhaustively and without gaps.

## Structural blind spots

**1. `middleware.ts` + auth/session surface — the most serious gap.**
`src/middleware.ts` gates every non-public route behind `isRequestAuthenticated`
(from `src/lib/auth.ts`) and redirects to `/login` on failure (`middleware.ts:33-36`).
No report examines what a user *sees* when this fires mid-session: the six `useSWR`
hooks and two `EventSource` streams documented in `performance.md` all point at
`/api/*` endpoints that the same middleware protects — once a session cookie expires,
every one of those in-flight polls/streams starts receiving `401 {"error":
"unauthorized"}` (`middleware.ts:28-29`) while the client-side page keeps rendering
whatever it last had. Nothing in the audit asks whether that reads to the user as
"Docker unreachable" (the honest-error copy `antipatterns.md` praises) or as silent
staleness, nor whether the eventual client-side navigation to `/login` preserves
enough context to return to the same page. This is exactly the class of bug the
audit's own methodology (walk every state — "empty, loading, error, offline," per
`CLAUDE.md`) was built to catch, and session-expired is a real, reachable state that
no dimension was assigned to check. `src/lib/oidc.ts` (316 lines, the SSO code path
surfaced in `a11y-core.md` P2-16 only as "the SSO button... two lines above" the
password field) is entirely unread by any report — its callback/error handling is
unverified.

**2. No error boundary anywhere under `/dash`.** Confirmed by filesystem search:
`src/app/kiosk/error.tsx` is the *only* `error.tsx`/`global-error.tsx`/`not-found.tsx`/
`loading.tsx` in the whole `src/app/` tree. `.claude/state/task-board.md:54-57`
(pre-existing project record, not this audit) states explicitly: *"the kiosk had NO
error boundary anywhere in `src/` — one render throw blanked the tablet white
forever"* — and that fix (`src/app/kiosk/error.tsx`) shipped 2026-08-03. **The
identical gap still exists for every `/dash` route today.** `antipatterns.md`'s
loading/empty/error table (the closest any report gets to this topic) checks only
whether each route's *data-fetching hook* exposes an `error` value it renders inline —
a React-render-throw (e.g. a malformed API payload hitting an unguarded `.map()`) is a
different failure mode entirely, catchable only by a route-segment `error.tsx`, and
none exists. This is the single most consequential miss: it's the exact bug class the
project already found and fixed once, just not here.

**3. 53 API routes — error-shape consistency is actually good, but nobody checked.**
A sample of ~30 routes shows near-total consistency: `NextResponse.json({error:
string}, {status})`, almost always `e instanceof Error ? e.message : "<verb> failed"`
(the same idiom `antipatterns.md` credits on the *client* side without knowing it
originates server-side). `src/app/api/settings/route.ts:24-26,48` and
`src/app/api/settings/integrations/route.ts:12-22` explicitly strip secrets
(`token`/`password`/`adminPasswordHash`) before any response body is constructed and
use a deliberate "empty patch field = keep existing secret" idiom — a real, working
secrets-safety pattern that no report saw or credited. No route sampled returns a raw
stack trace or a secret. This is a genuine gap (no one verified it) but the finding
itself is clean, not a defect — worth a confirming pass rather than a fix pass.

**4. `app/layout.tsx` metadata reuses a kiosk-named asset for the whole dashboard's
apple-touch-icon** (`icons: { apple: "/kiosk-icon-180.png" }`, `layout.tsx:19-21`),
with a code comment explaining it's intentional sharing, not a "kiosk" attribute for
the top-level dash. No report flagged this because none read `app/layout.tsx`'s full
metadata block (`a11y-core.md` and `responsive-core.md` both list `app/layout.tsx` as
"covered" but their findings — landmark/heading checks, viewport meta — don't touch
`metadata`/`icons`/`manifest`). Not a bug; just unexamined. The `favicon.ico` 404 the
brief asked about is **not** a fresh miss — it's pre-existing and already recorded in
`task-board.md:143` ("Known trivial: favicon.ico 404... repo ships icon.svg only"), so
the reports' silence on it is correct, not a gap.

**5. `loading.tsx` — none exist anywhere**, dash or kiosk. Every route relies on
client-side SWR `isLoading` states instead of route-level Suspense boundaries. Not
flagged as a defect by this critique (the SWR-driven skeletons `antipatterns.md`
documents are a legitimate alternative), but no report explicitly confirms this was a
deliberate architecture choice versus an oversight.

## Contradictions between reports

**`theming.md` vs. `a11y-core.md` + `responsive-core.md` + `responsive-tools.md` on the
44px rule — a real, evidenced contradiction.** `theming.md`'s "DESIGN.md drift"
section states: *"the 44px rule, table-or-cards rule, one-live-hue rule, threshold
rule, and no-shadow rule all hold with no counter-examples found."* This is
contradicted by three independent reports with file:line evidence:

- `a11y-core.md` P1-2: `ui/button.tsx:17-20` — `default` is `h-10` (40px), `sm` is
  `h-9` (36px), only `lg`/`touch` clear 44px — quotes `DESIGN.md:323`'s "44px Rule" by
  name and `DESIGN.md:443`'s "Don't... let a control fall below 44px on touch," then
  lists 8 concrete call sites under 44px on mobile.
- `responsive-core.md`: a full touch-target inventory table showing the Overview
  tile's action cluster at 28px (`container-controls.tsx:157`, `widget-actions.tsx:161`)
  and `PruneAction` at 36px on phone (`reclaim-shared.tsx:71-95`).
- `responsive-tools.md`: quotes `button.tsx:21-32`'s own code comment admitting the
  gap ("Every `/dash` call site keeps using `icon` unchanged") and finds four
  dismiss-error "×" buttons with **no size class at all** (~18-20px on *every*
  breakpoint, not just tablet) in `ha-lights.tsx`, `ha-switches.tsx`, `ha-climate.tsx`,
  `ha-locks.tsx`.

I re-read the source directly: `src/components/ui/button.tsx:17-20` confirms
`default: "h-10 px-4 text-sm md:h-8 md:px-3 md:text-xs"` and `sm: "h-9 px-3 text-xs
md:h-7 md:px-2"` — 40px/36px, not 44px, exactly as the three reports describe.
`DESIGN.md:323` confirms the rule's own wording: *"Every interactive target is at
least 44px tall on touch."* **The three reports are correct; `theming.md`'s "no
counter-examples found" claim for the 44px rule is factually wrong** — it appears to
have checked the rule's *intent* (no hardcoded sub-44px literal bypassing the shared
component) rather than the shared component's own default sizes, which is precisely
where the violation lives. This should be corrected in `theming.md` before scores are
finalized; the other four rules it credits (table-or-cards, one-live-hue, threshold,
no-shadow) aren't contradicted anywhere and stand as reported.

No other cross-report contradictions found — where reports overlap (e.g. `charts.tsx`'s
`Meter` covered by both a11y reports and `theming.md`; `container-controls.tsx`
covered by a11y-core and both responsive reports) their claims are compatible, just
addressing different axes (semantics vs. size vs. token literal).

## Verification of top-3 claims

**1. `a11y-tools.md` P0 — settings inputs have no programmatic label. CONFIRMED.**
`src/components/ui/input.tsx:31-33`: `Label` is `<label className={cn("microlabel
block mb-1", className)} {...props} />` — no `htmlFor` generation, no `useId()`, no
wrapping behavior. `grep -rn "htmlFor" src/` (excluding kiosk) returns exactly one
hit in the entire non-kiosk source: `src/app/login/login-form.tsx:84`. Every settings
call site the report names renders `<Label>` as a sibling, not a wrapper, with no
matching `id`. Claim stands exactly as written.

**2. `a11y-core.md` P0 — `create-container.tsx` modal has no dialog semantics, no
focus trap, no Escape. CONFIRMED.** `src/components/create-container.tsx:56-61`:
```
<div className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm ...">
  <div className="panel w-full max-w-lg p-5 space-y-4 relative">
    <button onClick={onClose} className="absolute right-3 top-3 ...">
      <X size={16} />
```
No `role="dialog"`, no `aria-modal`, no `aria-label`/`aria-labelledby` on either
`<div>`. `grep -n 'role="dialog"\|aria-modal\|Escape\|useRef\|\.focus(' create-container.tsx`
returns **zero matches** in the whole file — confirming no focus trap, no initial
focus move, and no keyboard-Escape handler anywhere. The close button has no
`aria-label` (bare `<X size={16} />`, no accessible name). Claim stands exactly as
written.

**3. `theming.md` — `charts.tsx:87`'s `boxShadow` is invalid CSS. CONFIRMED.**
`src/components/charts.tsx:87`: `boxShadow: \`0 0 6px ${color}55\`` where `color`
(lines ~70-71) is always one of the literal strings `"var(--color-bad)"`,
`"var(--color-warn)"`, or `"var(--color-accent)"`. The template literal therefore
produces the CSS value string `0 0 6px var(--color-bad)55` — appending `55` directly
after a `var(...)` function call is not valid CSS syntax (there is no way to alpha-
suffix a `var()` result this way; it would need `color-mix()` or a separate rgba
value). A browser drops the entire `box-shadow` declaration as unparseable, so the
33%-alpha glow `DESIGN.md` documents under Elevation & Depth never renders on any
`Meter` fill. Claim stands exactly as written, line number correct.

## What a second pass should cover first

1. **`middleware.ts` + `src/lib/auth.ts`/`auth-server.ts`/`oidc.ts`** — session-expiry
   UX (what six SWR hooks + two SSE streams do when their next request gets a 401)
   and the OIDC callback path, entirely unread by this audit wave.
2. **Add `error.tsx` under `src/app/(dash)/`** (or a root-level one covering it) —
   same bug class already found and fixed for `/kiosk`; currently still absent for the
   higher-traffic surface.
3. **Correct `theming.md`'s 44px-rule claim** — either retract "no counter-examples
   found" or reconcile it with the P1 findings already documented in the three sibling
   reports, before any score is treated as final.
4. **A real pass over `src/lib/*.ts` business logic and `src/lib/mcp/*.ts`** — 47 files
   with client-visible consequences (widget rendering, JSONPath extraction, MCP tool
   surface, voice pipeline) that no report has opened even once.
5. **Confirm (don't just spot-check) the 53 API routes' error-shape consistency and
   secret-stripping discipline** — the sample here looks clean and well-engineered,
   but "clean in a 30-route sample" isn't "verified across 53."
