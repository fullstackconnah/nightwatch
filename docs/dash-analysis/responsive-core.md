# Responsive / Touch Audit — Core Screens (Overview, Containers, Images, Volumes, Login, Shells)

Audit only, no source edited. Reasoned from code; dev/test stacks were not running.
Tailwind defaults confirmed (no `tailwind.config` override found — Tailwind v4 CSS-only
config in `globals.css`): `sm`=640, `md`=768, `lg`=1024, `xl`=1280.

## Score

**3 / 4** — The mobile-nav rebuild (bottom bar, More sheet, safe-area handling) and every
table→card fallback in this half are correctly implemented and preserve all information.
The gaps are all touch-*target-size* gaps, concentrated at the 768–1024px (tablet-portrait,
finger) band the brief called out, plus a couple of outliers even smaller than the app's own
32px "icon" mouse floor. Nothing here produces page-level horizontal overflow.

## Coverage table

| File | Covered | Notes |
|---|---|---|
| `(dash)/page.tsx` | ✅ | Overview grid, filter, sort segment control |
| `(dash)/containers/page.tsx` | ✅ | Table + card fallback, sort, create dialog trigger |
| `(dash)/containers/[id]/page.tsx` | ✅ | Header actions, graphs, metadata, logs card |
| `(dash)/images/page.tsx` | ✅ | Group table + card fallback |
| `(dash)/volumes/page.tsx` | ✅ | Table + card fallback |
| `login/page.tsx` (+ `login-form.tsx`) | ✅ | Server shell + client form |
| `(dash)/layout.tsx` | ✅ | Sidebar offset, content padding |
| `app/layout.tsx` | ✅ | Viewport meta, PWA manifest keys |
| `side-nav.tsx` | ✅ | Desktop sidebar, mobile top bar, bottom tab bar, More sheet |
| `container-tile.tsx` | ✅ | Overview card, dense action row |
| `container-rail.tsx` | ✅ | Standalone component (consumed by /logs, out of my routes, audited anyway) |
| `container-controls.tsx` | ✅ | LifecycleActions, OpenAppLink, PortChips, ContainerStatus, LifecycleError |
| `create-container.tsx` | ✅ | New-container modal |
| `image-groups.tsx` | ✅ | Pure data-shaping module, no markup — `RegistryChip` only render |
| `image-delete-action.tsx` | ✅ | Delete confirm two-step |
| `reclaim-images.tsx` | ✅ | Table + row fallback |
| `reclaim-volumes.tsx` | ✅ | Table + row fallback |
| `reclaim-shared.tsx` | ✅ | Shared `PruneAction` confirm two-step, `ReclaimedBanner` |
| `vitals-strip.tsx` | ✅ | Read-only, no interactive elements |
| `widget-actions.tsx` | ✅ | Detail-page action row, tile popover menu |
| `settings-tiles.tsx` | ✅ | Table + card fallback (not in a route I own, but the file was assigned) |
| `charts.tsx` | ✅ | `Sparkline`, `Meter`, `Gauge` — all decorative/read-only |
| `sparkline.tsx` | ✅ | Second, separate `Sparkline` — decorative, no interaction |
| `ui/button.tsx` | ✅ | The size scale everything above is built from |
| `ui/input.tsx` | ✅ | `Input`/`Select`/`Label` |
| `ui/segment-button.tsx` | ✅ | Shared segmented-control button |
| `ui/badge.tsx` | ✅ | Pure display, no touch surface |
| `ui/card.tsx` | ✅ | Pure layout wrapper |

## Touch-target inventory

Real px, converted per breakpoint. `button.tsx`'s scale, for reference: `default` 40→32,
`sm` 36→28, `lg` 44→36, `icon` 40→32, `touch` 56 (no shrink, kiosk-only).

| Control | File:line | <768 | 768–1024 | ≥1024 | Flag |
|---|---|---|---|---|---|
| Overview filter clear (×) | `page.tsx:193` | 44 | **24** | 24 | **P1** — smaller than the shared `icon` floor (32) |
| Settings filter clear (×) | `settings-tiles.tsx:141` | 44 | **24** | 24 | **P1** — same one-off class as above |
| Logs tail-count `<Select>` | `[id]/page.tsx:111` | 36 | **24** | 24 | **P2** — native select, sub-32 at tablet |
| `PruneAction` trigger ("Prune…") | `reclaim-shared.tsx:83-95` | **36** | 28 | 28 | **P1** — destructive action, `size="sm"`, no override |
| `PruneAction` Confirm/Cancel | `reclaim-shared.tsx:71-77` | **36** | 28 | 28 | **P1** — destructive confirm step, same gap |
| `ImageDeleteAction` trigger | `image-delete-action.tsx:96-112` | 44 | 28 | 28 | OK on phone (explicit `h-11` override) |
| `ImageDeleteAction` Confirm/Cancel | `image-delete-action.tsx:86-91` | 44 | 28 | 28 | OK on phone (explicit `h-11` override) |
| Tile `LifecycleActions` (dense) | `container-controls.tsx:157,201` via `container-tile.tsx:177` | 40 | **28** | 28 | **P1** — see write-up below |
| Tile `OpenAppLink` (dense) | `container-controls.tsx:201` via `container-tile.tsx:178` | 40 | **28** | 28 | **P1** — same cluster |
| Tile `WidgetActionsMenu` trigger | `widget-actions.tsx:161` via `container-tile.tsx:179` | 40 | **28** | 28 | **P1** — same cluster |
| `WidgetActionsMenu` menu items | `widget-actions.tsx:202` | 40 | 28 | 28 | P2 — same pattern, lower frequency of use |
| Containers table `ProcessesLink` | `containers/page.tsx:62` | 40 | 28 | 28 | P2 |
| Containers table `OpenAppLink` (non-dense) | `container-controls.tsx:201` via `containers/page.tsx:79` | 40 | 32 | 32 | Matches icon floor — OK |
| `Button` size="default" (New container, Unlock, Create&start, Cancel) | `button.tsx:17` | **40** | 32 | 32 | P2 — below the 44px PRODUCT.md standard on phone too, not just tablet |
| `Button` size="sm" (widget action row, PruneAction, dialog "add" rows) | `button.tsx:18` | **36** | 28 | 28 | P2 — same, one step worse |
| `Button` size="lg" (SSO sign-in) | `button.tsx:19` | 44 | 36 | 36 | OK on phone |
| `Button` size="icon" (generic) | `button.tsx:20` | 40 | 32 | 32 | OK per team-lead's baseline |
| Overview/Settings `Input`, `Select` | `ui/input.tsx:8,23` | 44 | 32 | 32 | OK on phone |
| `SegmentButton` (sort tabs, Customized/All) | `ui/segment-button.tsx:43` | 44 | 32 | 32 | OK |
| `ContainerRail` chips | `container-rail.tsx:73,108` | 44 | 32 | 32 | OK |
| Side-nav bottom tab bar cells | `side-nav.tsx:251` | 56 (`min-h-14`) | n/a (hidden ≥md) | n/a | OK, generous |
| Side-nav mobile top-bar icons | `side-nav.tsx:220,227` | 44 | n/a (hidden ≥md) | n/a | OK |
| More-sheet close (×) | `side-nav.tsx:381` | 44 | n/a | n/a | OK |
| More-sheet nav rows | `side-nav.tsx:402` | ≥44 (`min-h-11`) | n/a | n/a | OK |
| `ReclaimedBanner` dismiss | `reclaim-shared.tsx:113` | 44 (`min-h-11`) | 0-height override, width narrow | — | P3 — visually short but functionally 44 tall |
| Settings mobile "hide" checkbox row | `settings-tiles.tsx:214` | ≥44 (`min-h-11` on label) | n/a (desktop table swaps in) | n/a | OK — correct pattern |
| Create-container "ro" checkbox row | `create-container.tsx:147-150` | native checkbox size, **no `min-h-11` on label** | same | same | P3 — same idiom as settings-tiles but missing the floor |
| Create-container Trash icon buttons | `create-container.tsx:109,128,151` | 40 | 32 | 32 | P3 — low-frequency admin action |

## Findings

**P1 — Destructive `PruneAction` confirm step is 36px on phone, 28px on tablet/desktop —
smaller than the app's own documented standard, and inconsistent with its sibling.**
`reclaim-shared.tsx:71-95` (`ReclaimImagesPanel`/`ReclaimVolumesPanel`, i.e. both
`images/page.tsx` and `volumes/page.tsx`) uses `size="sm"` with no height override on the
prune trigger *and* both halves of the inline confirm ("Prune N images, reclaim ~X? Cancel
/ Confirm"). The file's own header comment claims: *"Danger action + explicit inline
confirm, per DESIGN.md's Touch-Equivalent and button-danger rules."* But
`image-delete-action.tsx:26,86,89` — the sibling delete-confirmation control living in the
same feature (`images/page.tsx`) — explicitly overrides to `h-11 md:h-7` (44px on phone).
One destructive-action idiom in this app gets the touch floor right; the other, used by two
of my four assigned list/detail pages, does not. On a phone this is 36px vs the 44px the
codebase treats as its own standard elsewhere (`ImageDeleteAction`, `Input`, `SegmentButton`,
the mobile nav); at 768–1024 it drops further to 28px, tied for the smallest interactive
button size found in this half. This is the highest-value fix: one shared component,
two call sites, no product-scope debate — just apply the same `className="h-11 md:h-7"`
`ImageDeleteAction` already uses.

**P1 — The Overview tile's action cluster (start/stop/restart, open-app, widget menu) is
28px at ≥768px with 2px gaps — below the 32px floor the team lead flagged as the accepted
desktop-mouse density, and it's the primary interactive surface on the route I was
assigned to audit.** `container-tile.tsx:177-179` passes `dense` to `LifecycleActions`
(`container-controls.tsx:157`: `dense && "md:h-7 md:w-7"`) and `OpenAppLink`
(`container-controls.tsx:201`: `dense ? "... md:h-7 md:w-7" : ...`), and hardcodes the same
`md:h-7 md:w-7` on `WidgetActionsMenu`'s trigger (`widget-actions.tsx:161`). Below `md` all
three are the icon variant's 40px — fine on a phone. At `md`+ they resolve to 28px, not the
shared `icon` variant's 32px. The code comment at `container-controls.tsx:133-141`
documents *why* `dense` exists (tighter for a mouse, on the assumption `md:` means mouse)
but the same assumption the team lead is asking to be checked: an iPad in portrait is
`≥768px` and is not a mouse. A tile can carry up to 3 lifecycle buttons + open-app + widget
menu in one row (`container-tile.tsx:173-182`) — up to 5 adjacent 28px targets, 2px apart,
is the tightest touch cluster in this half of the app and sits on the one route (Overview)
this audit was centered on.

**P2 — `Button`'s `default` and `sm` sizes are 40px/36px on phone, not the 44px PRODUCT.md
documents as the mobile-pass standard.** `button.tsx:17-18`. This is the size used, unmodified,
by: the Login form's primary "Unlock" submit (`login-form.tsx:95`, while the SSO button two
lines above it at `size="lg"` gets 44px — the *secondary* action on the login screen has a
larger touch target than the primary one), Containers' "New container" trigger
(`containers/page.tsx:178`), and every button in the Create Container dialog
(`create-container.tsx:97,120,139,160-162`). None of these are outright broken — 40px still
clears WCAG 2.2's 24px AA minimum comfortably — but they're inconsistent with the 44px
standard this same codebase enforces via one-off `h-11` overrides everywhere else (inputs,
image-delete, mobile nav, rail chips), and it's worth deciding once whether `default`/`sm`
should also get a `h-11` mobile floor rather than leaving it to callers to remember.

**P2 — Two outlier controls are smaller than the shared `icon` variant's own 32px floor at
tablet/desktop, both using a bespoke class instead of the shared component.** The Overview
filter's clear button (`page.tsx:193`, `h-11 w-11 md:h-6 md:w-6` → 24px) and the identical
pattern in Settings' container filter (`settings-tiles.tsx:141`, same classes) are both
hand-rolled rather than built from `Button size="icon"`, and land at 24px from `md` up —
smaller than every other icon control audited in this half. The container detail page's
log tail-count `<Select>` (`[id]/page.tsx:111`, `h-9 w-28 ... md:h-6 md:w-24`) has the same
24px-at-`md`+ problem on a native `<select>`. None of the three are destructive actions, so
severity is lower than the P1s above, but they're the smallest tap targets found in this
audit and worth batching into the same fix pass.

**P2 — Images table's repo/tag column has no `max-width` paired with its `truncate`, unlike
every sibling table in this half.** `images/page.tsx` (via `GroupRows` in `image-groups.tsx`
— wait, the row markup actually lives in `images/page.tsx:48,92,118`, not
`image-groups.tsx` which is data-only) uses `<span className="font-mono text-xs truncate" title={...}>`
with no `max-w-*`. Compare `containers/page.tsx:224` (`max-w-56 truncate`) and
`volumes/page.tsx:56,60` (`max-w-64`/`max-w-72 truncate`) — both of which correctly cap the
column so the ellipsis actually engages. Without a cap, HTML table auto-layout sizes the
column to fit the *full* untruncated ref string, so `truncate`/`text-overflow: ellipsis`
never visually fires — a 60-char registry+repo+tag string just makes the whole table wider,
and the reader scrolls the panel (contained by `overflow-x-auto`, so this never breaks the
0-overflow-at-page-level rule) to read a column that was supposed to be compact. The
mobile `GroupCard` fallback (`images/page.tsx:218`) gets this right (`truncate flex-1
min-w-0` inside a real flex row) — only the desktop table version is missing the cap.
Doesn't cost anything on a phone (card view is used below `md`), but degrades the desktop/
tablet table's own stated purpose.

**P3 — Create Container's "ro" (read-only) checkbox lacks the 44px label floor its own
sibling pattern uses.** `create-container.tsx:147-150` is the same "native checkbox +
clickable label" idiom as `settings-tiles.tsx:214` (`min-h-11` on the label), but here the
label has no `min-h-11` — just `flex items-center gap-1 text-xs`, so the effective tap
target is the line-height of 12px text, roughly 18-20px. Low frequency (only touched while
composing a one-off container) and not part of any documented card fallback, so P3 rather
than P2.

**P3 — `(dash)/layout.tsx`'s `pb-24` (96px) bottom padding may be tight against the mobile
tab bar's worst-case height.** `layout.tsx:9`. The bottom bar is `min-h-14` (56px) plus
`env(safe-area-inset-bottom)` (`side-nav.tsx:242`), which on a large-inset device (e.g. an
iPhone with the Dynamic Island in landscape, or a future device with a bigger inset) could
approach or exceed the 96px clearance, leaving the last row of a long Volumes/Images list
tucked partly under the bar. Every device I can reason about from code (iPhone home-
indicator inset is typically 34px, giving ~90px total) clears it with ~6px to spare, but
this is exactly the kind of thing that needs an actual device or emulator, not code review.

## Already correct

- **Mobile nav rebuild is solid.** `side-nav.tsx`'s bottom bar is a stable 5-cell grid
  (not the old scrolling rail), the "More" cell swaps in the active route's own icon so
  current location is never invisible, the sheet auto-closes on navigation, locks body
  scroll while open, closes on Escape/backdrop, and both the top bar and bottom bar apply
  `env(safe-area-inset-*)` correctly (`side-nav.tsx:207,242,389`).
- **Every table→card fallback in this half preserves all columns' information** —
  `containers/page.tsx`, `images/page.tsx`, `volumes/page.tsx`, `settings-tiles.tsx`,
  `reclaim-images.tsx`, `reclaim-volumes.tsx` all checked column-by-column; nothing is
  dropped between the `hidden md:block` table and the `md:hidden` card/row list.
- **`containers/page.tsx` and `volumes/page.tsx` correctly pair `truncate` with an explicit
  `max-w-*`** so the ellipsis actually engages inside table auto-layout (contrast with the
  Images-table gap above).
- **Overview's sort-tab segmented control** (`page.tsx:205-219`) uses a right-edge
  mask-image fade specifically so the horizontally-scrollable strip doesn't read as a
  layout bug at the point it clips — a deliberate, working affordance, not decoration.
  `ContainerRail`'s chip strips (`container-rail.tsx:167`) use the same contained-scroll
  pattern correctly (`overflow-x-auto` on the strip itself, never the page).
- **`VitalsStrip`'s grid** (`vitals-strip.tsx:21`) has a genuinely tuned custom breakpoint
  (`min-[420px]:grid-cols-2`) between the default single column and `lg`, rather than
  leaving a dead zone between 390 and 1024 — good attention to the actual gap.
- **No `maximum-scale`/`user-scalable=no`** in `app/layout.tsx`'s viewport export — pinch
  zoom is not disabled anywhere in this half.
- Long/unbounded text fields that matter are handled with `break-all` rather than
  `truncate` where the full value is the point (volumes' mobile name/mountpoint,
  container-detail's env/mounts/command, `LifecycleError` messages) — no silent data loss
  on wrap.

## Needs browser confirmation

- Every touch-target number above is read from Tailwind class names, not measured — worth
  a real DevTools pass at 768px and 1024px in particular, since that's the band the whole
  brief is about and no automated check catches "two 28px buttons 2px apart" as cleanly as
  actually trying to tap one on a real or emulated iPad.
- `[id]/page.tsx:188`'s container-name `<h1>` has no `truncate`/`max-w` and sits in a
  `flex-wrap` header; Docker/Compose names are hyphenated so they should soft-wrap at
  browser line-breaking opportunities, but an unusually long unbroken name is untested.
  Low likelihood given naming conventions, but code review can't rule it out.
- `WidgetActionsMenu`'s popover (`widget-actions.tsx:172-176`, `w-60` = 240px, `absolute
  right-0`) should clear the left edge at 390px given typical tile widths, but I did not
  verify against every tile-grid column configuration (1/2/3/4-column grids all host this
  same tile) — worth a look at the narrowest tile the grid ever actually produces.
- `pb-24` bottom-bar clearance (P3 above) is a real-device question, not a code one.
- I traced several nested-flex `truncate` patterns (`container-tile.tsx:104-106`,
  `containers/page.tsx:281`) closely enough to convince myself they're structurally sound
  (truncate sits directly on the shrinking flex item, with a `min-w-0 flex-1` ancestor
  providing a definite bound, and CSS's overflow-hidden-suppresses-automatic-minimum rule
  applies) — but flex/truncate interaction is a notoriously easy thing to get subtly wrong
  and impossible to fully confirm without rendering a real long container name at 390px.
  Flagging so it gets a look, not because I found a defect.
