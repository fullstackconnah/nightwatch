# Destructive & Consequential Actions

DESIGN.md documents how a danger button *looks* (`bad` tint + border). It never
documented *when* an action earns a confirm step, or which confirm idiom applies.
An audit (`docs/dash-analysis/antipatterns.md`, Finding 1) found three different
answers already live in the app with no written rule connecting them. This doc is
that rule.

## The finding, restated

Danger-tinted styling and a confirm gate are **two independent decisions**, not one.
Tint answers "should this button visually stand out as the one that ends something
in this row?" A confirm gate answers "does a stray tap here cost something that a
second tap can't immediately undo?" Conflating them is what made the app's controls
look like three ad hoc answers — they're actually four distinct risk shapes, each
correctly handled, that were never named as a taxonomy.

## The four tiers

### Tier 1 — Destroys data (no reciprocal action undoes it)

The action removes something with no "undo" screen anywhere in the app: a deleted
image has to be re-pulled, a pruned volume's contents are gone, a cleared
integration secret has to be re-typed from its source (HA, NPM, Forgejo, GitHub all
require going back to that service to mint a new one). Reversibility isn't "tap the
opposite button," it's "leave the app and go redo the work."

**Idiom:** inline two-step — tap once, a labelled sentence with separate
Cancel/Confirm buttons appears in place of the trigger, Confirm is danger-tinted,
never a browser `confirm()`. Copy names the count/size and says it can't be undone.

**Examples:**
- `reclaim-shared.tsx`'s `PruneAction` (`:36-99`) — "Prune 3 images, reclaim ~1.2 GB? Can't be undone."
- `image-delete-action.tsx` (`:80-95`) — "Delete nginx:latest, free ~340 MB? Can't be undone."
- `settings-integrations.tsx`'s `ClearControl` (`:212-241`) — "Remove the Home Assistant connection? You'll need to re-enter its credentials to reconnect."

### Tier 2 — Physical-world / safety-critical

The consequence lands outside the software the instant it fires. An unlocked door
is a physical fact the moment the command sends — there's no in-app "undo" to walk
back to, even though tapping Lock again technically reverses the device state a
second later. The risk being guarded against is a stray tap on a touchscreen wall
panel (sat on, bumped, mashed by a kid), not "did the user read a sentence and
click Cancel." A text confirm with a Cancel button is easy to blast through by
habit; a same-position second tap in a tight window is not.

**Idiom:** self-arming — the same button relabels itself "Confirm lock"/"Confirm
unlock" and must be tapped again within a short window, no separate Cancel
affordance. This is deliberately a *different* grammar from Tier 1: the safety
property here is "two deliberate taps," not "read and decide."

**Example:** `ha-locks.tsx`'s `HaLockRow` (`:68-163`). The original implementation
armed silently — if the window lapsed with no second tap, the button reverted with
no on-screen explanation. That's a real gap (a physical-safety control should not
leave the operator guessing why nothing happened), so it's fixed here, not just
documented: an inline status line now appears while armed — "Tap again to confirm
— cancels itself in 4s" (`ha-locks.tsx:133-141`), `role="status"` so it's announced
to a screen reader too. The self-arm pattern itself is kept as-is — it's the right
idiom for this tier.

### Tier 3 — Reversible, but the blast radius reaches beyond this tap

The action is trivially reversible (a reciprocal action, or in some cases an
automatic timeout, restores it), but it reaches into a shared resource or someone
else's system rather than staying contained to the control you tapped:
disabling Pi-hole blocking drops ad/tracker filtering for every device on the LAN,
not just the tab you're looking at; a bulk qBittorrent pause stops every active
transfer at once; an RSS sync or missing-episode search makes a real outbound call
against an indexer. None of it destroys anything, so the danger vocabulary
(bad tint, "can't be undone") doesn't apply — but a bare single tap from a compact
menu meant for browsing is still too easy to fire by accident against a shared
resource, so the same deliberate-intent *shape* as Tier 1 is reused without its
color.

**Idiom:** inline two-step, same Cancel/Confirm shape as Tier 1, but the trigger
stays ghost and Confirm stays outline — never danger-tinted, because nothing is
being destroyed.

**Example:** `widget-actions.tsx`'s `WidgetActionRow`/`WidgetActionsMenu` confirm
branches (`:88-99`, `:181-194`) — Pi-hole blocking toggle, Sonarr/Radarr RSS
sync/search, qBittorrent pause/resume all. `src/lib/widgets/actions.ts` (not owned
by this pass) already carries per-action confirm copy that names the consequence
("Disable Pi-hole blocking for 5 minutes?") rather than a generic "are you sure" —
no change needed there.

### Tier 4 — Reversible, single-target daemon lifecycle

A reciprocal action in the same row or detail view immediately restores the prior
state, the interval between a mistake and the fix costs nothing, and the control is
the single most-frequent action in the entire app (PRODUCT.md: "actions one tap
from information — never bury lifecycle controls behind navigation"). Confirmation
here is friction, not safety: Docker's own CLI doesn't confirm `docker stop`
either, and a two-step gate on the app's bread-and-butter action would be the
opposite of glance-and-act.

**Idiom:** no confirm step at all. Stop keeps its danger tint (`container-controls.tsx`'s
`LIFECYCLE_META`, `:23-32`) purely as the "this row ends something" visual cue — that
tint is the Tier-4 case proving tint and confirm-gate are independent: Stop is
danger-tinted *and* ungated, on purpose.

**Example:** `container-controls.tsx`'s `LifecycleActions` (`:122-173`) — start,
stop, pause, resume, restart. (The audit's finding referenced a "Kill" action;
no such verb exists in `LIFECYCLE_META` — only the five above.)

## What changed vs. what was kept

Comparing every destructive control against this taxonomy found **no
tier-misclassifications** — each control was already living in the tier its risk
shape calls for. Nothing needed to move from one confirmation idiom to another.
What *was* missing:

- **The rule itself, written down** — this document.
- **Weak confirm/error copy in the Tier 1 (data-loss) controls** — none said
  "can't be undone" or explained what re-connecting a cleared integration would
  cost; fixed in `reclaim-shared.tsx`, `image-delete-action.tsx`,
  `settings-integrations.tsx`.
- **Generic fallback error strings** ("prune failed", "delete failed", "save
  failed", "clear failed", "action failed") across `reclaim-shared.tsx`,
  `image-delete-action.tsx`, `settings-integrations.tsx`, `widget-actions.tsx` —
  each now points at a next action ("Couldn't prune — try again") instead of
  restating the verb. These fallbacks only fire when the thrown error isn't an
  `Error` instance — the common path still surfaces the real API message.
- **Silent timeout in the Tier 2 control** — `ha-locks.tsx` now explains its own
  arm window instead of reverting with no on-screen trace.

## Rule of thumb for new controls

Ask two questions independently:

1. **Does anything in this app undo it?** No → Tier 1 (data loss) or Tier 2
   (physical/safety, if the consequence isn't software state at all). Yes → keep
   going.
2. **Does the mistake cost something beyond this one control** — a shared
   resource, another system, a household-visible effect? Yes → Tier 3 (keep the
   two-step shape, skip the danger tint). No → Tier 4 (no confirm; tint only if
   the verb ends something).

Don't reach for a browser `confirm()` or a modal at any tier — the inline two-step
and the self-arm pattern both already solve this without either.
