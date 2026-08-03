# Dashboard audit (everything except /kiosk) — 2026-08-03

Surface: 15 routes, 2 layouts, 63 components, 63 lib files, 53 API routes —
**198 files / 35,701 LOC**. Register: **product** (design serves the task).
Seven parallel audits plus a completeness critic that checked their coverage
against the real file inventory and re-verified the top findings from source.

Dimension docs: `a11y-core.md` · `a11y-tools.md` · `responsive-core.md` ·
`responsive-tools.md` · `performance.md` · `theming.md` · `antipatterns.md` ·
`coverage-critique.md`

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | **1/4** | A P0 in each half: settings forms have no programmatic labels; the one real modal has no dialog semantics |
| 2 | Performance | **2/4** | `/resources` re-sorts and re-renders every row once a second, in any tab; no virtualisation anywhere |
| 3 | Responsive | **3/4** | Solid mobile rebuild; touch targets breach the app's own 44px rule at tablet widths |
| 4 | Theming | **3/4** | Strong token discipline; 32 colour literals, teal ramp duplicated 29× across 6 files |
| 5 | Anti-Patterns | **3/4** | No bans hit. Does not read as generated. One real crack: `/containers` has no error state |
| **Total** | | **12/20** | **Acceptable — significant work needed** |

For comparison the kiosk scored 13/20 before its fix wave and 17/20 after.

## Anti-Patterns Verdict

**Does it read as AI-generated? No.** Bespoke SVG charts, a named design system
with rules like "The Bottom-Heavy Ramp Rule" and "The Hatch-Not-Empty Rule",
comments that argue with earlier versions of themselves, and zero instances of
any banned decorative trope. Not template output.

**Product trust test: mostly passes, with one crack.** `/containers` — the most
used inventory page in the app — destructures `useContainers()` without `error`,
so a downed Docker socket renders an infinite "loading…" while all ten sibling
routes show an honest "Docker unreachable" from the same hook.

## Coverage — what was and was not audited

**UI surface: complete.** All 15 routes, both layouts and all 63 components
appear by name in at least one coverage table, independently listed by the a11y
pair and the responsive pair. Zero gaps.

**`src/lib/`: 47 of 63 files were never examined by any report** — including
`auth.ts`, `oidc.ts` (316 lines), `docker.ts`, `host-metrics.ts`, `smart.ts`,
`processes.ts`, `network.ts`, the five `lib/mcp/*` files and the four
`lib/widgets/*` files. These are mostly server-side data layers, which is why no
UI dimension reached them, but the auth pair has direct user-visible
consequences (below).

**53 API routes** were in scope only for client-facing cost, not for
error-shape consistency or response-surface review. Not covered.

## Structural blind spots (nobody was assigned these)

**[P0] There is no error boundary anywhere under `/dash`.** Filesystem search
confirms `src/app/kiosk/error.tsx` is the *only* `error.tsx` / `global-error.tsx`
/ `not-found.tsx` / `loading.tsx` in the entire `src/app/` tree. This is exactly
the defect just fixed on the kiosk — a single render throw on `/resources` or
`/logs` blanks the page with no recovery — and it is still live on every
dashboard route. The kiosk fix was scoped to the kiosk; the class of bug was not.

**[P1] Session expiry has no examined UX.** `middleware.ts:33-36` redirects
unauthenticated navigations to `/login`, but the six SWR hooks and two
EventSource streams all point at `/api/*` behind the same middleware. When a
session cookie expires mid-session, in-flight polls start receiving
`401 {"error":"unauthorized"}` while the page keeps rendering its last data.
Nobody checked whether that surfaces as an honest error or as silent staleness,
or whether the eventual redirect preserves enough context to return. `oidc.ts`'s
callback and error handling is entirely unread.

## P0 findings

**P0-1 — Settings forms have no programmatic labels.** `ui/input.tsx:31-33`:
`Label` renders a bare `<label>` with no `htmlFor`, no `useId()`, and it is a
*sibling* of the input rather than a wrapper, so there is no implicit
association either. Across the four settings panels: **34 `<Label>`, 27
`<Input>`, zero `htmlFor`, zero `id`**. A `grep` for `htmlFor` across all
non-kiosk source returns exactly one hit, in `login-form.tsx:84`. A screen-reader
user cannot distinguish "Current password" from "New password" from "Confirm".
WCAG 1.3.1 / 4.1.2. → `/impeccable harden`

**P0-2 — `create-container.tsx` is a modal with none of the semantics.**
`create-container.tsx:56-61` is a `fixed inset-0 z-50` backdrop-blur modal with
no `role="dialog"`, no `aria-modal`, no accessible name, no focus trap, no
initial focus move, no Escape handler, and a close button that is a bare
`<X size={16} />` with no `aria-label`. A grep for `role="dialog"|aria-modal|
Escape|\.focus\(` returns **zero matches in the whole file**. `side-nav.tsx`'s
`MoreSheet` implements all of this correctly in the same codebase.
→ `/impeccable harden`

**P0-3 — No error boundary under `/dash`** (see blind spots above).
→ `/impeccable harden`

## Selected P1 findings

**The shared `Button` violates the design system's own 44px Rule.**
`ui/button.tsx:17-20` — `default` `h-10` (40px), `sm` `h-9` (36px), `icon`
`h-10 w-10` (40px). Only `lg` (44px) and the kiosk-only `touch` (56px) clear it.
`DESIGN.md:323` states *"Every interactive target is at least 44px tall on
touch"* and `DESIGN.md:443` repeats it as a hard Don't; `PRODUCT.md:45` commits
to the same. This is the systemic root of most responsive findings — the kiosk P0
fixed last wave was one symptom. → `/impeccable adapt`

**Controls with no size class at all.** The dismiss-error "×" in `ha-lights.tsx:98`,
`ha-switches.tsx:72`, `ha-climate.tsx:157`, `ha-locks.tsx:136` render at ~18-20px
on **every** breakpoint. → `/impeccable adapt`

**Destructive confirm smaller than the standard it cites.** `reclaim-shared.tsx:71-95`
(`PruneAction`, used by both `/images` and `/volumes`) is `size="sm"` — 36px on
phone, 28px at ≥768px — while its own header comment claims it follows the
Touch-Equivalent rule, and its sibling `image-delete-action.tsx:26,86,89`
overrides to `h-11 md:h-7` correctly. → `/impeccable adapt`

**Overview tile action cluster at 28px** (`container-controls.tsx:157`,
`widget-actions.tsx:161`), and two controls at **24px** at tablet width (filter-clear,
log tail-count select) — the smallest interactive targets in the app.
→ `/impeccable adapt`

**`/resources` re-renders everything once a second.** `resources/page.tsx:603`
takes `latest = samples[samples.length-1]`, a fresh object on every 1 Hz telemetry
tick, into a `useMemo` dep (`:605-619`), so the container list re-sorts and every
unmemoized `ContainerRow` (`:396-540`) re-renders each second for as long as the
route is open. `Treemap`'s `layoutTreemap` (`treemap.tsx:117`) is likewise
unmemoized, re-running the squarify layout and repositioning ~20-24 cells every
tick. **The two SSE streams do not pause on `visibilitychange`** (SWR polls do),
so this continues in a backgrounded tab. → `/impeccable optimize`

**`/containers` has no error state** — infinite "loading…" on a downed socket,
unlike ten sibling routes. → `/impeccable harden`

**`Meter`'s glow is dead CSS.** `charts.tsx:87` builds
`boxShadow: \`0 0 6px ${color}55\`` where `color` is always `"var(--color-bad)"`
etc., producing `0 0 6px var(--color-bad)55` — invalid, silently dropped. The
documented glow has never rendered on any Meter, anywhere. → `/impeccable polish`

**36 role×surface contrast pairs fail on `panel-2`.** The kiosk contrast wave
verified every theme against `bg` and `panel` but not `panel-2`, which all 15
themes declare and the dashboard uses widely. Failures include the dashboard's own
default `ink-faint` at **4.23:1**, `chrome` at 3.91:1, and status roles across
sunroom, understory, cinderblock, duotone, bulletin, slate and folio. This
affects the kiosk too. → `/impeccable polish`

**Pre-fix literals decoupled from the token.** `drive-health.tsx:141,219` hatch
patterns hard-code `rgba(77,97,122,…)` — the *old* `ink-faint` — so they never
received the contrast brightening. `process-table.tsx:737,868` hard-codes
`#2dd4bf` (= `--color-accent-dim`). → `/impeccable extract`

**Three divergent confirmation idioms for danger-tier actions**, with no
documented rule for which applies when: inline two-step Cancel/Confirm
(`reclaim-shared.tsx`, `image-delete-action.tsx`, `settings-integrations.tsx`,
`widget-actions.tsx`), a different pattern at the HA Lock/Unlock control, and
Stop, which just fires. → `/impeccable clarify`

**Missing table semantics and announcements.** `listening-ports.tsx:111-117` is a
4-column table with no `<th>`/`<thead>`; `scope="col"` missing in `proxy-routes.tsx`,
`gpu-view.tsx` (×2), `git-mirror-panel.tsx`. Async results never announced in
`hermes-actions.tsx`, `hermes-ask.tsx` (whose textarea also has no accessible
name), `disk-scan-jobs.tsx`, `git-mirror-panel.tsx` — while `log-track.tsx` gets
this exactly right. `process-table.tsx:547`'s `aria-live="polite"` row count
re-announces on every 2 s poll (over-announcing). → `/impeccable harden`

**No skip link** on a layout that puts 13-16 focusable sidebar items before page
content on every route. → `/impeccable harden`

**`settings-widgets.tsx:177` missing `min-w-0`** — real overflow risk at 390px.
→ `/impeccable adapt`

## Contradiction found between reports (resolved)

`theming.md` claimed *"the 44px rule … holds with no counter-examples found."*
Three other reports contradict it with file:line evidence, and the critic
re-read `ui/button.tsx:17-20` directly to confirm `default: h-10` / `sm: h-9`.
**`theming.md` is wrong on this point**; the 44px rule is breached systemically.
Everything else in that report verified.

## Patterns & Systemic Issues

1. **The design system documents rules the shared components don't enforce.** The
   44px Rule is stated twice in `DESIGN.md` and committed to in `PRODUCT.md`, yet
   the base `Button` ships three variants below it. Rules that live only in prose
   drift; the fix is a size scale that cannot express a sub-44px touch target.
2. **Correct patterns exist in-repo and were not propagated.** Dialog semantics
   (`side-nav.tsx` MoreSheet), touch overrides (`image-delete-action.tsx`), live
   regions (`log-track.tsx`), error states (ten routes) — each is done right
   somewhere and missing elsewhere. Nearly every P0/P1 here is "copy the sibling
   that already got it right", not new design.
3. **Literals decouple silently from tokens.** Three separate places hold a
   colour that *was* correct when written and no longer matches its token. Nothing
   catches this; the kiosk's swatch mirror had the identical failure last wave.
4. **Fixes were scoped to a surface rather than to a class of defect.** The kiosk
   got an error boundary, a touch variant, and a contrast pass; `/dash` shares the
   same components and got none of them. `panel-2` shows the same shape — two of
   three surfaces were fixed because two were the ones being looked at.

## Positive Findings

- Every wide table has a real card fallback that preserves all columns, and every
  hand-rolled SVG chart uses `viewBox` + `preserveAspectRatio` + `w-full` with only
  height fixed — the classic fixed-viewBox overflow trap occurs zero times.
- `/logs` wraps 549-character lines rather than scrolling horizontally, coalesces
  via rAF, and batches IndexedDB writes.
- `settings-*` is a model of consistency: shared Card/CardHeader/CardTitle, one
  write-only `SecretField` for every secret, one staggered skeleton treatment.
- `log-track.tsx`'s log/live-region split, `ansi.tsx`'s token-bent SGR palette,
  `thermal-gauge.tsx`'s `role="img"` with a full-sentence label, `process-table.tsx`'s
  SortHeader, `ha-locks.tsx`'s two-step confirm, and the two-step destructive
  confirms on log purge and integration clear are all genuinely well built.
- Zero drop shadows, zero stray Tailwind grays, zero gradients, focus-visible rings
  at ~13:1 applied almost everywhere.

## Recommended Actions

1. **[P0] `/impeccable harden`** — dialog semantics + focus trap for
   `create-container.tsx`; `htmlFor`/`useId` through `ui/input.tsx`'s `Label`;
   `error.tsx` for `/dash`; `/containers` error state; live regions for the four
   silent async surfaces; table semantics.
2. **[P1] `/impeccable adapt`** — rebuild the `Button` size scale so a sub-44px
   touch target is not expressible, then fix the call sites that bypass it
   (HA dismiss ×, `PruneAction`, overview tile cluster, the two 24px controls).
3. **[P1] `/impeccable optimize`** — memoize `/resources`' derived rows and the
   treemap layout; pause SSE on `visibilitychange`; consider row virtualisation
   for `process-table.tsx`.
4. **[P1] `/impeccable polish`** — `panel-2` contrast across all 16 themes
   (kiosk included); the dead `Meter` glow.
5. **[P2] `/impeccable extract`** — promote the teal ramp (29 occurrences, 6 files),
   add a z-index scale, retire the decoupled literals.
6. **[P2] `/impeccable clarify`** — one documented rule for when a destructive
   action needs confirmation, then align the three idioms.
7. **A second pass should cover** the 47 unaudited `src/lib/` files, the 53 API
   routes' error-shape consistency, and the session-expiry UX end to end.
