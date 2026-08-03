# A11y audit — /dash core screens

Scope: Overview, Containers (list + detail), Images, Volumes, Login, and the shared
dash/root layout + the component set listed in the brief. Audit only, no source edited.
Contrast computed with a WCAG-2.1 relative-luminance script (alpha-composited where a
token is used as a tint, e.g. `bg-warn/5`, `bg-panel-2/60`), not eyeballed — script at
`C:\Users\Work\AppData\Local\Temp\claude\...\scratchpad\dash-a11y-contrast.js` (session-local).
Token values used: current post-kiosk-fix `@theme` block in `globals.css:7-45`
(`--color-ink-faint: #657f9e`, etc.) — the *raised* values, not the pre-fix ones.

## Score

**1 / 4 — major gaps.**

The foundation is real: focus-visible rings are solid-accent and applied almost
everywhere (~13:1, no contrast concern), the two-step inline-confirm pattern for
image delete/prune is implemented consistently and correctly, most icon buttons
*do* carry `aria-label`, heading order is correct on 5 of 6 routes, and contrast
is AA on nearly every solid text/background pair. It does not fail WCAG A wholesale.
But it doesn't clear "partial" either: a genuine modal (`create-container.tsx`) has
no dialog semantics, no focus trap, no Escape, and an unlabeled close button; there
is no skip link on a layout whose sidebar puts 13–16 focusable items before page
content on every route; form labels in two files are visually-adjacent but not
programmatically associated; and 4 of 6 async-error surfaces silently fail to
announce to screen readers where 2 siblings in the same codebase got it right. These
are breadth-and-severity issues across A **and** AA criteria, not edge cases.

## Coverage table

| Item | Audited | Findings |
|---|---|---|
| `(dash)/page.tsx` (overview) | ✅ | 1 (contrast, shared) |
| `(dash)/containers/page.tsx` | ✅ | 3 |
| `(dash)/containers/[id]/page.tsx` | ✅ | 3 |
| `(dash)/images/page.tsx` | ✅ | 1 (shared contrast) + 1 correct pattern |
| `(dash)/volumes/page.tsx` | ✅ | 1 (shared: th scope) |
| `login/page.tsx` + `login/login-form.tsx` | ✅ | 4 |
| `(dash)/layout.tsx` | ✅ | 1 (skip link) |
| `app/layout.tsx` | ✅ | 0 (clean — `<html lang="en">` set, no landmark issues at this level) |
| `side-nav.tsx` | ✅ | 2 |
| `container-tile.tsx` | ✅ | 0 (overlay-link pattern verified sound) |
| `container-rail.tsx` | ✅ | 1 (contrast: opacity-60 state label) |
| `container-controls.tsx` | ✅ | 0 — reference-quality (`aria-label`, `role="alert"`) |
| `create-container.tsx` | ✅ | 5 (dialog semantics, labels, unlabeled buttons, live region, required) |
| `image-groups.tsx` | ✅ | 0 — reference-quality (`aria-expanded`, `aria-label`) |
| `image-delete-action.tsx` | ✅ | 1 (live region) |
| `reclaim-images.tsx` | ✅ | 0 |
| `reclaim-volumes.tsx` | ✅ | 0 |
| `reclaim-shared.tsx` | ✅ | 1 (live region) |
| `vitals-strip.tsx` | ✅ | 1 (Meter regression: missing label) |
| `widget-actions.tsx` | ✅ | 0 — reference-quality (`role="menu"`, `role="status"`) |
| `settings-tiles.tsx` | ✅ | 2 (label association, unlabeled checkbox) |
| `charts.tsx` | ✅ | 2 (Meter label under-adopted by caller; Sparkline missing `aria-hidden`) |
| `sparkline.tsx` | ✅ | 0 — reference-quality (`aria-hidden="true"` present; contrast this against `charts.tsx`'s own `Sparkline`, which lacks it) |
| `ui/button.tsx` | ✅ | 1 (size scale under DESIGN.md's own 44px rule) |
| `ui/badge.tsx` | ✅ | 0 |
| `ui/input.tsx` | ✅ | 0 |
| `ui/card.tsx` | ✅ | 1 (`CardTitle` not a heading element) |
| `ui/segment-button.tsx` | ✅ | 0 — reference-quality (`aria-pressed`, `aria-label`) |

## Findings

### P0

**P0-1 — `create-container.tsx` modal has no dialog semantics, no focus trap, no Escape, and an unlabeled close button.**
`create-container.tsx:57` (`<div className="fixed inset-0 z-50 ...">`) is a real modal
(blocks the page, `z-50`, backdrop blur) but carries no `role="dialog"`, no
`aria-modal="true"`, no `aria-label`/`aria-labelledby`. Screen reader users get no
signal they have entered a modal context. There is no focus trap and no initial-focus
move — focus stays wherever it was when "New container" was clicked
(`containers/page.tsx:178`). There is no `Escape`-to-close handler anywhere in the
file (contrast with `side-nav.tsx`'s `MoreSheet`, which does have one —
`side-nav.tsx:347-354`). The only way out is the X icon button
(`create-container.tsx:59-61`, `<X size={16} />`) or "Cancel" — and the X button has
**no `aria-label`**, so it exposes to assistive tech as an unnamed button. This is the
one true modal dialog in my assigned scope and it fails the ARIA APG dialog pattern on
every axis. WCAG 4.1.2 (Name, Role, Value) for the button; the missing role/modal/trap
is a serious deviation from the established modal pattern even if no single SC names
"focus trap" directly. Fix: wrap in `role="dialog" aria-modal="true" aria-labelledby`
pointing at the "New container" `h2`, move focus to the dialog (or first field) on
mount, restore focus to the trigger on close, add an `Escape` handler, and give the X
button `aria-label="Close"` to match `MoreSheet`'s own X button
(`side-nav.tsx:377-384`), which gets this right.

### P1

**P1-2 — Shared Button size scale violates DESIGN.md's own named "44px Rule."**
`ui/button.tsx:17-20`: `default` is `h-10` (40px) on mobile, `sm` is `h-9` (36px),
`icon` is `h-10 w-10` (40px) — only `lg` (`h-11`/44px) and the kiosk-only `touch`
(`h-14`/56px) actually clear it. `DESIGN.md:323` states it in one place: *"Every
interactive target is at least 44px tall on touch... The idiom is the paired class —
`h-11 md:h-8`... applied to icon buttons, chips, tabs, inputs, expander rows and inline
text buttons alike,"* and `DESIGN.md:443` repeats it as a hard "Don't." `PRODUCT.md:45`
makes the same commitment. The component that's supposed to be the single source for
this shape uses `h-10`/`h-9`, not `h-11`. Concretely under 44px on mobile, all in my
assigned files:
- Login "Unlock" button, no size prop → `default` → 40px (`login-form.tsx:95`)
- Create-container "Cancel" / "Create & start", no size prop → 40px (`create-container.tsx:160-161`)
- Create-container's three "add" row buttons, `size="sm"` → 36px (`create-container.tsx:97,120,139`)
- Reclaim `PruneAction`'s trigger, Cancel, Confirm, all `size="sm"` → 36px (`reclaim-shared.tsx:71,74,83-84`)
- `WidgetActionRow`/`WidgetActionsMenu` Cancel/Confirm, `size="sm"` → 36px (`widget-actions.tsx:92,95,102-104,186,189`)
- `WidgetActionsMenu`'s ellipsis trigger, explicit `h-10 w-10 md:h-7 md:w-7` → 40px (`widget-actions.tsx:158-161`)
- Containers page "New container" button, no size prop → 40px (`containers/page.tsx:178`)
- `LifecycleActions` icons (Start/Stop/Restart/Pause/Resume — every tile, every table
  row) via `size={touch ? "touch" : "icon"}`, default path → 40px (`container-controls.tsx:155`)

Tellingly, `image-delete-action.tsx:26` (`const ICON_BUTTON = "h-11 w-11 md:h-7 md:w-7"`)
and its confirm/cancel pair (`className="h-11 md:h-7"`, lines 86,89) already know the
right number and hand-patch around the shared component instead of using it bare — the
fix belongs in `ui/button.tsx` itself, not per call site. (Note: WCAG 2.2's own SC
2.5.8 AA minimum is 24×24px, which every one of these still clears — this is a
violation of the app's *own*, stricter, explicitly documented commitment, not of WCAG's
floor. Flagging at P1 because the brief asks me to check PRODUCT.md's commitment
specifically, and DESIGN.md treats it as load-bearing.)

**P1-3 — No skip link; sidebar precedes content in tab order on every `/dash` route.**
`(dash)/layout.tsx:6-10` renders `<SideNav />` before `<main>`. On desktop,
`side-nav.tsx`'s `<aside>` (lines 126-202) is 13 nav links + "Kiosk mode" + "Stacks ·
Dockge" + "Log out" = 16 focusable elements, all before page content in DOM/tab order,
with no bypass mechanism. A keyboard user lands on every page and must tab through all
16 before reaching anything page-specific. WCAG 2.4.1 (Bypass Blocks, A). Mobile is
less severe — the desktop `<aside>` is `hidden` (removed from the a11y tree) below
`md:`, leaving only the 2-item top bar + 5-item bottom tab bar (7 stops) before
`<main>` — but still no explicit skip link. Fix: a visually-hidden "skip to content"
link as the first focusable element in `(dash)/layout.tsx`, targeting `<main>`.

**P1-4 — Form labels not programmatically associated with their fields.**
`ui/input.tsx:31-33`'s `Label` is a bare `<label>` wrapper with no automatic `htmlFor`
generation, and none of its callers supply matching `id`/`htmlFor` pairs in two of my
assigned files:
- `create-container.tsx`: every `<Label>`/`<Input>`/`<Select>` pair — Image (line
  71-72), Name (75-76), Restart policy (78-80), Network (87-89), and the per-row
  host/container/protocol inputs for ports/env/volumes — relies on visual adjacency
  only. No `id`, no `htmlFor`, no `aria-labelledby`.
- `settings-tiles.tsx`: the mobile card layout's Group/App URL/Icon labels (lines
  224-247) have the same gap.

Compare `login-form.tsx:84-92` — `<Label htmlFor="password">` + `<Input id="password">`
— which gets this exactly right and is the pattern to copy. Placeholder text (e.g.
`"nginx:alpine"`) is not a reliable substitute: it disappears once typed and its
promotion to accessible name is inconsistent across browser/AT combinations. WCAG 1.3.1
(Info and Relationships, A) / 3.3.2 (Labels or Instructions, A).

**P1-5 — Icon-only buttons with no accessible name.**
- `create-container.tsx:59-61`: the modal's own close `<X>` button — no `aria-label`,
  no text.
- `create-container.tsx:109,128,151`: the three `<Trash2>` "remove row" buttons for
  ports/env/volumes — no `aria-label` on any of them. A screen reader announces three
  identical unnamed "button"s per section with no way to tell them apart or know what
  they do.

Contrast with `image-delete-action.tsx` and `image-groups.tsx`, where every icon-only
control (`Delete`, `Expand`/`Collapse`, disabled-with-reason) carries a correct,
specific `aria-label`. WCAG 4.1.2 (A), 2.4.6 (Headings and Labels, AA).

**P1-6 — Destructive/async-error feedback isn't announced to screen readers in 4 of 6 places.**
`container-controls.tsx:368-389` (`LifecycleError`, `role="alert"`) and
`widget-actions.tsx:53-60` (`ResultLine`, `role="status"`) get this right. These four
don't:
- `image-delete-action.tsx:113`: `{error && <span ...>{error}</span>}` — a failed
  delete produces no live-region announcement.
- `reclaim-shared.tsx:96`: `PruneAction`'s error span — same gap, on the one
  destructive bulk action in the app.
- `create-container.tsx:158`: `{error && <p className="text-bad text-xs">{error}</p>}`
  — a failed container creation isn't announced.
- `login-form.tsx:94`: `{error && <p ...>{error}</p>}` — **a failed login attempt is
  not announced.** This is the highest-impact instance: a screen reader user who
  submits a wrong password and stays focused on the password field (typical behavior)
  gets no notification anything happened.

Fix: `role="alert"` (or `aria-live="assertive"`) on all four, matching the two that
already do it. WCAG 4.1.3 (Status Messages, AA).

**P1-7 — `MoreSheet` claims `aria-modal` but doesn't actually trap focus.**
`side-nav.tsx:359` sets `role="dialog" aria-modal="true"` correctly, and the sheet does
handle `Escape` (lines 347-354) and backdrop dismissal — genuinely good work. But there
is no focus management: no `useRef`/`.focus()` call moves focus into the sheet on open,
and no keydown handler wraps `Tab`/`Shift+Tab` at the sheet's boundaries. `aria-modal`
tells assistive tech the rest of the page is inert; nothing in the implementation
enforces that for a keyboard user, who can `Tab` from the sheet's last link straight
back into whatever was behind it. This is the specific question the brief asked about,
and the answer is no. Fix: move focus to the sheet's first item (or the sheet container
itself) when `visible` flips true, and either use `inert` on the rest of the page or add
a standard focus-wrap on the sheet's own boundary.

**P1-8 — `VitalsStrip`'s `Meter` usages regress the label the component itself supports.**
`charts.tsx:56-91`'s `Meter` was correctly built with `role="progressbar"` +
`aria-valuenow/min/max` + an optional `label` prop + `sr-only` percent text — solid
work, presumably from the kiosk pass mentioned in the brief. But `vitals-strip.tsx`
never passes it: `<Meter percent={host?.memory.percent ?? 0} />` (line 57, Memory) and
`<Meter percent={d.percent} warnAt={85} badAt={95} />` (line 83, per-disk-mount, even
though `d.mount` — e.g. `/mnt/media` — is right there and already rendered as visible
text one line above at line 73). `role="progressbar"` takes its accessible name only
from `aria-label`/`aria-labelledby` (name-from-author, not name-from-content), so
without the prop these expose to AT as an anonymous "progress bar, 62%" with no
indication of what's 62% full. This is exactly the /dash regression check the brief
asked for — the primitive is fine, the caller didn't adopt it. Fix:
`<Meter percent={host?.memory.percent ?? 0} label="Memory usage" />` and
`<Meter percent={d.percent} warnAt={85} badAt={95} label={`${d.mount} disk usage`} />`.

### P2

**P2-9 — `ink-faint` drops under AA 4.5:1 on `panel-2` grounds (script-verified).**
`globals.css:19`'s raised `--color-ink-faint` (`#657f9e`) clears 4.5:1 against `bg`
(4.77:1) and `panel` (4.51:1, the near-zero headroom CLAUDE.md already flags) but *not*
against `panel-2` or a `panel-2` tint over `panel`:

| Pairing | Ratio |
|---|---|
| ink-faint solid on `panel-2` | **4.23:1** |
| ink-faint on `bg-panel-2/60` composited over `panel` (hovered table row) | **4.35:1** |
| ink-faint on `bg-panel-2/30` composited over `panel` (expanded tag row) | **4.43:1** |

Concrete instances: the overview filter input's placeholder text and its `/` keyboard
hint both sit on `bg-panel-2` (`page.tsx:185,198`, in my Overview route); the expanded
multi-tag rows in `image-groups.tsx` put the "created" timestamp column
(`text-ink-faint`) on `bg-panel-2/30` in both the table (`image-groups.tsx:126`) and
card (`image-groups.tsx:227`) renderings; any table row's `ink-faint` column (e.g.
Images' "created" column, `images/page.tsx:126` via the shared row style) drops from a
passing 4.51:1 to a failing 4.35:1 the moment the pointer hovers it
(`hover:bg-panel-2/60`, used throughout `containers/page.tsx`, `images/page.tsx`,
`volumes/page.tsx`). None of these are large failures (worst is 4.23 vs. a 4.5 floor),
but they are real, and they're the direct, predictable consequence of `ink-faint`
having "almost no headroom" per `CLAUDE.md`'s own note — any surface where it sits on
`panel-2` rather than `panel` inherits the same near-miss. Placeholder text and hover
states are lower-priority than persistent body text, hence P2 not P1.

**P2-10 — `/login` has no `<h1>` and no landmark region.**
`login-form.tsx` renders "nightwatch" as a styled `<span>` (lines 53-55), not a
heading — the brief asks specifically whether each route has an `<h1>`; this one
doesn't. It also renders directly into `<body>` (via `app/layout.tsx`, which has no
`<main>`) with no `<main>`/`role="main"` wrapper anywhere, unlike `(dash)/layout.tsx`
which correctly wraps its children in `<main>` (`(dash)/layout.tsx:8`). Low-traffic
page, but it's the one landmark-free, heading-free route in scope.

**P2-11 — `ui/card.tsx`'s `CardTitle` is a `<div>`, not a heading.**
`card.tsx:12-14`: `<div className={cn("microlabel", className)} {...props} />`. Every
`Card` section title in scope — "CPU", "Memory", "Network rx/tx", "Metadata", "Service
widget", "Logs" on the container detail page, and "CPU"/"Memory"/"Disk"/"Network"/"Host"
on `VitalsStrip` — is structurally invisible to a screen reader user navigating by
heading (a primary AT navigation strategy), even though it visually reads as a section
label. Content is still in linear reading order, so this is a navigation-efficiency gap
rather than a content-access failure. Fix: render an `<h2>`/`<h3>` (visually unchanged,
`.microlabel` styling still applies) rather than a `<div>`.

**P2-12 — `containers/[id]/page.tsx`'s Environment disclosure has no `aria-expanded`.**
Lines 347-352: `<button onClick={() => setShowEnv(!showEnv)}>Environment (12) {showEnv
? "▾" : "▸ click to reveal"}</button>` — real text conveys some state, but there's no
`aria-expanded`, unlike the correctly-implemented disclosure pattern one file over in
`image-groups.tsx:84-85,210-211` (`aria-expanded={expanded} aria-label=...`). The
expanded state also drops the "click to..." hint text entirely (just "▾"), so there's
no textual cue for collapsing either. WCAG 4.1.2 (A).

**P2-13 — Table headers lack `scope="col"`.**
No `<th>` in scope sets `scope`, across `containers/page.tsx:192-196`,
`images/page.tsx:306-310`, `volumes/page.tsx:46-50`, `reclaim-images.tsx:97-101`,
`reclaim-volumes.tsx:79-83`, `settings-tiles.tsx:163-165`. Modern AT usually infers
simple single-header-row tables correctly without it, so this is a robustness gap
rather than a live failure, but it's WCAG 1.3.1 best practice and cheap to fix.
(`containers/page.tsx`'s `SortableHeader` does correctly set `aria-sort` on the `<th>`
itself — that part is right.)

**P2-14 — `charts.tsx`'s `Sparkline` SVG has no `aria-hidden`.**
`charts.tsx:40-49` (used by `containers/[id]/page.tsx`'s CPU/Memory/Network graphs) has
no `aria-hidden="true"` on its `<svg>`. Its sibling implementation,
`components/sparkline.tsx:60-73`, does (`aria-hidden="true"` on line 67) — same
component family, inconsistent treatment. An unlabeled decorative SVG risks being
exposed to AT as an unnamed image. Low severity since the numeric values are already
rendered as real text alongside each chart (e.g. `containers/[id]/page.tsx:241-243`).

**P2-15 — "Stop" has no confirmation step, unlike the app's own delete/prune idiom.**
`container-controls.tsx:214-218` fires `lifecycle.run("stop")` on a single click, in
every surface (`container-tile.tsx`, `containers/page.tsx`'s `RowActions`,
`containers/[id]/page.tsx`'s header). The app has a well-established, correctly-applied
two-step inline confirm for irreversible actions (`image-delete-action.tsx`,
`reclaim-shared.tsx`'s `PruneAction`) — Stop gets none of it, despite being named
explicitly in the brief's destructive-action checklist. Stop is reversible (Start
undoes it), which is presumably why it was excluded, but a misclick on a dense 40px
icon target (see P1-2) interrupts whatever the container was doing with zero friction.
Judgment call, not a clear violation — flagging for the design owner to confirm as
intentional.

**P2-16 — Login password field missing `autocomplete="current-password"`.**
`login-form.tsx:85-92`: `<Input id="password" type="password" ... />` has no
`autoComplete` attribute. WCAG 1.3.5 (Identify Input Purpose, AA) — password managers
and AT benefit from the explicit purpose hint.

**P2-17 — Visual-only "required" indicator in `create-container.tsx`.**
`create-container.tsx:71`: `<Label>Image *</Label>` — the asterisk is not paired with
`required`/`aria-required="true"` on the `<Input>` (line 72), and there's no textual
"(required)" for anyone who won't reliably hear a bare `*` glyph as meaningful.

**P2-18 — `settings-tiles.tsx` desktop "Hide" checkbox has no accessible name at all.**
Line 197-201: `<input type="checkbox" checked={cfg.hidden.includes(name)}
onChange={...} />` inside a `<td>`, under a column header "Hide" — no wrapping
`<label>`, no `aria-label`, no `aria-labelledby` referencing the header or row. The
mobile card rendering gets this right two lines away (`settings-tiles.tsx:214-222`:
`<label className="flex items-center gap-2 ...">hide<input type="checkbox" ... /></label>`).
Screen reader announces an anonymous checkbox with no row context. WCAG 4.1.2 (A).

### P3

**P3-19 — Sidebar "unhealthy" indicator relies on `title` alone.**
`side-nav.tsx:162,259,411`: `<span className="ml-auto dot dot-unhealthy" title={...} />`
— no `aria-label`, and `title` has poor/inconsistent screen-reader support and no touch
equivalent. Low severity because the same count is available as real text elsewhere
(Overview's header `Badge`, `page.tsx:147-149`; Containers page counts).

**P3-20 — Two unlabeled `<nav>` landmarks in the DOM simultaneously.**
`side-nav.tsx`'s desktop `<nav>` (line 141, inside `<aside>`) and mobile bottom `<nav>`
(line 240) both lack `aria-label`. Low impact in practice since Tailwind's
`hidden`/`md:hidden` removes the inactive one from the accessibility tree at any given
viewport, but worth a label each for robustness.

**P3-21 — Focus ring alone (not border) would under-shoot 3:1 on inputs.**
`ui/input.tsx:8`: `focus:border-accent/50 focus:ring-1 focus:ring-accent/30` — the ring
alone (`accent/30` ≈ 2.1–2.2:1 vs. `bg`/`panel-2`) wouldn't clear the 3:1 non-text
minimum, but the accompanying border change (`accent/50` ≈ 3.9:1) does, and is what
actually carries the visible focus indication. Not a real failure — noted for
completeness since I was asked to compute every UI-boundary pairing I could derive.

## Already correct

- Two-step inline confirm (never a browser `confirm()`) for image delete
  (`image-delete-action.tsx`) and prune (`reclaim-shared.tsx`'s `PruneAction`),
  consistently shaped, fully keyboard-reachable, and in-use images are correctly
  pre-disabled with a contextual `title`/`aria-label` rather than allowed to reach the
  confirm step at all.
- `image-groups.tsx`'s expand/collapse buttons: correct `aria-expanded` + specific
  `aria-label` on both the table and card renderings.
- `container-controls.tsx`: `LifecycleActions` (`aria-label`, `aria-busy`, group-lock
  while pending), `OpenAppLink` (`aria-label`), `LifecycleError` (`role="alert"`,
  keyboard-dismissible) — reference quality throughout this file.
- `widget-actions.tsx`: `role="menu"`/`role="menuitem"` on the tile popover,
  `role="status"` on the result line, click-outside + `Escape` to close, correct
  `aria-haspopup`/`aria-expanded` on the trigger.
- `containers/page.tsx`'s `SortableHeader` correctly sets `aria-sort` on the `<th>`
  itself, matching the ARIA APG sortable-table pattern.
- `images/page.tsx`'s empty Actions column header uses an `sr-only` label
  (`images/page.tsx:308`) instead of leaving assistive tech with a blank header.
- `login-form.tsx`'s one real form field is correctly associated (`htmlFor`/`id`,
  lines 84-92) — the pattern the other two forms in scope should copy.
- Solid-color focus-visible rings (`focus-visible:ring-accent`, full opacity, ~13:1)
  are used pervasively and consistently across nearly every interactive control in
  scope — no contrast concern anywhere it's applied at full opacity.
- Contrast is AA-clean on essentially every *solid* text/background pairing: `ink` on
  any surface (13–16:1), `ink-dim` everywhere (5.7–6.5:1), `accent`/`blue`/`ok`/`warn`
  all comfortably pass on `bg` and `panel` (10–13:1), `bad` passes at 6.4–7.1:1 even
  where it's the smallest-margin state color.
- `Meter` itself (`charts.tsx:56-91`) is well-built for accessibility — the gap is
  purely that `vitals-strip.tsx` doesn't pass its `label` prop (P1-8).
- `image-delete-action.tsx` already patched its own controls to the correct 44px
  height rather than trusting the shared `Button` size scale — the fix for P1-2
  belongs at the source, and this file shows what it should look like.
- Reduced-motion is respected everywhere motion appears in scope (spinners, sheet
  transitions) via `motion-reduce:`/`prefers-reduced-motion` — not the brief's focus,
  but worth noting since it touches several files here.
