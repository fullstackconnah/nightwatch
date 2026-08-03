# Theming / Design-Token Audit — Dashboard (non-kiosk)

Scope: 15 routes under `src/app/(dash)/` + `login`, ~60 non-kiosk components in
`src/components/` (kiosk-*.tsx and everything under `/kiosk` excluded per brief),
`src/app/globals.css` (lines 1–369, pre-kiosk-theme-block), against `DESIGN.md`
and `PRODUCT.md` as the system of record. Audit only — no source files edited.

## Score

**3 / 4 — good, with minor hard-coding.**

Token discipline is genuinely strong: zero drop shadows, zero default-Tailwind
gray/slate/zinc leakage, zero gradients, zero thick "alert" borders, zero
`prefers-color-scheme` branches outside `/kiosk`, and 91 `.panel` call sites
giving the surface vocabulary real consistency. What holds it back from a 4:
a documented-but-unwired 4-value color ramp duplicated as raw hex across six
files (worst offender repeats it twelve times in one file), a broken
`box-shadow` that silently defeats a documented glow effect, one component
that reinvents the status-dot idiom instead of using it, a stale color
literal that missed the kiosk-wave accessibility fix, dead CSS documented in
DESIGN.md as if it were live, and three of DESIGN.md's own literal-count
claims that have already drifted from the code they describe.

## Hard-coded literal census

| Category | Count | Files | Notes |
|---|---|---|---|
| Hex color literals in code (non-comment) | 29 | 7 | 27 are the DESIGN.md-sanctioned teal ramp; 2 are unsanctioned |
| `rgba()`/`hsl()` literals in code | 3 | 2 | 2 are a stale pre-fix color; 1 is a hand-rolled hue ramp |
| Arbitrary `text-[0.NNrem]` sub-xs literals | 147 | ~40 | DESIGN.md explicitly sanctions this idiom (no Tailwind step below `0.75rem`); see breakdown below |
| Arbitrary spacing/size brackets (`w-`, `max-w-`, `gap-`, `left-`, etc.) | 26 (19 distinct) | ~20 | mostly one-off pixel/rem values, low risk |
| `z-*` layer literals with no documented scale | 8 | 6 | `z-10/20/30/40/50`, ad hoc |

**Total literal occurrences: ~213**, of which the great majority (147 sub-xs
text sizes) are a documented, intentional pattern rather than drift. The
count that actually matters is the **32 raw color literals** (29 hex + 3
rgba/hsl) — every one of them is theming-relevant.

### Notable literals (file:line)

| Value | Where | Verdict |
|---|---|---|
| `#134e4a #0f766e #0d9488 #14b8a6` | `resources/page.tsx:107,116-121,733-736` (12x) | Sanctioned ramp, but the single worst duplication site — should import a shared constant, not retype four hexes six times in one file |
| `#134e4a #0f766e #0d9488 #14b8a6` | `disk-contents.tsx:24`, `treemap.tsx:46` | Sanctioned ramp, full 4-value array literal |
| `#0f766e #0d9488` / `#14b8a6 #0f766e` | `gpu-view.tsx:56`, `net-compare.tsx:23`, `resource-overview.tsx:180` | Sanctioned ramp, partial arrays mixed with `var(--color-accent)`/`var(--color-blue)` |
| `#2dd4bf` | `process-table.tsx:737,868` | **Not** the documented ramp — this is `--color-accent-dim`'s exact value, hand-typed into an inline `style.background` instead of `var(--color-accent-dim)` or a `bg-accent-dim` class. Direct violation of DESIGN.md's "Don't write a raw hex… into a component" rule |
| `rgba(77,97,122,0.35)` / `rgba(77,97,122,0.30)` | `drive-health.tsx:141,219` | **Stale**: `rgb(77,97,122)` = `#4d617a`, the *pre-fix* `ink-faint` value the 2026-08-03 kiosk-wave contrast pass replaced with `#657f9e`. This hatch pattern never picked up the fix — see Kiosk-wave fallout |
| `` `hsl(${...})` `` dynamic ramp | `networks/page.tsx:355` | Hand-rolled hue-shift, not expressed via any token; a fourth ad hoc color mechanism alongside the teal ramp, `var()`, and `color-mix()` |
| `text-[0.68rem]` (12x) | `container-tile.tsx`×3, `process-table.tsx`×3, `gpu-view.tsx`×2, `disk-contents.tsx`, `container-controls.tsx`, `disk-scan-jobs.tsx`, `resources/page.tsx` | DESIGN.md calls this step "drift, not a decision" at "eight places" — it has since grown to 12 |
| `text-[0.6rem]` (2x) | `log-console.tsx:356`, `(dash)/page.tsx:198` | DESIGN.md documents this as "exactly once" (the `/` keycap hint) — the same keycap-hint markup is now duplicated verbatim in a second file |
| `max-w-[9rem]` (5x) | `git-commit-stream.tsx:46`, `disk-growth.tsx:110`, `container-rail.tsx:78,115`, `resource-overview.tsx:343` | A de-facto truncation-width token nobody promoted — same candidate pattern as the kiosk wave's `text-2xs` promotion |
| `background: color` + `` `0 0 6px ${color}55` `` | `charts.tsx:87` (`Meter`) | **Bug, not a literal**: `color` is always a `var(--color-*)` string, so the template literal produces `box-shadow: 0 0 6px var(--color-bad)55` — invalid CSS. The whole declaration is dropped by the browser, so `Meter`'s fill never gets the "33% alpha glow" DESIGN.md documents under Elevation & Depth. `Gauge` (same file, line 106) does the equivalent color selection correctly and has no such bug |

## Token coverage gaps

- **The teal ramp is documented but not a real token.** DESIGN.md's own text
  says so explicitly: "This ramp exists in code as literal hex in three files
  and is not currently a CSS token." True in spirit, wrong in fact — it's
  six files today (`disk-contents.tsx`, `gpu-view.tsx`, `net-compare.tsx`,
  `resource-overview.tsx`, `treemap.tsx`, `resources/page.tsx`), 29 literal
  occurrences. This is the dashboard's single biggest token-coverage gap:
  the exact "three spellings of one number" failure DESIGN.md warns about
  for radius has already happened here, just with four numbers instead of
  one. Recommend either a shared `RAMP_TEAL` TS constant (cheapest) or
  `--color-ramp-teal-{deep,mid,DEFAULT,bright}` CSS tokens (matches how the
  kiosk wave promoted `--text-2xs`).
- **No z-index scale.** DESIGN.md documents color, type, spacing, radius and
  shadow scales but nothing for layering. Six components (`container-tile`,
  `create-container`, `log-console`, `process-table`, `settings-section-nav`,
  `side-nav`) each pick their own `z-10`–`z-50` with no documented stacking
  order, so a new sticky/overlay element has nothing to check against.
- **`--text-2xs` (0.7rem) exists as a real Tailwind utility and is used
  zero times in the dashboard.** It was promoted specifically to replace
  repeated `text-[0.7rem]` literals — but only kiosk files (`kiosk-hub`,
  `kiosk-admin-panel`, `kiosk-display`, `kiosk-status-strip`,
  `src/app/kiosk/error.tsx`) adopted it. The dashboard still carries all 132
  of its `text-[0.7rem]` occurrences as raw brackets. Not urgent — DESIGN.md
  is explicit that sub-xs sizes are meant to be literal `rem` values, not
  named steps — but if the token exists, the dashboard's Note-step literal
  is now a token with zero adopters, which is its own small inconsistency.
- **Radius tokens are fine.** `--radius-tile`/`--radius-panel` are new from
  the kiosk wave; `.panel` already consumes `var(--radius-panel)` directly
  in `globals.css:169`, so every one of the dashboard's 91 `.panel` sites
  inherits the token automatically. No bracket-radius drift found anywhere
  in non-kiosk components (`grep` for `rounded-\[` and `border-\[` returned
  only one `rounded-[inherit]`, which is a keyword, not a magic number).

## Consistency outliers

- **`drive-health.tsx` reinvents the status dot.** Every other status
  surface named in the brief (`container-tile.tsx:103`, `process-table.tsx`,
  `hermes-status.tsx:36,54`) renders state through the shared `.dot`/
  `.dot-{running,unhealthy,restarting,dead,stopped}` classes — the 8px mark
  with the 6px glow DESIGN.md calls "the system's signature." `drive-health.tsx:300`
  instead hand-rolls a `w-1.5 h-1.5` (6px, no glow) circle with
  `style={{ background: VERDICT_FILL[drive.verdict] }}`. The color values
  are token-correct (`var(--color-ok)` etc., defined at `drive-health.tsx:42-46`),
  so this isn't a raw-hex problem — it's a silhouette problem: a second,
  smaller, unglowed "status dot" shape exists in the app that a reader has
  to learn separately from the real one. This is exactly the case DESIGN.md's
  own Named Rule warns about: "If a segmented button, badge or dot needs to
  look different somewhere, the difference is probably the bug."
- **`git-status-panel.tsx` renders no status indicator at all** where the
  brief's status-dot-vocabulary list expects one — worth a product decision
  (does a repo status need a dot?) rather than a theming fix; flagged for
  visibility, not scored as a defect.
- Everything else checked for invented vocabulary came back clean: no
  `bg-gradient-to-*`, no default Tailwind `gray`/`slate`/`zinc`/`neutral`
  classes, no `border-2`/`border-[Npx]` "thick alert" borders, no
  `shadow-{md,lg,xl,2xl}` drop shadows anywhere in the non-kiosk surface.

## Kiosk-wave fallout

Checked each of the four shared changes against the dashboard:

1. **`--color-ink-faint` #4d617a → #657f9e (contrast fix).** Found one piece
   of fallout: `drive-health.tsx:141,219` hardcodes the hatch-pattern stripe
   color as literal `rgba(77,97,122,0.35)` / `rgba(77,97,122,0.30)` —
   `rgb(77,97,122)` is exactly the *old* `ink-faint` hex, typed as a raw
   triple instead of `color-mix(in srgb, var(--color-ink-faint) N%, transparent)`.
   It never picked up the brightening, so the "no telemetry" hatch texture on
   drive rows is now dimmer and slightly hue-shifted from every other
   `ink-faint`-derived surface in the app — a visible, if subtle, desync.
   No other dashboard component references this hex.
2. **New `--radius-tile`/`--radius-panel` tokens.** No fallout — see Token
   coverage gaps above; the dashboard's panel radius was already indirected
   through the CSS class, not a bracket literal.
3. **`::selection` now `color-mix(in srgb, var(--color-accent) 25%, transparent)`.**
   No dashboard component declares its own `::selection` or `selection:`
   override (checked), so the new rule cascades cleanly with no fallout.
4. **`charts.tsx`'s `Meter` gained an `sr-only` span.** No visual fallout —
   `sr-only` is correctly visually hidden and doesn't affect the bar's
   layout. Reviewing this component surfaced the unrelated `box-shadow`
   alpha-suffix bug documented above (`charts.tsx:87`), pre-existing and not
   caused by the kiosk wave, but adjacent to it.

## DESIGN.md drift

- **Ramp file count** ("exists in code as literal hex in three files") is
  stale — actually six files, see Token coverage gaps.
- **`0.68rem` place count** ("appears in eight places… container tiles, GPU
  rows, process-table footnotes, one resources row") is stale — now 12
  places across 7 files. The description is still directionally accurate
  (all four named locations still hold true) but the count undercounts by 4,
  and `container-controls.tsx` and `disk-scan-jobs.tsx` aren't mentioned at
  all.
- **`0.6rem` "exactly once… defensible one-off"** is stale — it's now in two
  files (`log-console.tsx` and `(dash)/page.tsx`) with identical markup, so
  it's drifted from "one defensible exception" toward "an uninstantiated
  shared component."
- **`.hover-reveal` is documented as a live pattern** in the Touch-Equivalent
  Rule ("`.hover-reveal` is visible by default and only becomes hover-gated
  inside `@media (hover: hover)`") but has zero `className` usages anywhere
  in the repo, kiosk included — it's dead CSS being cited as evidence of a
  design principle that no longer has a working example. See globals.css
  health below.
- Everything else in DESIGN.md's Colors, Typography, Layout, Elevation,
  Shapes and Components sections checked true against the current dashboard
  code: the 44px rule, table-or-cards rule, one-live-hue rule, threshold
  rule, and no-shadow rule all hold with no counter-examples found.

## globals.css health (non-kiosk section, lines 1–369)

- **Dead rule:** `.hover-reveal` (lines 190–207, including its
  `@media (hover: hover)` block and `:focus-within` handling) has no
  `className` consumer anywhere in `src/`. Either wire it up or remove it —
  as written it's ~18 lines maintaining a contract nothing exercises.
- **`!important` usage:** zero in the non-kiosk section (all 10 occurrences
  in the file are inside `[data-kiosk-theme=...]` blocks, which is the
  documented, scoped exception). Clean.
- **No specificity fights or utility duplication found** in the non-kiosk
  rules — `.microlabel`, `.dot*`, `.panel*`, `.logbox`, `.font-mono`,
  `.net-reveal`, `.log-arrival`/`.rail-arrival`, `.kiosk-pin-shake` (kiosk
  route, harmless here) and `.voice-mic-recording` each do one job and don't
  overlap a Tailwind utility.
- `.net-reveal`, `.log-arrival`, `.rail-arrival` are each used in exactly
  one component (`net-throughput.tsx`, `log-track.tsx`, `container-rail.tsx`
  respectively) — matches DESIGN.md's "one authored moment per surface"
  claim exactly, no drift.

## Findings

**P0 — none.** Nothing found breaks the brand commitment (dark-only, no
light-mode leakage) or causes a WCAG regression on its own merits.

**P1**
- `charts.tsx:87` — `Meter`'s `boxShadow: \`0 0 6px ${color}55\`` produces
  invalid CSS (`var(--color-bad)55`) whenever `color` is a CSS variable,
  which it always is. The declaration is dropped by the browser, so the
  documented 33%-alpha glow on every Meter fill across the app (vitals
  strip, resources page, kiosk vitals) silently never renders. Fix is a
  `color-mix()` wrapper or passing a pre-composited rgba string alongside
  the var.
- `drive-health.tsx:141,219` — hatch-pattern `rgba(77,97,122,…)` is the
  pre-2026-08-03 `ink-faint` value, hardcoded and now desynced from the
  token everywhere else in the app uses. Should read
  `color-mix(in srgb, var(--color-ink-faint) 35%, transparent)` (or similar)
  instead of a literal triple.

**P2**
- `process-table.tsx:737,868` — `background: "#2dd4bf"` is a raw hex
  duplicating `--color-accent-dim` exactly; should be
  `var(--color-accent-dim)` or `bg-accent-dim`.
- `drive-health.tsx:300` — status verdict dot is a hand-rolled 6px unglowed
  circle instead of the shared `.dot`/`.dot-*` vocabulary; inconsistent
  silhouette with every other status indicator in the app.
- Teal ramp (`#134e4a #0f766e #0d9488 #14b8a6`) duplicated as raw hex in 6
  files / 29 places, worst single-file offender `resources/page.tsx` at 12
  repeats — promote to a shared constant or CSS tokens.
- `resources/page.tsx` and `log-console.tsx`/`(dash)/page.tsx` each contain
  literal duplication (ramp array, `0.6rem` keycap markup) that DESIGN.md's
  own text no longer accurately describes — see DESIGN.md drift.

**P3**
- `.hover-reveal` is dead CSS documented as live — remove or adopt.
- No documented z-index scale; 6 files pick ad hoc `z-10`–`z-50`.
- `--text-2xs` token exists, unused in the dashboard (132 raw
  `text-[0.7rem]` literals remain) — low priority since DESIGN.md sanctions
  the literal-rem idiom for sub-xs sizes, but worth a note given the token
  was built for exactly this value.
- `max-w-[9rem]` repeated 5x across 5 files — a candidate for the same
  "found four times, promote it" treatment the kiosk wave already applied
  to `text-2xs`.
- `networks/page.tsx:355`'s dynamic `hsl()` ramp is a fourth, ungoverned
  color-generation mechanism (alongside `var()`, the teal-ramp hex array,
  and `color-mix()`) — not wrong, but worth a DESIGN.md mention if it's
  meant to be a reusable pattern rather than a one-off.
