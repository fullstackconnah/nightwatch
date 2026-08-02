---
name: nightwatch
description: A dark-only homelab console where hairline panels, mono numerals and a single teal signal carry live machine state.
colors:
  bg: "#070b11"
  panel: "#0d131c"
  panel-2: "#121a26"
  line: "#1c2736"
  line-bright: "#2a3a50"
  ink: "#dbe7f4"
  ink-dim: "#8296ad"
  ink-faint: "#4d617a"
  accent: "#5eead4"
  accent-dim: "#2dd4bf"
  blue: "#7dd3fc"
  ok: "#4ade80"
  warn: "#fbbf24"
  bad: "#f87171"
  ramp-teal-deep: "#134e4a"
  ramp-teal-mid: "#0f766e"
  ramp-teal: "#0d9488"
  ramp-teal-bright: "#14b8a6"
typography:
  figure:
    fontFamily: "Cascadia Code, JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  subject:
    fontFamily: "Cascadia Code, JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  nav:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  data:
    fontFamily: "Cascadia Code, JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  log:
    fontFamily: "Cascadia Code, JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  note:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  detail:
    fontFamily: "Cascadia Code, JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.65rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.14em"
  tick:
    fontFamily: "Inter, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  sm: "0.125rem"
  base: "0.25rem"
  md: "0.375rem"
  panel: "0.625rem"
  full: "9999px"
spacing:
  hair: "0.125rem"
  xs: "0.25rem"
  sm: "0.375rem"
  base: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
components:
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1rem"
  panel-hover:
    backgroundColor: "{colors.panel-2}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.5rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
  button-outline:
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.5rem"
  button-ghost:
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.5rem"
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor: "{colors.bad}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.5rem"
  segment-button:
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.75rem"
  segment-button-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    height: "2.75rem"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 0.625rem"
    height: "2.75rem"
    typography: "{typography.data}"
  input-focus:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
  badge-neutral:
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.base}"
    padding: "0.125rem 0.375rem"
  badge-ok:
    textColor: "{colors.ok}"
    rounded: "{rounded.base}"
    padding: "0.125rem 0.375rem"
  badge-warn:
    textColor: "{colors.warn}"
    rounded: "{rounded.base}"
    padding: "0.125rem 0.375rem"
  badge-bad:
    textColor: "{colors.bad}"
    rounded: "{rounded.base}"
    padding: "0.125rem 0.375rem"
  status-dot-running:
    backgroundColor: "{colors.ok}"
    rounded: "{rounded.full}"
    size: "8px"
  status-dot-unhealthy:
    backgroundColor: "{colors.warn}"
    rounded: "{rounded.full}"
    size: "8px"
  status-dot-restarting:
    backgroundColor: "{colors.blue}"
    rounded: "{rounded.full}"
    size: "8px"
  status-dot-stopped:
    backgroundColor: "{colors.ink-faint}"
    rounded: "{rounded.full}"
    size: "8px"
  status-dot-dead:
    backgroundColor: "{colors.bad}"
    rounded: "{rounded.full}"
    size: "8px"
  nav-item-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.625rem"
  meter-track:
    backgroundColor: "{colors.line}"
    rounded: "{rounded.full}"
    height: "0.375rem"
  meter-fill:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
    height: "0.375rem"
---

# Design System: nightwatch

## Overview

**Creative North Star: "The Night Watch"**

This is a console for a machine that runs unattended, read by one person who is either glancing at it from across the room or leaning into it at 2am because something is wrong. It presents itself as instrumentation rather than as an app: a near-black blue field with a faint blueprint grid ruled across it, surfaces that are only a hairline brighter than the ground, and typography that spends almost all of its size budget on the numbers. Nothing is decorated. The visual interest comes from the fact that the readings are alive.

The palette is almost entirely neutral, and that restraint is the mechanism, not a mood. Because the field is fourteen shades of the same desaturated blue, a single teal phosphor mark reads instantly as *signal* — the live series, the selected tab, the active nav item, the thing you can act on. State colour (green / amber / red) appears only where a real threshold has been crossed, most often as an 8px glowing dot rather than as a filled region. When a surface needs to distinguish eight things at once it does it with lightness and area, never by reaching for eight hues.

Density is high but never crowded: hairline rules do all the separating, hover states are a one-step background lift rather than a shadow, and captions shrink to a 10px letterspaced microlabel so a labelled figure costs barely more vertical space than a bare one. The world is dark-only and commits to it — `color-scheme: dark`, one theme, no toggle, no light-mode fallbacks anywhere in the codebase.

**Key Characteristics:**
- Dark only, near-black blue ground (`#070b11`) with a 32px blueprint grid at 2.5% opacity
- Hairline borders instead of shadows; the only "depth" is a 1px inset top highlight on panels
- Mono for data, sans for prose — an enforced split, not a preference
- Tabular numerals everywhere, so live columns never jitter between ticks
- One teal accent as the single data hue; state colour only on a real threshold
- 10px uppercase letterspaced microlabels as the universal caption idiom
- Status as a glowing dot, pulsing only for states that demand attention
- Hand-rolled SVG charts; no chart library
- Motion rationed to one authored moment per surface, always with a reduced-motion escape

## Colors

A fourteen-token palette that is almost entirely one desaturated blue, spent so that a single teal can mean "live".

### Primary
- **Phosphor Teal** (`accent`): the live signal, and the only hue allowed to mean "this is the data". It draws the primary series in every chart, tints the active segment tab and the active nav item at 10% over the panel, marks the uplink direction (received), colours filter-match highlights, and carries focus rings. It is also the log console's arrival wash (`color-mix(… 13%…)`) and the rail echo (16%). It is never a background fill at full strength.
- **Teal, Dimmed** (`accent-dim`): the flatter working teal for solid fills where the bright accent would glare — volume bars, per-drive life tracks, the contents breakdown bars.

### Secondary
- **Signal Sky** (`blue`): the *second* series, and only ever the second. Transmit against the accent's receive in every paired throughput chart, the `restarting` status dot, and the "this attribute actually predicts failure" marker on SMART rows. It never appears alone as a primary accent.

### Tertiary
- **Sequential Teal Ramp** (`ramp-teal-deep` → `ramp-teal-mid` → `ramp-teal` → `ramp-teal-bright`): the four-step ordered ramp used when a single bar or treemap has to separate composed parts — disk segments (images / writable layers / volumes / build cache), the treemap's magnitude quartiles, the VRAM attribution bar. Darkest carries the largest value, so light labels sitting on top keep contrast. This ramp exists in code as literal hex in three files and is **not** currently a CSS token; treat these four values as the canonical series ramp and reach for them rather than inventing hues.

### Neutral
- **Deep Night** (`bg`): the page ground, also the browser theme colour and the resting fill of form inputs.
- **Panel** (`panel`): every surface. One step up from the ground, never more.
- **Panel Raised** (`panel-2`): hover and active surfaces, sticky table headers, skeletons, the hand-rolled filter inputs, and the "free"/"remaining" track in every segmented capacity bar.
- **Hairline** (`line`): the default 1px border and every table row divider (usually at `/50` or `/40`), plus the gauge track and meter track.
- **Hairline Bright** (`line-bright`): the hover border, the chart baseline, the stderr channel marker, and the dashed "measured, nothing moved" axis.
- **Ink** (`ink`): primary text and every live figure.
- **Ink Dim** (`ink-dim`): secondary prose, labels on controls at rest, `info`-level log text.
- **Ink Faint** (`ink-faint`): microlabels, units, timestamps, the `stopped` dot, `debug` log text, and the "others" long-tail segment.

### State
- **Healthy** (`ok`): the `running` dot and the healthy SMART verdict. Deliberately *not* used as a generic success accent — teal owns "good and live".
- **Attention** (`warn`): the `unhealthy` dot, degraded/partial-data notes, throughput over 85% of link capacity, and the broken-regex input border.
- **Failure** (`bad`): the `dead` dot, `error` log lines, destructive controls, and hard failures.

### Named Rules

**The One Live Hue Rule.** Teal is the only colour that may carry data by default. A second hue enters only when a chart genuinely has two series (then it is `blue`, in that order), or when a real threshold has been crossed (then it is `ok`/`warn`/`bad`). A magnitude is expressed by bar length, cell area, or ramp position — never by rainbow.

**The Bent-Colour Rule.** External colour is translated into this palette, never passed through. The log console's ANSI renderer maps every terminal colour onto app tokens (red→`bad`, green→`ok`, yellow→`warn`, blue→`blue`, cyan and magenta→`accent`, white→`ink`, black→`ink-faint`), resolves 256-colour and truecolour parameters down to those same eight tokens by hue, and renders bright variants as `filter: brightness(1.15)` rather than as a brighter token that does not exist. A raw `#00ff00` must never reach the screen.

**The Threshold Rule.** Amber and red are earned, not chosen. Every use is a comparison against a real limit — a drive's own critical temperature, 85% of a full-duplex link's one-way capacity, 80%/92% on a meter, the drive's own SMART threshold. Colour that expresses a feeling instead of a limit is how a dashboard teaches its reader to ignore it.

## Typography

**Body Font:** Inter (with Segoe UI, system-ui, -apple-system, sans-serif)
**Data / Mono Font:** Cascadia Code (with JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace)

**Character:** Two voices with a hard boundary between them. Inter narrates — page titles, section headings, explanatory sentences, empty-state copy. The mono voice reports — every numeral, container name, image tag, PID, path, port, IP, timestamp and log line. The pairing reads like a well-labelled instrument: prose to tell you what you are looking at, monospace for the thing itself.

### Hierarchy

Twelve steps ship, and the ramp is bottom-heavy on purpose: nine of the twelve sit at or below the body size, because this is an instrument panel and almost everything on it is a labelled reading rather than prose. Sizes below `text-sm` are written as literal `rem` values rather than named Tailwind steps — Tailwind's scale has nothing between `0.75rem` and `0.875rem`, and this system needs four sizes in that gap.

- **Figure** (400, mono, 1.5rem, `leading-none`): the one number a panel exists to report, at the centre of a gauge. Two sites only — the thermal arc's core temperature and the GPU session count (`1.25rem` there). Larger than the page title, and allowed to be, because it is a reading rather than a heading.
- **Headline** (600, 1.125rem, `tracking-tight`): the page title, once per surface. The largest *text* on any surface.
- **Subject** (600, mono, 1rem, `tracking-tight`): a section heading whose subject is a machine's own name — used on the uplink band's interface name. The one sanctioned mono heading. `1rem` also does two unrelated jobs: the `size="lg"` rate readout on the uplink, and the resting size of form inputs on touch, which drop to `0.875rem` from `md` — 16px is the threshold below which mobile Safari zooms the page on focus, so that one is a platform constraint, not a type choice.
- **Title** (600, 0.875rem, `tracking-tight`): section and panel headings. Also the slightly louder first line of an error or empty state.
- **Nav** (400, 0.8rem): the desktop sidebar's own size — nav links, the external Dockge link, and log out. It is also the mono size for the *subject of a row* in the two ranked lists: the container name in a resources row and the process name in the process table. In both roles it means "the name of the thing this line is about", one notch above the figures beside it.
- **Body** (400, 0.75rem, 1.5): the working prose size, and by volume the most-used step in the app.
- **Data** (400, mono, 0.75rem, `tabular-nums`): every figure. Applied via the mono class, which globally forces `font-variant-numeric: tabular-nums` — this is what keeps a 1 Hz column from jittering.
- **Log** (400, mono, 0.72rem, 1.5, `pre-wrap`, `break-all`): the log console body, a notch below the data size so a full band of lines fits. The same size appears on the process table's `lg`-only PID and thread columns, where it does the same job: a mono column dense enough that the standard data size would not fit the gutter.
- **Note** (400, 0.7rem, 1.5): the secondary explanatory line under a heading, and the most-used arbitrary size in the codebase. This is the voice that says "busiest first", "since boot", "one row per network namespace" — the sentence that stops a figure being misread.
- **Detail** (400, mono, 0.65rem): the third tier on a dense row — a socket's address list, a bridge's subnet, a shared-namespace note. Also the `Badge` component's own size.
- **Label** (600, 0.625rem, `0.14em`, uppercase, `ink-faint`): the microlabel. The universal caption for a figure, a legend entry, a section marker, a stack name, a unit. Available as the `.microlabel` class, and spelled as a literal size in the seven places that need the size without the uppercase-and-tracking treatment.
- **Tick** (400, 0.5rem, `0.08em`): chart furniture only — the domain endpoints printed either side of the thermal arc and the label inside the ring gauge. The floor of the ramp; nothing else may be this small.

Two sizes ship that are **not** ramp steps and should not be reached for in new work. `0.68rem` appears in eight places (container tiles, GPU rows, process-table footnotes, one resources row) and is visually indistinguishable from the `0.7rem` note step three steps above — it is drift, not a decision. `0.6rem` appears exactly once, on the `/` keycap hint in the log filter, where it is sized to sit inside a 1px-bordered box on one line; that one is a defensible one-off.

### Named Rules

**The Mono-Is-Data Rule.** If it is a number, an identifier, or a path, it is monospace. If it is a sentence, it is sans. There is no third option and no aesthetic mono — a mono heading is only allowed when the heading *is* the machine's own name for something.

**The Microlabel Rule.** Every figure gets a name, and the name is a microlabel. This is what buys the density: a labelled value costs one 10px line, so labelling everything is cheaper than making the reader infer. When a microlabel needs a non-default colour it must use the important variant (`!text-warn/80`), because `.microlabel` sets its own colour and loses on source order otherwise.

**The Tabular Rule.** Any figure that updates on a timer is tabular. Columns of live numbers must not reflow between ticks.

**The Bottom-Heavy Ramp Rule.** Nine of the twelve steps sit at or below `0.75rem`, and the four sizes between `0.625rem` and `0.75rem` carry most of the interface. Before adding a size, check the ramp — a new value within `0.02rem` of an existing step is drift, not a decision, and `0.68rem` is already in the codebase as proof of how that happens. Named Tailwind steps are used at `0.75rem` and above; below that the ramp is written as literal `rem` values, because Tailwind's scale has nothing in the gap this system lives in.

## Layout

A fixed 13rem (`w-52`) sidebar on the left from `md` up, with the content area offset by the same amount and centred in a `max-w-7xl` container. Content padding is `1rem` on phones and `1.5rem` from `md`, with a deliberate `pb-24` on mobile to clear the bottom tab bar.

Vertical rhythm is a single `space-y` stack per surface — `space-y-4` on the logs and resources pages, `space-y-5` on networks, `space-y-3` inside the stacked-track floor. Panels carry `p-4` when they are a block, or the `px-4 pt-3 pb-2` / `px-4 pb-3` header-plus-content split; dense rows inside a panel run `px-3 py-2`. Gaps are almost always `0.5rem` or `0.75rem`; `0.375rem` for chip and pill rows.

The breakpoint that matters is `md` (768px) — it is where the sidebar appears, where tables replace cards, and where controls step down from touch height to desktop height. `sm` (640px) handles secondary reflow (a row wrapping, a bar column appearing), `lg` reveals extra table columns, and there is one `min-[420px]` hinge on the vitals grid. Desktop layouts at and above 768px are settled and should not be renegotiated to solve a mobile problem.

Ordering is load-bearing on the data surfaces. Where a naive layout would render a grid of equal cards, these surfaces rank instead: the network page is ordered by the path a packet takes (uplink, then bridges, then containers, then listening ports) because everything below the uplink is a second view of bytes already counted above it; the log console puts the roster on a rail at the top and only the containers you chose to watch on the floor below. A grid of equals is a claim that the things are equal.

### Named Rules

**The 44px Rule.** Every interactive target is at least 44px tall on touch and may shrink only on pointer devices. The idiom is the paired class — `h-11 md:h-8`, `h-11 md:h-7`, `min-h-11 md:min-h-0`, `h-11 w-11 md:h-7 md:w-7` — and it is applied to icon buttons, chips, tabs, inputs, expander rows and inline text buttons alike. The mobile tab bar cells are `min-h-14`.

**The Table-Or-Cards Rule.** A table is a desktop form. Any `<table>` is `hidden md:table` and ships a `md:hidden` stacked-card rendering of the same rows beside it. A table that merely scrolls sideways on a phone is not an acceptable mobile state.

**The Touch-Equivalent Rule.** No affordance may be hover-only. `.hover-reveal` is visible by default and only becomes hover-gated inside `@media (hover: hover)`; `.panel-hover` declares an `:active` state alongside its hover state; anything driven by hover (the log track's autoscroll pause) also has an explicit control.

## Elevation & Depth

There are no drop shadows in this system. Depth is carried entirely by a one-step tonal lift plus a hairline border: the ground is `bg`, a surface is `panel`, a raised or hovered surface is `panel-2`, and the boundary between them is a 1px `line` border that brightens to `line-bright` on hover. The only shadow-like device is `.panel`'s 1px inset top highlight at 3% ink, which reads as a lit edge rather than as a lift.

Two exceptions are deliberate and narrow. Status dots carry a 6px coloured glow (`box-shadow: 0 0 6px 1px …/0.55`) — this is a phosphor effect, not elevation, and it is what lets an 8px mark read as "live" from across a room. Meter fills carry the same trick at 33% alpha of their own colour. Fixed chrome (the sidebar, the mobile bars, the sticky log toolbar) uses a translucent panel background plus `backdrop-blur` instead of a shadow to separate itself from scrolling content.

### Shadow Vocabulary
- **Panel lit edge** (`box-shadow: inset 0 1px 0 rgba(219, 231, 244, 0.03)`): on every panel, always. The system's entire elevation vocabulary.
- **Status glow** (`box-shadow: 0 0 6px 1px rgba(<state>, 0.55)`): on status dots only. Not available as a general emphasis device.
- **Channel marker** (`box-shadow: inset 1px 0 0 var(--color-line-bright)`): the 1px left edge marking a stderr log line.
- **Chip ring** (`box-shadow: 0 0 0 1px var(--color-accent)`): the rail's arrival echo, animated to transparent.

### Named Rules

**The No-Shadow Rule.** Separation is a hairline; emphasis is a tonal step; a glow is reserved for live state. If a surface needs to feel lifted, brighten its border, not the space under it.

**The One-Step Rule.** There are exactly three ground levels — `bg`, `panel`, `panel-2` — and a surface may only move one step. Nested panels are avoided; a panel with internal structure uses hairline dividers, not a second panel inside it.

## Shapes

Corners are gently rounded and quiet: `0.625rem` (10px) on panels, `0.375rem` on controls (buttons, tabs, chips, inputs, icon buttons), `0.25rem` on badges and treemap cells, `0.125rem` on legend swatches, and fully round on status dots, meters, tracks and progress fills. There are no square corners and nothing more rounded than a pill.

The recurring silhouettes are few and reused hard: the **hairline panel** (rounded rectangle, 1px border, lit top edge); the **horizontal track** (a `0.375rem` `line/60` pill holding a rounded fill, sometimes segmented with 2px gaps over a `line` ground and sometimes hatched at 135° when there is no telemetry to show); the **8px dot**; the **pill chip** (a panel at control height with a mono name); and the **band** — a full-width panel with a hairline-divided header row and a body, which is the shape both the log track and the uplink band take.

Borders are the primary form-defining device and they are always 1px. A thicker or coloured border is not used as an alert: the stderr marker is a 1px inset ring specifically because a hairline reads as "different channel" while a fat rule reads as "alarm".

### Named Rules

**The Hatch-Not-Empty Rule.** An absent measurement is drawn as a 135° hatched track, never as an empty one. An empty bar beside a full one reads as "pristine" or "nothing left" — both are claims the data does not support. The same applies to a zero-amplitude chart: an idle series draws a *dashed* baseline so "measured, nothing moved" cannot be mistaken for "chart failed".

## Components

### Panels & Cards
- **Character:** the only surface. Instrument housing, not a card in a feed.
- **Corner Style:** 10px (`0.625rem`).
- **Background:** `panel`, lifting to `panel-2` on hover when interactive.
- **Border:** 1px `line`, brightening to `line-bright` on hover/active.
- **Shadow Strategy:** the inset lit top edge only — see Elevation & Depth.
- **Internal Padding:** `1rem` as a block; `px-4 pt-3 pb-2` header / `px-4 pb-3` content when split; `px-3 py-2` for dense rows.
- **Note:** the newest surfaces apply `.panel` directly to a `<div>` or `<section>` rather than through the `Card` wrapper. Either is in-world; `.panel` is the source of truth and the wrapper is a thin convenience.

### Buttons
- **Shape:** softly rounded (`0.375rem`), never pill, never square.
- **Primary:** accent text on a 10% accent wash with a 30% accent border, lifting to 20% on hover. The accent is a tint, never a solid fill — a filled teal button would outshout the live data.
- **Hover / Focus:** background steps up one wash level; focus is a 1px accent ring (`focus-visible` only); pressing scales to 0.98.
- **Outline / Ghost:** outline is a `line` border with `ink-dim` text going to `ink` and `line-bright`; ghost drops the border and hovers to `panel-2`. Ghost is the default for a low-stakes inline action.
- **Danger / Warn:** the same tint-and-border construction on `bad` and `warn`.
- **Sizes:** `2.5rem` tall on touch dropping to `2rem` on pointer, with `sm`/`lg`/`icon` variants following the same paired pattern. Disabled is 40% opacity with pointer events off.

### Segmented Control
- **Style:** a `panel` with `0.25rem` of padding holding a row of `0.375rem` buttons; the active one takes the primary button's accent tint, the inactive ones are transparent-bordered `ink-dim` text hovering to `panel-2`.
- **State:** `aria-pressed` carries selection; every tab keeps an unabbreviated `aria-label` and `title` because its visible text is clipped to fit six tabs on a phone.
- **Use:** the one control for switching a lens on the same subject — metric tabs, sub-views, log level pills, the ANSI toggle. Do not re-declare a local variant of it; a toggle that looks subtly different in two places means one of them is wrong.

### Inputs
- **Style:** 1px `line` border on the `bg` ground, `0.375rem` corners, mono text, `ink-faint` placeholder, `2.75rem` tall dropping to `2rem` on pointer.
- **Focus:** border to 50% accent plus a 30% accent ring. No glow, no lift.
- **Error:** the border goes 60% `warn` and focuses to solid `warn`, with `aria-invalid` and a `warn` message pointed at by `aria-describedby`.
- **Filter/search variant:** a leading `13px` search glyph in `ink-faint`, a trailing clear button that appears once there is a query, and a `/` keycap hint in a hairline box while the field is empty.
- **Label:** a microlabel with `0.25rem` of space beneath it.

### Badges
- **Style:** mono, `0.65rem`, a `0.25rem` rounded rect with a 30% coloured border and a 5% fill of the same colour. Six variants: neutral, ok, warn, bad, accent, blue.
- **State:** mapped from machine state by a single shared function — `unhealthy`→warn, `running`→ok, `restarting`→blue, `dead`→bad, everything else neutral. Never assign a badge colour by hand at a call site.

### Status Dot
- **Character:** the system's signature. An 8px round mark with a 6px coloured glow, doing the work a coloured label would otherwise do.
- **States:** `running` (green, steady), `unhealthy` (amber, 1.6s pulse), `restarting` (sky, 0.9s pulse), `dead` (red, steady), `stopped` (`ink-faint`, no glow — the only unglowed dot, because "off" should not radiate).
- **Rule:** pulsing is reserved for the two states that want you to look — unhealthy and restarting. A healthy dot never animates.
- **Reuse:** the same dot carries stream-connection state (idle / connecting / streaming / reconnecting / signed out) and rides the nav as an unhealthy-count badge.

### Navigation
- **Desktop:** a 13rem sidebar on a translucent `panel/70` with `backdrop-blur` and a hairline right edge. Brand block at the top — a 16px accent activity glyph beside "night<accent>watch</accent>" in mono 600, with a microlabel host line under it. Items are `0.8rem`, `0.375rem` rounded, `ink-dim` at rest hovering to `ink` on `panel-2`; the active item takes the accent tint with a 20% accent border. External links and log-out sit below a hairline at the bottom, log-out hovering to `bad`.
- **Mobile:** the sidebar is replaced by two bars — a sticky top bar carrying the brand and two 44px icon actions, and a fixed 8-cell bottom tab bar on `panel/95` with `backdrop-blur`. Tab cells are icon-over-truncated-label, active in accent, and both bars honour `env(safe-area-inset-*)`.

### Charts (signature)
Every chart in this system is hand-rolled SVG on a fluid `viewBox` with `preserveAspectRatio="none"`, `vectorEffect="non-scaling-stroke"` on strokes, and `aria-hidden` on the graphic with the meaning carried in adjacent text. There is no chart library and adding one is not a casual decision.

- **Sparkline / area:** a 1.5px stroke over a 12–16% fill of the same colour. Colour comes from `currentColor` in the newer implementation, so the caller sets the hue with a text class.
- **Bidirectional throughput:** receive above a shared baseline, transmit mirrored below it, `accent` above and `blue` below, both at 16% fill with a 1.25px stroke, and the baseline drawn *last* in `line-bright` so it reads as the axis rather than as something buried under the fills.
- **Segmented capacity bar:** a `1.25rem` tall `line`-ground strip of ramp-coloured segments separated by 2px gaps, with the segment's own label printed inside it once it exceeds 9% of the width, a `panel-2` "free" remainder, and a microlabel legend of `0.5rem` swatches beneath.
- **Meter:** a `0.375rem` `line/60` pill whose fill switches accent→warn→bad at 80/92 and carries a 33% glow of its own colour.
- **Ring / arc gauge:** a `line` track with a rounded coloured arc, the figure in mono at the centre and a microlabel beneath it, animated by `stroke-dashoffset`.
- **Treemap:** area encodes magnitude and fill only ranks it — the four-step teal ramp by quartile, largest darkest, labels suppressed below 72px of width, and a long tail folded into one non-interactive "others" cell rather than a wall of slivers.

### Log Console (signature)
Each watched container owns a full-width band: a hairline-divided header carrying the container name in mono, a status readout, a rate figure and right-aligned 44px icon controls, over a `.logbox` body. A row is `timestamp · level code · message`, where level colour lives only in the gutter and the message column belongs to the container's own ANSI — two colour systems must not fight over the same pixels. stderr is marked with a 1px inset `line-bright` edge. A held-back-lines pill floats bottom-right on `panel-2` with a `line-bright` border and accent mono text.

The companion rail is the other half of the metaphor: selecting a container does not remove its chip, it *hollows* it — the chip becomes a dashed `line-bright` outline reading "on the floor" while its socket keeps its place, so 26 chips never reflow and a glance tells you what you are watching. Chips are grouped by compose stack under microlabel headings, scrolling horizontally with snap on a phone and wrapping from `md`.

## Do's and Don'ts

### Do:
- **Do** put every figure in mono and every sentence in sans, and let `.font-mono`'s global `tabular-nums` keep live columns still.
- **Do** caption with `.microlabel` (10px, `0.14em`, uppercase, `ink-faint`), and use the `!` important variant when it needs another colour.
- **Do** build surfaces out of `.panel` with hairline `line` dividers, hovering to `panel-2` / `line-bright`.
- **Do** carry state with a `.dot`, and reserve the pulsing variants for `unhealthy` and `restarting`.
- **Do** keep teal as the only data hue, add `blue` only as a genuine second series, and let bar length, cell area or ramp position carry magnitude.
- **Do** reach for the four-step teal ramp (`#134e4a` / `#0f766e` / `#0d9488` / `#14b8a6`, darkest = largest) when one bar or map has to separate composed parts.
- **Do** pair touch and pointer heights on every control (`h-11 md:h-8`, `min-h-11 md:min-h-0`) and ship a `md:hidden` card rendering beside every `hidden md:table`.
- **Do** write empty, idle and unavailable states as real copy that says what is true — "waiting for the first line — quiet is normal here", "no traffic in the window", "unattributed", "only 37 lines exist for this container". On a host this quiet, a healthy-but-idle stream must never render as "no data".
- **Do** distinguish "measured zero" from "could not measure": dashed baseline for the former, hatched track and named reason for the latter.
- **Do** gate every authored animation behind `prefers-reduced-motion` (either the CSS media query or `motion-reduce:transition-none`) and keep it to one moment per surface.
- **Do** bend any external colour onto these tokens before it reaches the screen.

### Don't:
- **Don't** add a light theme, a theme toggle, or a `prefers-color-scheme` branch. This world is dark only and `color-scheme: dark` is set on `html`.
- **Don't** introduce a drop shadow for depth. Brighten a border or step the tone; the glow is for live state only.
- **Don't** use a thick or coloured border as an alert — a hairline means "different channel", a fat rule means "alarm", and most distinctions are the former.
- **Don't** solve a many-categories problem with many hues. Eight segments get lightness and area; the moment a ramp would reach magenta it has left this world.
- **Don't** write a raw hex or `rgb()` colour into a component. Use the tokens, or `color-mix(in srgb, var(--color-…) N%, transparent)` when a wash is needed — a literal that happens to match today desyncs the moment the token moves.
- **Don't** let an animation own a property another rule needs. `both` keeps the final keyframe applied, so an animation that also drove the stderr marker silently deleted it; animate background and ring, not borders that carry meaning.
- **Don't** render a grid of equal cards for things that are not equals — rank them, or give the chosen ones their own band.
- **Don't** add a charting library, a UI kit, or a new runtime dependency to draw something this system already draws in ~100 lines of SVG.
- **Don't** make anything hover-only, and don't let a control fall below 44px on touch.
- **Don't** use `ok` green as a general success accent or `warn`/`bad` as decoration — state colour must trace to a real threshold.
- **Don't** re-declare a local variant of a shared control. If a segmented button, badge or dot needs to look different somewhere, the difference is probably the bug.
