# Anti-Pattern Audit — nightwatch dashboard (non-kiosk)

Scope: 15 routes under `src/app/(dash)/` + `login`, ~65 non-kiosk components in
`src/components/`, `src/app/globals.css`, `DESIGN.md`, `PRODUCT.md`. `/kiosk` excluded
per instructions (it isn't even a route under `(dash)` — it lives elsewhere and was
audited separately).

## Score

**3 / 4 — mostly clean, subtle tells only.**

Every item on the absolute-ban list came back clean (see table). The codebase is
unusually self-aware — most components carry a `THESIS`/`OWN-WORLD` comment block
that pre-empts exactly the kind of critique this audit runs. The real findings are
not decoration-slop; they are three concrete, evidenced *consistency* gaps that a
careful pass surfaces: a fractured danger-action confirmation vocabulary, an
under-gated set of spin animations, and one route missing the error leg of the
loading/empty/error triad. None of these are cosmetic — they are the kind of thing
that erodes trust exactly where DESIGN.md/PRODUCT.md say trust matters most
(honesty about state, touch safety on destructive actions).

## Verdict

**Does it read as AI-generated?** No. Bespoke SVG charts, a real named design system
with "The Bottom-Heavy Ramp Rule" / "The Hatch-Not-Empty Rule" etc., comments that
argue with a *previous version of themselves* (see `log-arrival`'s keyframe note in
globals.css), and zero instances of any of the six banned decorative tropes. This is
not template output.

**Does it pass the product trust test (Linear/Figma/Notion/Stripe bar)?** Mostly yes,
with one real crack: **`/containers` — the single most-used inventory page in the
app — has no error state.** `useContainers()` is destructured without `error`, so a
downed Docker socket renders an infinite "loading…" instead of the honest
"Docker unreachable" message every sibling route (`/`, `/resources`, `/volumes`,
`/images`, `/networks`, `/git`, `/proxy`, `/hermes`, `/smarthome`, `/logs`) shows via
the same hook. A Stripe-calibre engineer would catch this in a socket-down demo
within a minute. The second-worst finding — three different confirmation idioms for
danger-tier actions with no documented rule for which applies when — is subtler but
real: someone who learns "type Confirm/Cancel" from pruning an image gets a silent
mismatch at the Lock/Unlock button and no mismatch at all at Stop (which just fires).

## Ban matches

| Ban | Hit? | file:line | Defensible? |
|---|---|---|---|
| Side-stripe borders (coloured L/R accent) | No | — | n/a — not found anywhere in non-kiosk code |
| Gradient text (`bg-clip-text`) | No | — | n/a |
| Decorative gradient backgrounds | No | — | n/a |
| Decorative glassmorphism | Partial | `side-nav.tsx:126,206,241`, `log-console.tsx:320`, `settings-section-nav.tsx:85`, `create-container.tsx:57` | **Yes, defensible.** All 7 `backdrop-blur` uses are on sticky/fixed chrome (nav bars, sticky rail, a real modal's scrim) that sits over live-scrolling content — functional legibility, not a decorative panel treatment. None is on a static content card. |
| Hero-metric template (big number + label + accent) | No | — | Explicitly refused. `resources/page.tsx:1` THESIS comment: "refuses the category default of a stats table with a chart bolted on" — ships a squarified treemap instead. `resource-overview.tsx` and `/` (overview) have no big-number hero anywhere. |
| Identical card grids for unequal things | No | — | `/` (overview) explicitly swaps its container grid for a single ranked column when sorting (`resource-overview.tsx`/`page.tsx:259-274`, comment: "A grid of equal cards is a claim the things are equal"). |
| Uppercase tracked eyebrows above every section | Partial (see below) | — | Not a trope hit — see Component Vocabulary section |
| Numbered section scaffolding (01/02/03) | No | — | n/a |
| Text overflowing its container | No confirmed hits | — | Every truncation-risk spot inspected uses `truncate`/`min-w-0`/`break-all` deliberately (e.g. `segment-button.tsx:24-30`'s own comment about a past "STO…" clipping bug it fixed) |
| Nested cards (`.panel` inside `.panel`) | No | — | Bordered sub-rows inside panels (e.g. `disk-scan-jobs.tsx:233`) use a plain `border`, not the `.panel` elevation treatment — not double elevation |
| Gray text on coloured background | No | — | n/a |
| Bounce/elastic easing | No | — | All authored easings are `cubic-bezier(0.16,1,0.3,1)` (Motion-standard ease-out-expo family) or the deliberate `cubic-bezier(0.36,0.07,0.19,0.97)` kiosk-only PIN shake |
| Arbitrary z-index (999/9999) | No | — | z-index usage is a small closed set (`z-20`/`z-30`/`z-40`/`z-50`) tied to a real stacking story (menu → sticky header → nav chrome → modal) |

## Component vocabulary consistency (the big one)

Base vocabulary (`Button`, `Card`, `Badge`, `SegmentButton`, `Input`) is genuinely
unified — one `cva` definition each, reused everywhere, with the 44px-touch/32px-
pointer paired-height idiom applied without exception across every family checked
(`settings-*`, `ha-*`, `git-*`, `hermes-*`, `reclaim-*`, `disk-*`, `net-*`). Panel
headers follow one of two deliberate, contextual shapes (`.panel p-4` + `mb-3`
icon+microlabel row for compact info panels vs. `panel overflow-hidden` + a
bordered header strip for list/table panels) — not drift, a real "these are two
different content shapes" distinction. `settings-*` in particular is a model of
consistency: every card shares Card/CardHeader/CardTitle, every secret uses the same
write-only `SecretField`, every skeleton uses the same staggered-delay
`animate-pulse` treatment.

**Finding 1 — three divergent confirmation idioms for danger-tier actions, undocumented (P1).**

DESIGN.md documents *how* a danger button looks (tint+border on `bad`), but not *when*
a destructive action needs a confirm step at all. In practice the app has landed on
three different answers, discovered by comparing every destructive control:

- **Pattern A — inline two-step, explicit Cancel/Confirm text.** `reclaim-shared.tsx`'s
  `PruneAction` (`reclaim-shared.tsx:36-99`), `image-delete-action.tsx:80-94`,
  `settings-integrations.tsx`'s `ClearControl` (`settings-integrations.tsx:179-208`),
  and `widget-actions.tsx`'s confirm branch (`widget-actions.tsx:88-99`, `181-194`)
  all: tap once → a labelled sentence appears with separate Cancel/Confirm buttons →
  tap Confirm → spinner. Four independent implementations, but they agree byte-for-byte
  on the interaction shape and several comments cross-reference each other as "the
  same idiom" — this is the closest thing the app has to a documented rule.
- **Pattern B — self-arming button, no visible Cancel.** `ha-locks.tsx:85-99`: tap
  Lock/Unlock once and the *same button* relabels itself "Confirm lock" / "Confirm
  unlock"; tapping again within a silent 4000ms window sends the command; letting the
  timer lapse silently disarms with no visible feedback that it happened. There is no
  Cancel affordance at all — disarming is implicit and time-based.
  `ha-locks.tsx:10-13` explains the intent ("a lock is a door — no accidental taps")
  and it is a reasonable answer to a physical-safety problem, but it is a second,
  incompatible grammar for "this is about to do something dangerous," learned nowhere
  else in the app.
- **Pattern C — no confirmation at all.** `container-controls.tsx`'s `LifecycleActions`
  (`container-controls.tsx:147-178`) fires `Stop` — `variant: "danger"` in
  `LIFECYCLE_META` (`container-controls.tsx:31`) — on a single tap, with no arm step
  and no Cancel. Same for the duplicated header implementation in
  `containers/[id]/page.tsx:209-230`. Stopping a container is visibly styled exactly
  like the actions in Pattern A (danger tint+border) but requires zero confirmation
  taps instead of two.

Single-tap Stop is plausibly a *deliberate* choice — it's reversible (Start undoes
it) and Docker CLI itself doesn't confirm — but nothing in DESIGN.md or PRODUCT.md
states that reversibility is the rule that decides which pattern applies, so it reads
as three ad hoc answers rather than one policy applied three times. Recommend either
documenting the taxonomy ("irreversible data loss → Pattern A; physical/safety
critical → Pattern B; reversible daemon lifecycle → no confirm") in DESIGN.md, or
collapsing B and C toward A.

**Finding 2 — `LifecycleActions` is duplicated, not reused, in the container detail header (P2).**

`container-controls.tsx:14-18`'s own comment claims: "The overview cards, the
containers table and the detail header all read from here" (i.e. from
`LIFECYCLE_META`/`actionsFor`). That's true for the *verb definitions* (label, icon,
danger/default variant) — genuinely centralized and reused. It is not true for the
*rendering*: the detail header (`containers/[id]/page.tsx:209-230`) hand-rolls its
own `.map()` over `actionsFor(status)` and its own spinner class logic instead of
calling the exported `<LifecycleActions>` component
(`container-controls.tsx:122-178`). The visual outcome is a defensible difference
(header wants labelled buttons; table/tile rows want icon-only ghost buttons, and
`LifecycleActions` is hardcoded to the latter) — but DESIGN.md's own rule is "Don't
re-declare a local variant of a shared control... the difference is probably the
bug," and here the duplication is exactly why the two copies of the pending-spinner
logic have since drifted (see Finding 3).

## Motion inventory

Every authored animation/keyframe in `globals.css` outside the kiosk-scoped blocks is
individually reasoned about in its own comment and gated behind
`@media (prefers-reduced-motion: reduce)`: the status-dot `pulse` (unhealthy/restarting
only — `globals.css` block 2), `net-sweep` (`.net-reveal`, one authored moment on
`/networks`), `log-land`/`rail-land` (`.log-arrival`/`.rail-arrival`, one moment on
`/logs`), and `voice-mic-pulse` (`.voice-mic-recording`, shared by kiosk mic and the
`/hermes` mic). The mobile nav sheet's slide-up (`side-nav.tsx:365,371`) and the
resource-panel accordion (`resource-overview.tsx:83,94`) are plain Tailwind
transitions, both carrying `motion-reduce:transition-none`. This is thorough — nine
of eleven CSS-level motion sites checked are correctly gated.

**Finding 3 — 5 of 16 `animate-spin`/`animate-pulse` call sites lack a
`motion-reduce` companion (P2), same shape as the kiosk pass's ungated-`infinite`
finding.** 11 spinners are correctly written `animate-spin motion-reduce:animate-none`
(`image-delete-action.tsx:108`, `reclaim-shared.tsx:90`, `widget-actions.tsx:110,205`,
`settings-access.tsx:206`, `git-mirror-panel.tsx:63`, `hermes-ask.tsx:57`,
`hermes-actions.tsx:57`, `hermes-voice-mic.tsx:70`, `kiosk-voice.tsx:163`). Five are
not:

- `disk-contents.tsx:251` — Rescan button icon, bare `animate-spin`
- `disk-scan-jobs.tsx:117` and `:200` — both `Loader2` progress spinners, bare `animate-spin`
- `disk-pinned.tsx:129` — Refresh icon, bare `animate-spin`
- `container-controls.tsx:170` — the shared `LifecycleActions` pending icon (affects every
  overview tile, the containers table, and — see Finding 2 — its duplicate at
  `containers/[id]/page.tsx:224`)

These aren't decorative — a Stop/Restart spin can run for up to Docker's 15s SIGTERM
grace period — so this is a real, sustained-motion gap for `prefers-reduced-motion`
users, concentrated almost entirely in the `disk-*` family (3 of 4 disk components
miss it) plus the one shared lifecycle-action icon. Cheap, mechanical fix.

## Loading/empty/error coverage by route

| Route | Loading | Empty | Error | Notes |
|---|---|---|---|---|
| `/` (overview) | Yes | Yes ("no containers match") | Yes ("Docker unreachable: …") | Full triad, honest copy |
| `/resources` | Yes ("discovering containers…") | Yes | Yes | Full triad |
| `/containers` | Yes ("loading…") | Yes ("no containers match") | **No** | `error` never destructured from `useContainers()` (`containers/page.tsx:122`) — see Verdict. Loading and empty are folded into one ternary; an unreachable socket looks identical to "still loading." |
| `/containers/[id]` | Yes | n/a (single record) | Yes | Handles not-found and fetch failure |
| `/git` | Yes (skeleton) | Yes | Yes | |
| `/gpu` | n/a | n/a | n/a | Pure redirect shim to `/resources?metric=gpu` — legitimate legacy-URL preservation, not a real page |
| `/hermes` | Yes | Yes | Yes ("unreachable" + real message, `hermes-status.tsx:37,72`) | |
| `/images` | Yes | Yes | Yes | |
| `/logs` | Yes | Yes | Yes | SSE stream, handles reconnecting state too |
| `/networks` | Yes | Yes | Yes | |
| `/proxy` | Yes | Yes | Yes | |
| `/resources` | Yes | Yes | Yes | (see above) |
| `/settings` | Yes (per-card skeletons) | n/a | Yes (per-card) | Consistent skeleton idiom across all 5 sections |
| `/smarthome` | Yes | Yes ("No locks exposed…" etc., per-panel) | Yes ("unreachable" + real message, `ha-status.tsx:40,72`) | |
| `/volumes` | Yes | Yes | Yes | |
| `login` | n/a | n/a | Yes (bad password) | |

14 of 15 real routes have the full honest triad. `/containers` is the one gap, and
it's the highest-traffic route in the app (the primary inventory table).

## Copy quality

Consistently strong. Empty/idle states name what's true instead of defaulting to
"No data": *"Nothing to reclaim — every volume is attached to a container."*
(`reclaim-volumes.tsx:71`), *"another arts unused image space sits in tagged images
no container is using"* (`reclaim-images.tsx:141-144`), *"ollama is reachable but has
no models installed"* vs. a generic unreachable message (`settings-hermes.tsx:137,142`),
*"recording will start on the next telemetry tick — check back in about a minute"*
(`resource-overview.tsx:417-419`). Error copy consistently surfaces the real
`error.message` from the failing fetch rather than a generic "Something went wrong"
(every `catch` block reviewed follows `e instanceof Error ? e.message : "<verb>
failed"`). This is the copy-quality bar DESIGN.md's Do's list asks for, actually met.

## Destructive-action patterns

Covered in Component Vocabulary Finding 1 above. Summary: prune/delete/clear
(images, volumes, integration secrets, widgets) share one well-factored idiom via
`reclaim-shared.tsx` and the copy-pasted-but-identical `ClearControl`; HA locks and
container lifecycle stop/pause each use their own different idiom, and the app has
no written rule for which class of danger gets which treatment.

## Genuinely good

- **Modal discipline.** Only one true modal exists in non-kiosk code
  (`create-container.tsx`'s form dialog — a genuinely complex multi-field flow behind
  an explicit "New container" button) plus one mobile nav sheet
  (`side-nav.tsx`'s `MoreSheet`, replacing a sidebar that can't fit on a phone). Every
  other "are you sure" or contextual action uses inline expansion or a small
  anchored popover (`widget-actions.tsx`'s `WidgetActionsMenu`). No reach-for-a-dialog
  reflex anywhere.
- **Honest-zero vocabulary is real, not aspirational.** The Hatch-Not-Empty rule
  (dashed baseline for "measured, nothing moved" vs. hatched track for "could not
  measure") is implemented exactly as documented in `resource-overview.tsx:312-331`
  and shows up again in `reclaim-images.tsx`'s distinction between "0 dangling
  images" and "additional unused space this UI deliberately won't offer to prune."
- **The one hero surface that could have been a hero-metric card
  (`/resources`) explicitly argues against it** in its own top-of-file comment and
  ships a treemap instead — a rare case of a team catching its own risk before
  writing the code.
- **Accessibility-adjacent honesty:** `--color-ink-faint` was measured and raised to
  clear 4.5:1 against every one of 16 kiosk theme grounds (documented in project
  CLAUDE.md), and interactive glyph color (the port-chip colon) was caught failing
  contrast and fixed rather than left because "it looked fine" (`container-controls.tsx:350-354`).
