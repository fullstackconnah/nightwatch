# Kiosk Theming / Design-Token Re-Audit

Surface: `/kiosk` — `src/app/globals.css`, `src/components/kiosk-*.tsx`, `src/app/kiosk/**`, against `DESIGN.md` as system of record. Re-audit of `docs/kiosk-analysis/audit-03-theming.md` (scored 3/4) after a claimed fix wave. Audit only — no source files were edited.

## Score (was 3/4, now 3/4)

**3 — good, materially cleaner, but a new P1 was introduced by this very wave.**

All four of the previous audit's P1 findings are genuinely fixed: `::selection` and `HATCH_PATTERN` now derive from `--color-ink-faint`/`--color-accent` via `color-mix()`, the `[data-kiosk-theme]` scope now re-declares `color` alongside `font-family` (closing the latent leak), and a real `--radius-tile`/`--radius-panel` pair exists in `@theme` with `error.tsx` consuming `rounded-tile`. Every P2 that was about *missing documentation* (the 5 themes that leave `--font-sans` unset, Chrome's borrowed mono, `LIGHT_THEMES` duplication) is now either commented in place or structurally eliminated. That's real, verifiable progress.

But the contrast-edit pass that darkened `understory`, `duotone`, and `cinderblock`'s accent hexes for AA compliance did not update `KIOSK_THEME_SWATCHES` in `kiosk-theme.tsx`, which mirrors those same two values per theme for the appearance-picker preview. The picker now shows the **pre-fix** accent colour for 3 of 16 themes — a real, reproducible bug (open the theme switcher, compare the Duotone/Understory/Cinderblock chips against the theme once applied) that this exact wave's own contrast work created. That, plus one small pre-existing literal that still didn't get converted to the new radius token, keeps this at 3/4 rather than 4/4.

## Fix verification

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `::selection` derives from theme via `color-mix` | **Fixed** | `globals.css:92-94`: `background: color-mix(in srgb, var(--color-accent) 25%, transparent);` — inherits per-scope, no hard-coded teal. |
| 2 | `HATCH_PATTERN` uses `color-mix(... --color-ink-faint ...)` in both files | **Fixed** | `kiosk-display.tsx:52-53` and `kiosk-hub.tsx:60-61` both now read `"repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--color-ink-faint) 14%, transparent) 8px 10px)"`, verbatim identical in both files with a comment cross-referencing the other. The old `rgba(77,97,122,0.14)` literal is gone from both. |
| 3 | Real radius scale: `--radius-tile`/`--radius-panel`, deliberately not `sm/md/lg` | **Fixed** | `globals.css:43-44` inside `@theme`, with a comment explaining the Tailwind-collision rationale. `error.tsx:133` uses `rounded-tile`. **Gap not claimed as fixed but worth flagging:** `kiosk-timers.tsx:516` (`PresetRow`, was `:436` in the old audit — file grew) still hand-writes `className="... rounded-[0.5rem] ..."` instead of `rounded-tile`. This is the exact literal the token was created to replace, and it's the one site that didn't get the memo — now a plainer miss since the excuse "the token doesn't exist yet" is gone. **P3** (was implicitly P1 when the token itself didn't exist; downgraded because the systemic gap — the missing token — is closed and this is now an isolated one-line oversight). |
| 4 | `color: var(--color-ink)` re-declared in `[data-kiosk-theme]` | **Fixed** | `globals.css:83-86`: both `font-family` and `color` are re-declared in the scope selector, with an updated comment explaining both re-declarations by the same mechanism. |
| 5 | `LIGHT_THEMES` deleted from `kiosk-sky.tsx`; `KIOSK_LIGHT_THEMES` in `kiosk-theme.tsx` is sole source of truth | **Fixed** | `kiosk-sky.tsx` has no local light-theme set; it imports `KIOSK_LIGHT_THEMES` (`kiosk-theme.tsx:29,110`). `kiosk-theme.tsx:142-158` defines the canonical 9-theme set with a comment directing consumers to import rather than duplicate. |
| 6 | 5 unset-`--font-sans` themes + Chrome's borrowed mono now carry intent comments | **Fixed** | Confirmed present at `globals.css:437-439` (journal), `469-471` (lounge), `691-693` (duotone), `823-825` (neon), `853-856` (pixel), and `791-794` (chrome mono borrow). All read as deliberate-rationale comments, not just a note that a hole exists. |
| 7 | `DESIGN.md` updated: radius tokens wired, kiosk dark-only carve-out, `ink-faint` hex corrected | **Fixed** | `DESIGN.md:100-101` now says `tile`/`panel` are "wired as `--radius-tile`" / "`--radius-panel`", matching the CSS. `DESIGN.md:435` adds the full kiosk carve-out paragraph naming the file, the block range, and the 9 light-ground themes. `DESIGN.md:12` `ink-faint: "#657f9e"` matches `globals.css:19` exactly. |
| 8 | Many `--color-*` values changed across theme blocks for contrast | **Verified, with a side effect** | Confirmed via the darkened/raised comments left on 15+ tokens across journal/lounge/sunroom/aerogel/bulletin/understory/duotone/cinderblock/aurora/chrome/pixel. See **Swatch-mirror drift check** below — 3 of these edits weren't propagated to the picker-preview mirror. |

## Theme × variable matrix

Read the full 869-line `globals.css` and enumerated every `--color-*` declaration inside each of the 16 `[data-kiosk-theme]` blocks (default counts as the un-scoped base). **Every block declares exactly the 14 documented tokens (`bg, panel, panel-2, line, line-bright, ink, ink-dim, ink-faint, accent, accent-dim, blue, ok, warn, bad`) once each — zero holes, zero duplicate declarations within any single block.** This directly checks the specific regression risk flagged in the brief ("one duplicate was caught and fixed during the wave, look for others") — none found. Font-token coverage is unchanged from the prior audit and is now fully accounted for by the new intent comments (item 6 above), so it's no longer a matrix gap, just a documented per-theme choice.

## Swatch-mirror drift check

**This is the headline finding.** `KIOSK_THEME_SWATCHES` (`kiosk-theme.tsx:164-181`) mirrors each theme's `bg`/`accent` for the appearance-picker chip preview, with a comment instructing "update alongside the CSS." Comparing all 16 entries against the current `globals.css` values after the contrast pass:

| Theme | CSS `--color-accent` (current) | Swatch `accent` | Match? |
|---|---|---|---|
| understory | `#a95630` (`globals.css:657`, darkened from `#b05a32`) | `#b05a32` (`kiosk-theme.tsx:174`) | **MISMATCH — stale, pre-fix value** |
| duotone | `#c0400c` (`globals.css:685`, darkened from `#c2410c`) | `#c2410c` (`kiosk-theme.tsx:175`) | **MISMATCH — stale, pre-fix value** |
| cinderblock | `#c63910` (`globals.css:714`, darkened from `#c93a10`) | `#c93a10` (`kiosk-theme.tsx:176`) | **MISMATCH — stale, pre-fix value** |
| all other 13 themes | — | — | Match (bg and accent both current) |

All three mismatches are the theme's `--color-accent` (bg was untouched on these three, so bg matches). In each case the swatch holds exactly the value the CSS's own comment names as the *old* one — i.e., the contrast-fix pass edited the CSS and left the deliberately-duplicated mirror unedited. **P1.** The appearance picker now previews the wrong accent for Understory, Duotone Press, and Cinderblock — a user choosing a theme by its chip sees one colour and gets another once applied. This doesn't affect the live kiosk (which reads CSS vars correctly, as confirmed above), but it does directly undermine the "preview an identity before it's applied" purpose the swatch duplication exists for, and it's a defect the contrast-fix wave itself introduced.

## Literal count

Recounted from scratch across the same scope (kiosk `globals.css` region, `kiosk-*.tsx`, `src/app/kiosk/**`), using the prior audit's own category boundaries (theme-block decorative `rgba()` — glows, bevels, glass shadows inside each `[data-kiosk-theme]` block — stays excluded as in-world per-theme texture, consistent with the previous audit's methodology, not a new leniency).

- **Hex: 33** (unchanged in count) — 32 in `KIOSK_THEME_SWATCHES` (3 now carrying stale content, see above) + 1 in `layout.tsx:31` (`themeColor`, still a necessary literal — `viewport.themeColor` can't consume a CSS var).
- **RGB/RGBA: 8** (down from 11) — all in `kiosk-sky.tsx`'s `PHASE_TUNING` (4 phases × glow+wash), unchanged and still accepted as a real-sun-position palette outside the token system (P2, same as before). The 3 removed are exactly the `HATCH_PATTERN` (×2 files) and `::selection` literals fixed this wave.
- **Arbitrary brackets: ~31** — breakdown: `active:scale-[0.98]` now used consistently at **17 sites** across `error.tsx`, `kiosk-glance.tsx`, `kiosk-hub.tsx` (×5), `kiosk-pin-pad.tsx`, `kiosk-timers.tsx` (×8), `kiosk-voice.tsx` — the `0.97` outlier at `kiosk-glance.tsx:129` flagged as P2 drift in the prior audit is now `0.98`, matching everywhere else (**resolved, not claimed but confirmed**); `kiosk-clock.tsx:29`'s 3 reading-sized literals (unchanged, still explicitly justified in-file); `kiosk-display.tsx:430`'s `text-[0.6rem]` (unchanged, still a single-occurrence P3, still undocumented); `kiosk-stale-tag.tsx:14`'s `text-[0.65rem]` (unchanged, still not a violation — matches the Detail step); `kiosk-timers.tsx:516`'s `rounded-[0.5rem]` (unchanged content, see Fix verification #3); ~8 assorted viewport/layout arbitrary values (`max-h-[45vh]`, `min-h-[70vh]`, `min-h-[calc(100vh-2rem)]`, `min-[900px]:`/`min-[1200px]:` breakpoints ×2, `transition-[width]`, `transition-[opacity,transform]`, `min-w-[4.5rem]`) — no action needed, same as before.

Net: total literal count is roughly flat (71 → ~72), but the *composition* improved — 3 genuine leak-causing literals were eliminated (hatch ×2, selection ×1) and replaced by zero new literals in code; the swatch-mirror problem is a **content** drift in an already-counted, already-accepted duplication, not a new literal.

## `color-mix()` support risk (documented, not a defect)

`color-mix()` needs Safari 16.2+ / equivalent Chromium ~111+. It's now load-bearing in three additional places beyond the pre-existing `log-arrival`/`rail-arrival` animations:
- `::selection` (`globals.css:92-94`): unsupported browsers fall back to the browser/OS default selection colour (not a hard failure, just an unstyled default — same as the pre-fix behavior for non-teal themes, better than before for teal-adjacent themes).
- `HATCH_PATTERN` (`kiosk-display.tsx:52-53`, `kiosk-hub.tsx:60-61`): a `color-mix()` value inside `repeating-linear-gradient()` that fails to parse invalidates the **entire** `background-image` declaration (CSS custom-property functions inside a shorthand aren't selectively ignored), so an unsupported browser shows no hatch texture at all rather than a degraded one — an empty/unconfigured panel loses its intended "textured, not blank" signal. Worth a one-line note in `DESIGN.md` or a code comment if kiosk tablets are ever fielded with an older WebView; not asked for here since this is audit-only.

## Remaining findings

- **P1 — `KIOSK_THEME_SWATCHES` mirrors stale pre-contrast-fix accent hexes for 3 of 16 themes.** See Swatch-mirror drift check. `kiosk-theme.tsx:174-176` need `#a95630`, `#c0400c`, `#c63910` respectively to match `globals.css:657,685,714`.
- **P3 — `kiosk-timers.tsx:516` still hand-writes `rounded-[0.5rem]` instead of the now-real `rounded-tile` utility.** Same content as the prior audit's P1 finding, downgraded because the systemic problem (no token existed) is fixed; this is now one stray call site that missed the memo, not a structural gap.
- **P3 — `kiosk-display.tsx:430`'s `text-[0.6rem]` remains a single-occurrence, undocumented off-ramp size**, matching neither the Tick (`0.5rem`) nor Detail (`0.65rem`) step. Unchanged from prior audit, still low blast radius (one rain-percentage caption).
- **Risk note — `color-mix()` is now load-bearing in `::selection` and both `HATCH_PATTERN` sites**, on top of the pre-existing log/rail arrival animations. See dedicated section above; not a defect, a documented degradation path.

## Already correct (confirmed again this pass)

- Every one of the 16 theme blocks fully overrides all 14 color tokens with no holes and no intra-block duplicates (re-verified by reading the complete file, not sampling).
- `Gauge`/`Meter`/`.dot-*` primitives still consume `var(--color-*)` directly — untouched by this wave, still reskin for free.
- `KIOSK_THEME_SWATCHES`' hex duplication is still the one *intentionally* accepted duplication (comment present, instructs future editors to sync) — the problem is that instruction wasn't followed this pass, not that the pattern itself is wrong.
