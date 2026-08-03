# Kiosk Accessibility Audit

Scope: `/kiosk` route — `src/app/kiosk/**` and `src/components/kiosk-*.tsx`, plus
`charts.tsx` (Gauge/Meter) and `container-controls.tsx` (LifecycleActions) as directly
imported by `kiosk-admin-panel.tsx`. Audit only, no source files modified.

## Score (0-4)

**2 — Partial.** Interaction semantics (buttons, `role="switch"`, `aria-label`, focus
rings, touch targets, redundant color+text coding, reduced-motion handling) are
executed carefully and consistently. But three structural AA violations run across the
*entire* surface — zero heading elements on the page, pinch-zoom disabled at the
viewport level, and a caption color (`ink-faint`/`.microlabel`, used sitewide) that
fails 4.5:1 body-text contrast in half the theme catalog — plus two custom modals
(PIN pad, timers) with no dialog semantics or focus trap. Key finding: **`.microlabel`
fails WCAG AA contrast in 8 of 16 kiosk themes** because it is hard-coded to
`--color-ink-faint`, which was already flagged as a 2.9:1 failure in the default theme
(see baseline) — the same failure recurs in terminal, journal, lounge, bulletin,
aurora, chrome and pixel too.

## Per-theme contrast table (computed)

**Methodology note:** colors were parsed directly from the 16 `[data-kiosk-theme="…"]`
blocks in `src/app/globals.css` (the actual source of the per-theme palette), not from
`src/components/kiosk-theme.tsx` (which only holds the theme id union, labels, and the
group taxonomy — `KIOSK_THEME_SWATCHES` there has `bg`/`accent` only, not a full
palette). Verified programmatically that all 16 theme blocks declare all 14
`--color-*` variables themselves — every theme is a full override with **no
inheritance gap** back to the unscoped `@theme` default, so no variable had to be
resolved by layering.

Computed with a WCAG relative-luminance script (`node`, not eyeballed) against each
theme's own `panel` color (semi-transparent panels — `aerogel` `#ffffff8c`, aurora
`#151329d9` — were alpha-composited onto their theme's `bg` first, matching how they
actually render). Both `aerogel` and `aurora` also apply `backdrop-filter: blur(...)`
to `.panel` (`globals.css:552-567`, `:713-717`) — the blur diffuses whatever sits
*behind* the panel (in practice just `KioskSky`'s low-opacity ambient tint or the
plain bg color) without changing the panel's own average color, so the alpha-composite
model here is a reasonable approximation; it is not exact if `KioskSky`'s tint is
saturated directly behind a given panel at the moment of viewing.
Only pairs **below 4.5:1** (the AA body-text threshold) are listed; a "yes" in the
*passes 3:1 large-text* column means the pair still clears the AA large-text/UI-component
minimum even though it fails body text.

| Theme | Role (CSS var) | Contrast vs panel | Contrast vs bg | Passes 3:1 large-text? |
|---|---|---|---|---|
| **default** | `--color-ink-faint` | **2.93:1** | 3.10:1 | No |
| **terminal** | `--color-ink-faint` | **3.19:1** | 3.31:1 | Yes |
| **journal** | `--color-ink-faint` | **3.40:1** | 3.17:1 | Yes |
| **lounge** | `--color-ink-faint` | **3.16:1** | 3.37:1 | Yes |
| **sunroom** | `--color-ok` | **3.45:1** | 3.27:1 | Yes |
| **sunroom** | `--color-bad` | **3.98:1** | 3.77:1 | Yes |
| **aerogel** | `--color-ok` | **3.26:1** | 3.04:1 | Yes |
| **aerogel** | `--color-bad` | **4.30:1** | 4.01:1 | Yes |
| **bulletin** | `--color-ink-faint` | **3.84:1** | 3.84:1 | Yes |
| **bulletin** | `--color-warn` | **3.90:1** | 3.90:1 | Yes |
| **understory** | `--color-accent` | **4.45:1** | 4.21:1 | Yes |
| **understory** | `--color-warn` | **3.78:1** | 3.58:1 | Yes |
| **understory** | `--color-blue` | **4.35:1** | 4.11:1 | Yes |
| **cinderblock** | `--color-warn` | **4.44:1** | 4.21:1 | Yes |
| **aurora** | `--color-ink-faint` | **4.36:1** | 4.63:1 (passes) | Yes |
| **chrome** | `--color-ink-faint` | **3.32:1** | 3.81:1 | Yes |
| **chrome** | `--color-bad` | **3.88:1** | 4.46:1 (still fails) | Yes |
| **pixel** | `--color-ink-faint` | **2.86:1** | 3.12:1 | No |

Themes with **zero** failing roles (`ink`, `ink-dim`, `ink-faint`, `accent`, `ok`,
`warn`, `bad`, `blue`, all checked against both panel and bg): **folio, slate,
duotone, neon**.

`ink-faint` fails in **8 of 16 themes** (default, terminal, journal, lounge,
bulletin, aurora, chrome, pixel) — a majority of the catalog — because
`.microlabel` (`src/app/globals.css:74-80`) hard-codes `color: var(--color-ink-faint)`
and is the section-header/caption class used on nearly every panel across the kiosk
(`SectionLabel` in `kiosk-display.tsx:252-259`, `SectionHeader` in
`kiosk-hub.tsx:284-294`, forecast day labels `kiosk-display.tsx:420`, sensor/timer
names `kiosk-hub.tsx:583`, `kiosk-timers.tsx:367`, the "running/paused/stopped"
labels in `kiosk-health.tsx:43`, and more). In `default`, `terminal`, and `pixel`
it drops below even the 3:1 large-text/UI floor.

### `ink-faint` directly on `bg` (Glance layout's Admin button)

The Glance layout is deliberately "open ground" (no `.panel` — see the file thesis
comment at `kiosk-glance.tsx:3-17`), so its Admin button at
`kiosk-glance.tsx:195-201` (`className="… text-ink-faint …"`) sits straight on the
themed `bg`, not a panel. Checking `ink-faint` vs `bg` specifically across all 16
themes:

| Theme | `ink-faint` vs `bg` | Passes 4.5:1? | Ground type |
|---|---|---|---|
| default | 3.10:1 | **No** | dark |
| terminal | 3.31:1 | **No** | dark |
| **journal** | **3.17:1** | **No** | **light** |
| lounge | 3.37:1 | **No** | dark |
| folio | 4.54:1 | Yes (barely) | light |
| slate | 4.50:1 | Yes (borderline) | light |
| sunroom | 4.55:1 | Yes (barely) | light |
| aerogel | 4.57:1 | Yes (barely) | light |
| **bulletin** | **3.84:1** | **No** | **light** |
| understory | 5.16:1 | Yes | light |
| duotone | 4.87:1 | Yes | light |
| cinderblock | 5.02:1 | Yes | light |
| aurora | 4.63:1 | Yes | dark |
| chrome | 3.81:1 | **No** | dark |
| neon | 5.23:1 | Yes | dark |
| pixel | 3.12:1 | **No** | dark |

This is exactly the scenario flagged as highest-risk: **journal and bulletin are
light-ground themes that still fail** because they inherit the same
`--color-ink-faint` treatment as the dark themes rather than being retuned for a
light ground — a light theme doesn't automatically fix a dim-ink problem. Four more
light themes (folio, slate, sunroom, aerogel) clear 4.5:1 by less than 0.1, which is
inside typical color-management/subpixel rounding error and should not be treated as
a comfortable margin.

Script used (reproducible, not hand-computed):

```js
// relative luminance + contrast ratio per WCAG 2.x, alpha-composited onto
// each theme's own bg for translucent panel colors (aerogel/aurora)
function relLum({r,g,b}) { const c=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*c(r)+0.7152*c(g)+0.0722*c(b); }
function contrast(hex1, hex2) { const L1=relLum(hexToRgb(hex1)), L2=relLum(hexToRgb(hex2));
  return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); }
```

## Findings

### P1 — WCAG AA violation / major

**1. Zero heading elements anywhere on `/kiosk`.**
Location: entire route — confirmed by grep across `src/app/kiosk/**` and
`src/components/kiosk-*.tsx` for `<h1>`-`<h6>` and `role="heading"`: no matches.
Every section caption ("Lights", "Switches", "Morning Briefing", "Climate", "Timers")
renders as a `<span className="microlabel">` (e.g. `kiosk-hub.tsx:289`,
`kiosk-display.tsx:256`, `kiosk-timers.tsx:297`), never a heading tag.
Impact: a screen-reader user has no heading outline to navigate the kiosk by section —
the single most common non-visual navigation strategy is unavailable on this entire
surface. WCAG 1.3.1 (Info and Relationships) / 2.4.6 (Headings and Labels), AA.
Recommendation: give the page a visually-hidden `<h1>` ("nightwatch kiosk") and promote
the section-caption elements (`SectionLabel`, `SectionHeader`) to real `<h2>`/`<h3>`
wrapped in the existing `.microlabel` visual style — no visual change required.

**2. Pinch-zoom disabled at the viewport level.**
Location: `src/app/kiosk/layout.tsx:38-42` — `maximumScale: 1, userScalable: false`.
Impact: WCAG 1.4.4 (Resize Text, AA) requires content be resizable to 200% without
loss of functionality; `user-scalable=no` is a listed WCAG failure technique (F). A
low-vision visitor standing closer to the wall tablet, or using the bench/hand-held
390px mode this task explicitly covers, cannot zoom text at all. The comment at
layout.tsx:38-40 frames this as deliberate ("keeps accidental zooms from stranding the
kiosk in a scrolled-in state") but that trade-off is exactly the WCAG failure pattern.
Recommendation: drop `maximumScale`/`userScalable: false`; a fixed `width:
device-width, initialScale: 1` is enough to stop initial-load zoom weirdness without
permanently blocking user-initiated zoom.

**3. `KioskPinPad` modal has no dialog semantics, focus trap, or Escape handling.**
Location: `src/components/kiosk-pin-pad.tsx:69-133`. The overlay is a plain
`<div className="fixed inset-0 z-50 …">` with no `role="dialog"`, no `aria-modal`,
no `aria-labelledby` pointing at the "Admin PIN" heading text (`:75`), and no
`onKeyDown` handler for Escape — the only way to dismiss it is the "Cancel" button
(`:77-84`) or a correct/failed PIN. Nothing moves focus into the dialog on open and
nothing prevents Tab from cycling back out into the page behind it (the background
isn't `inert` and nothing traps focus). Confirmed by grep: no `Escape`, `autoFocus`,
`trapFocus`, `role="dialog"`, `aria-modal`, or `inert` anywhere in
`src/components/kiosk-*.tsx`. WCAG 2.4.3 (Focus Order) / 4.1.2 (Name, Role, Value), AA.
Recommendation: add `role="dialog" aria-modal="true" aria-labelledby="pin-pad-title"`,
move focus to the dialog (or first digit key) on mount, trap Tab within it, and close
on Escape.

**4. `KioskTimersOverlay` has the identical gap.**
Location: `src/components/kiosk-timers.tsx:280-324`. Same shape as finding 3: backdrop
`<div onClick={onClose}>` (`:286-288`) with a stopPropagation inner panel, no
`role="dialog"`/`aria-modal`, no focus move on open, no Escape-to-close, no focus trap.
A keyboard user tabbing through the page behind the overlay (nothing hides or
`inert`s it) can reach controls that are visually covered by the modal backdrop.
Recommendation: same as finding 3.

**5. `.microlabel` / `ink-faint` fails AA body-text contrast in half the theme
catalog.** See the computed table above — 8 of 16 themes, with `default`, `terminal`
and `pixel` also failing the 3:1 large-text/non-text floor. This is the single
highest-leverage fix available: one CSS rule change (`.microlabel`,
`globals.css:74-80`) or per-theme retuning of `--color-ink-faint` fixes every
instance across every component that uses it, sitewide. The same token also fails
directly against `bg` (no panel involved) on the Glance layout's Admin button
(`kiosk-glance.tsx:198`) — see the dedicated "`ink-faint` directly on `bg`" table
above. Two of those bg-context failures, **journal (3.17:1)** and **bulletin
(3.84:1)**, are light-ground themes, confirming the specific risk pattern flagged
for this audit: a light theme is not automatically safe just because its ground is
pale — it still fails here because it inherits the same dim-ink treatment authored
for the dark themes rather than a ground-appropriate one. Four more light themes
(folio 4.54:1, slate 4.50:1, sunroom 4.55:1, aerogel 4.57:1) clear 4.5:1 by under
0.1, too thin a margin to call comfortably compliant.

**6. Non-happy-path state changes render with no `role="status"`/`"alert"`,
inconsistently with sibling components that do.**
Locations: `WeatherUnconfigured` (`kiosk-display.tsx:275-285`), `WeatherUnreachable`
(`kiosk-display.tsx:287-295`), `HubLoadError` (`kiosk-hub.tsx:626-635`),
`HubUnconfigured` (`kiosk-hub.tsx:644-653`), `HubStatusIssue` (`kiosk-hub.tsx:655-666`),
`HubEmpty` (`kiosk-hub.tsx:668-679`) — none carry a live-region role. These are exactly
the kind of transition ("weather stopped responding", "Home Assistant unreachable")
that a person glancing away from a wall display needs announced if they're using a
screen reader, and the *same class* of transition already gets `role="status"`
elsewhere in this codebase: the severity chip in `kiosk-status-strip.tsx:104`, the
health alert in `kiosk-health.tsx:50`, and the attention card in
`kiosk-attention.tsx:60`. Recommendation: add `role="status"` to the six components
above for consistency with the established pattern.

**7. `Meter` (used for memory/disk gauges) has no accessible value.**
Location: `src/components/charts.tsx:53-75`, consumed by `kiosk-vitals.tsx:35` (memory)
and `:47` (disk). The percentage the bar encodes via width + color is never rendered
as text anywhere nearby — `kiosk-vitals.tsx:36-38` and `:48-50` print byte totals
(`used / total`), not the percent value the bar itself represents. No
`role="progressbar"`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, or equivalent
text. WCAG 1.1.1 / 4.1.2, AA. (The sibling `Gauge` component, `charts.tsx:78-115`,
does *not* have this problem — it overlays the literal `{Math.round(p)}%` as real text,
`:110`.) Recommendation: give `Meter` `role="progressbar" aria-valuenow={p}
aria-valuemin={0} aria-valuemax={100}`, or add a visually-hidden percent string.

### P2 — minor, workaround exists

**1. Section landmarks aren't named.** `WeatherBand` (`kiosk-display.tsx:553`),
`BriefingCard` (`:606`), `LightsSection` (`kiosk-hub.tsx:307`), `SwitchesSection`
(`:359`), `ScenesSection` (`:409`), `ClimateSection` (`:555`), and `SensorsSection`
(`:568`) are all `<section className="panel p-4">` with a visible caption
(`SectionLabel`/`SectionHeader`) directly inside, but none use `aria-labelledby` to
connect the two — so these `<section>`s never surface as named landmarks/regions in
assistive tech. Low severity because the visible label is still adjacent, readable
content, but tying it in with `aria-labelledby` is a small, sitewide-applicable fix.

**2. Additional per-theme contrast gaps beyond `ink-faint`.** `sunroom`/`aerogel`
`--color-ok`, `understory`/`cinderblock`/`bulletin` `--color-warn`, and
`understory`/`chrome`/`aerogel`/`sunroom` `--color-bad`/`--color-blue`/`--color-accent`
fail AA body text in the table above. These tokens back real body-size UI text in this
surface (e.g. `!text-warn` on `WeatherUnconfigured`'s microlabel,
`kiosk-display.tsx:281`; `text-bad` on action errors, `kiosk-hub.tsx:229`; `text-accent`
on active theme/layout chips, `kiosk-appearance.tsx:42-43`), so the failure is real
whenever those five themes are selected, not merely theoretical.

**3. Night overlay's wake gesture is pointer-only.**
Location: `kiosk-display.tsx:688-691` — `onPointerDown={onWake}` on the wrapping
`<div>`. There's no keyboard equivalent to leave the night state (only the "Admin"
button, `:704-713`, is keyboard-reachable and does something different). Low severity
given the device is a touchscreen kiosk, but the bench/hand-held mode this audit's
brief calls out could plausibly pair with an external keyboard.

**4. Truncated names rely on a hover-only `title` tooltip.**
Locations: `kiosk-timers.tsx:367` (timer name), `kiosk-hub.tsx:583` (sensor name).
`truncate` clips the text and `title="…"` is the only way to recover the full string —
`title` has no touch equivalent (PRODUCT.md's touch-parity commitment). Low severity:
the truncated text itself remains visible/readable, this only affects recovering the
overflow.

**5. Low-battery emphasis is color-only.**
Location: `batteryTone()`, `kiosk-hub.tsx:95-100`, applied to sensor value text in
`SensorsSection` (`:586`). `text-bad`/`text-warn`/`text-ink` switches on a numeric
threshold with no icon or text-prefix change. Low severity because the numeric value
itself (`"8%"`) is always present as real text — a screen reader still gets the number,
this only affects at-a-glance visual emphasis for low-vision/color-blind users glancing
at the tile.

### P3 — polish

**1. Countdown/expiry text isn't a live region.** `error.tsx:125-127` ("retrying in
5s…") and `KioskAdminPanel`'s "elevated · locks in mm:ss" (`kiosk-admin-panel.tsx:57`)
update every second with no `aria-live`. Non-actionable, low value to announce every
tick, but worth a single polite live region if screen-reader users report confusion
about the elapsed-time context.

**2. `Gauge`'s SVG isn't `aria-hidden`.** `charts.tsx:94-108` — the ring itself
carries no `aria-hidden`, even though its value is fully duplicated by the overlaid
`{Math.round(p)}%` text (`:110`). Cosmetic only; most screen readers won't expose an
unlabeled `<svg>` as an object needing a name, but marking it `aria-hidden` would be
correct hygiene and matches how every *other* decorative SVG in this codebase is
marked (e.g. `kiosk-display.tsx:484`, `kiosk-voice.tsx:28`).

## Already correct

- **Every icon-only control has an accessible name.** Grep across `kiosk-*.tsx` found
  16 `aria-label` occurrences on interactive icon controls: mic button
  (`kiosk-voice.tsx:156`), stop-speaking (`:187`), dismiss-error (`:199`), timers
  button with a dynamic count (`kiosk-timers.tsx:249`), close/cancel/backspace/digit
  keys in the PIN pad (`kiosk-pin-pad.tsx:80,123`), pause/resume/cancel/add-minutes/
  clear-minutes in the timers overlay (`kiosk-timers.tsx:404,412,478,488`), and
  toggle/activate/nudge/mode controls in the hub (`kiosk-hub.tsx:211,262,489,506,524`).
  `LifecycleActions` (`container-controls.tsx:154-155`) doubles up with both
  `aria-label` **and** `title`.
- **Real semantic controls, no `<div onClick>` anti-pattern.** Every `onClick` in
  `kiosk-*.tsx` and `kiosk/error.tsx` is on a `<button type="button">` (confirmed by
  grep — the only bare-`<div>` `onClick`s are the two modal backdrops, which are a
  legitimate click-outside-to-dismiss pattern backed by a real Cancel/Close button).
- **Correct toggle semantics.** `ToggleTile` uses `role="switch"` + `aria-checked`
  (`kiosk-hub.tsx:209-210`), climate mode buttons use `aria-pressed`
  (`kiosk-hub.tsx:523`) inside a labeled `role="group"` (`:518`), and the layout/theme
  pickers use `aria-pressed` too (`kiosk-appearance.tsx:38,86`) inside a labeled
  `role="group"` (`:80`).
- **Consistent focus indicators.** Virtually every interactive element in the kiosk
  pairs `outline-none` with `focus-visible:ring-1 focus-visible:ring-accent` — a
  deliberate, sitewide-consistent visible-focus treatment, and `--color-accent` clears
  AA's 3:1 non-text/UI-component contrast minimum against panel in every theme checked.
- **Decorative icons are marked up correctly.** Every purely-decorative `<Icon>` /
  `<svg>` sampled (weather icons, status dots, section-label icons, the rain nowcast
  SVG) carries `aria-hidden`, while meaningful icon-only buttons carry `aria-label`
  instead — the two are not conflated anywhere sampled.
- **Redundant coding for status, not color-only (mostly).** Container health
  (`running`/`restarting`/`paused`/`stopped`, `kiosk-health.tsx:7-12`) and
  dead/unhealthy counts (`kiosk-status-strip.tsx:111-113`,
  `kiosk-health.tsx:57-59`) always pair the color/dot with literal text, not color
  alone (battery tone is the one real exception — see P2 finding 5).
- **No hover-only affordances inside the kiosk itself.** `globals.css:150-168` defines
  a `.hover-reveal` utility specifically for pointer-hover-gated UI with a
  `focus-visible`/`focus-within` fallback, but grep found **zero** uses of it inside
  `kiosk-*.tsx` — every kiosk control is visible/tappable by default, matching
  PRODUCT.md's touch-parity commitment.
- **44px+ touch targets are the norm.** Buttons across the kiosk consistently use
  `h-11` (44px) or larger (`h-14`/`h-16` for primary actions like PIN keys, climate
  nudge, timer controls), not the smaller desktop-style hit areas seen elsewhere in
  the app.
- **`role="alert"`/`role="status"` used correctly where present.** PIN error/lockout
  text (`kiosk-pin-pad.tsx:101`), `LifecycleError` (`container-controls.tsx:363`), the
  status-strip severity chip (`kiosk-status-strip.tsx:104`), `KioskHealth`'s severity
  block (`kiosk-health.tsx:50`), and `KioskAttentionCard` (`kiosk-attention.tsx:60`)
  are all genuine state-change announcements, correctly roled — the gap is only that
  this pattern wasn't extended to the six components in P1 finding 6.
- **`prefers-reduced-motion` is handled broadly**, not just spot-fixed: `motion-reduce:`
  variants appear on skeleton pulses, the attention-card entrance, the timer-finished
  pulse, the voice mic spinner, and `KioskSky`'s ambient transition
  (`kiosk-sky.tsx:135-139`) is explicitly collapsed under a reduced-motion media query.
