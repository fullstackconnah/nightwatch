# Kiosk Accessibility Re-Audit

Scope: `/kiosk` — `src/app/kiosk/**`, `src/components/kiosk-*.tsx`, `src/app/globals.css`,
`src/components/charts.tsx`. Audit only, no source files modified. Re-verifies the 8 fixes
claimed against `docs/kiosk-analysis/audit-01-a11y.md` (previous score 2/4) and hunts for
anything new or missed.

## Score (was 2/4, now 3/4)

**3 — AA mostly met.** All five structural/P1 violations from the previous pass are
genuinely resolved: the contrast sweep (independently recomputed below) confirms zero
failures across all 128 theme×role pairs, both modals now have real dialog semantics with
correctly-wrapping focus traps, pinch-zoom is restored, and the page has a real heading
outline where it didn't before. Nothing claimed as fixed was actually still broken.

Held back from 4/4 by three P2/P3 gaps, all newly surfaced by this pass rather than
regressions: `WeatherUnconfigured`/`WeatherUnreachable` didn't get the same `role="status"`
treatment their Hub siblings did (inconsistent live-region coverage across an identical
component pattern); the heading promotion only reached the Hub's five sections, so Weather
and Morning Briefing remain outside the heading outline entirely; and one interactive
control (`kiosk-timers.tsx`'s "Clear" button) still uses `ink-faint` as its own label color,
the exact anti-pattern the Glance Admin button fix was meant to eliminate elsewhere.

## Fix verification

| # | Claimed fix | Verified? | Evidence |
|---|---|---|---|
| 1 | `--color-ink-faint` (and other roles) raised in every failing theme; all 16 themes × 8 roles now ≥4.5:1 vs both ground and panel | **Yes** | Independent script (below) parsing `globals.css` fresh — 0 failures across 128 theme×role pairs / 256 comparisons. Matches the claim exactly. |
| 2 | Glance Admin button `text-ink-faint` → `text-ink-dim` | **Yes** | `kiosk-glance.tsx:236` — `className="… text-ink-dim …"`, with an inline comment explaining why (interactive control, not a caption). |
| 3 | Single `sr-only` `<h1>` on the page; hub captions promoted to `<h2>` via `SectionHeader` | **Yes** | `kiosk/page.tsx:198` — `<h1 className="sr-only">nightwatch kiosk</h1>`. `kiosk-hub.tsx:308` — `SectionHeader` renders `<h2 className="microlabel">{label}</h2>`, used by Lights/Switches/Scenes/Climate/Sensors (`:333,385,435,586,599`). No duplicate `<h1>`, no level jumps (h1→h2 only). |
| 4 | Pinch-zoom re-enabled — `maximumScale`/`userScalable` removed | **Yes** | `kiosk/layout.tsx:30-44` — `viewport` only sets `themeColor`, `viewportFit`, `width`, `initialScale`; comment explicitly notes the removal and why. |
| 5 | Both modals gained `role="dialog"`, `aria-modal`, `aria-labelledby`, `tabIndex={-1}`, Tab/Shift+Tab trap, Escape, initial focus + restoration, scrim `onPointerDown` guard | **Yes** | `kiosk-pin-pad.tsx:141-149` and `kiosk-timers.tsx:357-363` both carry the full set. Focus-trap logic (`onDialogKeyDown`, both files) correctly wraps Shift+Tab from first→last and Tab from last→first, and falls back to focusing the container when nothing is focusable. Initial-focus effects (`kiosk-pin-pad.tsx:34-40`, `kiosk-timers.tsx:291-297`) capture `document.activeElement` before moving focus and restore it on unmount. Scrim guards (`kiosk-pin-pad.tsx:137-139`, `kiosk-timers.tsx:353-355`) are scoped with `e.target === e.currentTarget`, so they do not intercept the timers modal's own text `<input>` (`kiosk-timers.tsx:543-549`) — confirmed by tracing: a pointerdown on the input bubbles with `target !== currentTarget`, so `preventDefault` never fires there. |
| 6 | `Meter` gained `role="progressbar"`, `aria-valuenow/min/max`, optional `aria-label`, `sr-only` percent | **Yes** | `charts.tsx:73-84`. Both call sites (`kiosk-vitals.tsx:35,47`) render it without an explicit `label`, which is fine — `aria-label` is optional per the component's own contract, and the numeric value is still exposed via `aria-valuenow` and the `sr-only` percent span either way. |
| 7 | `role="status"` on the hub's four state panels, deliberately not on `HubSkeleton` | **Yes** | `HubLoadError` (`kiosk-hub.tsx:658`), `HubUnconfigured` (`:676`), `HubStatusIssue` (`:688`), `HubEmpty` (`:700`) all carry `role="status"`. `HubSkeleton` (`:630-654`) carries none — correct, a loading skeleton isn't a status announcement. |
| 8 | `.dot-unhealthy`/`.dot-restarting` gained a `prefers-reduced-motion: reduce` branch | **Yes** | `globals.css:152-157` — both selectors set `animation: none` under the media query, with a comment confirming the dots stay distinguishable by hue/glow at rest. |

No false positives: every one of the 8 claimed fixes is genuinely complete as described.

## Contrast sweep (recomputed)

Independent script, re-parsing `globals.css` directly (not trusting the previous audit's
transcribed values or the CLAUDE.md summary) — reads the base `@theme` block plus each
`[data-kiosk-theme="…"]` block's *first* brace group (excluding nested `* {}` / `.panel {}`
rules), alpha-composites translucent panels (`aerogel` `#ffffff8c`, `aurora` `#151329d9`)
onto their theme's own `bg`, and computes WCAG relative-luminance contrast for all 8 ink/status
roles (`ink`, `ink-dim`, `ink-faint`, `accent`, `ok`, `warn`, `bad`, `blue`) against both
`panel` and `bg`, across all 16 themes — 128 theme×role pairs, 256 comparisons.

**Result: zero failures below 4.5:1, zero below 3:1.** This independently confirms the
claim — every ink/status role clears AA body-text contrast against both grounds in every
theme.

Worth flagging as a maintenance risk (already called out in the project's own CLAUDE.md):
34 of the 256 comparisons clear 4.5:1 by less than 0.1 — e.g. `default`/`ink-faint` vs panel
at 4.510:1, `bulletin`/`warn` at exactly 4.500:1 vs both grounds, `cinderblock`/`accent` vs
bg at 4.501:1. This is expected — the tokens were tuned to the floor, not padded — but it
means **any** future palette edit (a new theme, a darkened token, a re-tinted accent) must
re-run this sweep; there is no headroom left to eyeball.

```js
// same WCAG relative-luminance / contrast-ratio math as the original audit,
// re-run fresh against the current globals.css rather than reusing its output
function relLum({r,g,b}) { const c=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*c(r)+0.7152*c(g)+0.0722*c(b); }
function contrast(rgb1, rgb2) { const L1=relLum(rgb1), L2=relLum(rgb2);
  return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); }
// panel/fg alpha-composited onto the theme's own bg before comparing
```

## Remaining findings

**P2 — `WeatherUnconfigured`/`WeatherUnreachable` still lack `role="status"`.**
Location: `kiosk-display.tsx:280-300`. The original audit's finding 6 grouped these two
components together with the Hub's four state panels as the same class of transition that
needs a live-region role. Only the Hub side got fixed (fix #7) — these two weather states
were left out, so they're now the odd ones out next to their own sibling pattern
(`WeatherBand` at `:548-573` mirrors `HubUnconfigured`/`HubStatusIssue` almost
line-for-line, per the file's own "mirrors kiosk-hub's Hub* states" comment at `:278`, but
didn't get the same role). A screen-reader user glancing away when weather drops out gets
no announcement, while the equivalent Home Assistant drop-out now does.

**P2 — Heading promotion didn't reach Weather/Briefing captions.**
Location: `SectionLabel`, `kiosk-display.tsx:257-264`, used by `WeatherBand` (no caption at
all, just the panel) and `BriefingCard`'s "Morning Briefing" (`:584,596,612`) — still a plain
`<span className="microlabel">`, not a heading. The core P1 violation ("zero heading elements
anywhere") is genuinely fixed — the page has a real h1→h2 outline now — but that outline
only covers Lights/Switches/Scenes/Climate/Sensors. A screen-reader user navigating by
heading never lands on the weather panel or the morning briefing section; they're still
`.microlabel` spans, invisible to that navigation strategy. Not a re-open of finding 1 (the
literal violation is resolved), but the original recommendation named *both* `SectionLabel`
and `SectionHeader` for promotion and only one was done.

**P3 — `kiosk-timers.tsx:570` "Clear" button uses `ink-faint` as its own label color.**
Location: `CustomRow`, `kiosk-timers.tsx:565-573` — `className="… text-ink-faint …
hover:text-ink-dim …"`, label text is literally "Clear" with no other accessible-name
source. This is exactly the anti-pattern the Glance Admin button fix (verified fix #2 above)
was written to eliminate — that fix's own inline comment states the rule plainly:
"`ink-faint` … is an interactive control, not a caption, so it gets `ink-dim` regardless."
This button sits inside the timers modal's `.panel` background, and the contrast sweep above
confirms `ink-faint` vs `panel` clears 4.5:1 in every theme today, so this is not currently a
WCAG failure — but it's inconsistent with the rule already established and applied
elsewhere in the same file's own sibling controls (Presets buttons use `ink-dim`,
`kiosk-timers.tsx:516`), and per the margin note above there's no headroom left in several
themes, so this control has less safety margin than its neighbors for no reason. Recommend
`text-ink-faint` → `text-ink-dim` here for consistency, same one-line fix as #2.

Everything else the previous audit flagged as P2/P3 and *not* claimed as fixed in this wave
remains open, unchanged, not re-verified in detail here since it was out of scope for this
pass: `Gauge`'s SVG still isn't `aria-hidden` (`charts.tsx:110`), section `<section>`
landmarks still lack `aria-labelledby`, the night overlay's wake gesture is still
pointer-only (`kiosk-display.tsx:695`), truncated names still rely on hover-only `title`,
low-battery emphasis is still color-only, and the countdown texts still aren't live regions.
None of these were claimed as fixed, so none count against the fix-verification table above.

## New issues introduced

**None found.** Specifically checked and clean:

- Both focus traps wrap correctly in both directions (Shift+Tab from first→last, Tab from
  last→first) and handle the empty-focusable-list edge case by focusing the container itself.
- Neither scrim `onPointerDown` guard suppresses focus for a legitimate control inside its
  own dialog — the pin pad has no input to check against (confirmed no `<input>` in that
  file), and the timers modal's guard is correctly scoped away from its text `<input>`.
- The new `<h2>`s produce a sane, jump-free outline (h1 → h2×5, no duplicate `<h1>`, no
  skipped levels) — the gap is coverage (see P2 finding above), not structure.
- No other interactive control's own label regressed onto `ink-faint` — grepped every
  `text-ink-faint` occurrence across `kiosk-*.tsx`; all but the one P3 finding above are
  either `aria-hidden` decorative icons, secondary/subtitle text paired with a bolder primary
  label, or placeholder text — the one genuine violation is called out above and is not new
  to this fix wave (pre-existing, just not previously flagged).
- No non-text UI (focus rings, borders, status dots) contrast regression — `--color-accent`
  (focus rings) and status-dot colors are covered by the same sweep above (all roles, not
  just `ink-faint`) and all clear 4.5:1, well above the 3:1 non-text floor.
