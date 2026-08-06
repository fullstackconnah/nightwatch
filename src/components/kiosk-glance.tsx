"use client";

/* THESIS: the glance-only remainder of the old "Glance Board" layout. Since
   redesign-06 §5 merges Glance and Standard into one surface, the clock,
   the current-temperature reading and the server/health line all moved out
   of this file into kiosk-surface.tsx's shared header — those three are
   FLIP shared elements (same DOM node in both modes, see that file's
   structural-rule comment), and this component only ever renders while the
   surface is in glance mode, so it can't own a node that has to survive
   into full mode too. What used to live directly in this file (the weather
   sentence, the morning briefing line, the auto-picked light/scene tiles) is
   now owned by the widget registry (kiosk-widgets.tsx).

   The ROTATING carousel is not here. It lives in kiosk-surface.tsx, inside
   the shared forecast FLIP node, because the owner wanted the wide band under
   the clock to be what cycles — forecast, news, climate, containers — rather
   than a second pane area stacked beneath it. `layout.glance` drives THAT.
   What this file still renders is the fixed stack below the band plus the two
   corner buttons, all of which stay OUTSIDE the rotation on purpose: a
   control that moves away mid-reach is hostile, so only the things you read
   rotate, never the things you press.

   OWN-WORLD, inverted: where the standard layout is hairline panels, this
   content is deliberately OPEN GROUND — no .panel boxes at all; type and
   spacing carry the composition, and the one accent hue only appears on
   live state (a tile that's on) or a real problem. That inversion is the
   point: on a surface this quiet, the single warn line is unmissable.

   Night is NOT handled here — page.tsx's KioskNightOverlay owns 22:00–05:00
   regardless of mode. Elevation also isn't: kiosk-surface.tsx pins the
   surface to full mode whenever elevated, because admin work needs the hub
   and panels, so this component never renders while elevated. */

import { useMemo } from "react";
import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIOSK_WIDGET_MAP, type KioskWidgetCtx, type KioskWidgetId } from "@/lib/kiosk-widgets";
import { type KioskPeriod } from "@/components/kiosk-display";
import { KioskTimersButton } from "@/components/kiosk-timers";
import { useKioskHa } from "@/components/kiosk-hub";

/* The fixed, non-rotating stack under the band. Deliberately NOT the
   reorderable layout: `layout.glance` now drives the BAND (kiosk-surface.tsx),
   and these are the controls plus the two quiet sentences that were glance's
   original content before the widget work. Kept as a constant here rather
   than a third persisted screen so the Widgets tab stays a single, honest
   question — "what rotates through the band?" — instead of two lists whose
   difference nobody would remember.

   `lights` LEFT this stack (2026-08-05): the light tiles are now part of the
   fixed bottom-left control cluster beside the timers button (GlanceLights
   below), not centred content. Two reasons, one of them measured: the tile was
   the single tallest thing under the band, and at 800×480 it landed at y=455
   with a 64px height against a 448px box — clipped, i.e. a control you could
   see half of and not press. Moving it into the corner is also the honest
   composition: everything left in the centre column is now something you READ,
   and everything you PRESS lives in one of the two bottom corners. `scenes`
   stays because this house has none (the widget renders nothing), and a scene
   is a one-shot activation rather than a live-state toggle worth a permanent
   corner slot — if scenes ever appear here, they belong in the band. */
const BELOW_BAND_WIDGETS: readonly KioskWidgetId[] = ["weather-outlook", "briefing", "scenes"];

/** The subset of the stack above that is prose rather than a control, and so
 *  is what gets dropped first when the viewport is too short to hold
 *  everything (see the render below). Controls are never in this set. */
const INFORMATIONAL_WIDGETS: ReadonlySet<KioskWidgetId> = new Set(["weather-outlook", "briefing"]);

/* ── the bottom-left control cluster ────────────────────────────────────── */

/** Every available Home Assistant light, as a compact pill sized to sit beside
 *  the timers button rather than as one of the widget registry's `min-h-16
 *  min-w-32` tiles.
 *
 *  Deliberately NOT a reuse of kiosk-widgets.tsx's LightsWidget: that one is
 *  still the right thing inside the rotating band or full mode's list (wide
 *  tiles, wrapping grid), and this is a corner control that has to hold the
 *  same 56px touch floor and visual language as KioskTimersButton next to it.
 *  Same `useKioskHa()` hook and the same optimistic `runAction` either way, so
 *  there is one source of truth for the state and only the shape differs.
 *
 *  Truncates rather than wraps: the cluster is one row pinned to a corner, and
 *  a second row would grow UP into the centre column's bottom edge — the exact
 *  overlap the move out of that column was meant to end. A house with more
 *  lights than fit gets them cut off here and keeps the full set on the
 *  `lights` band widget, which is what that widget is for. */
function GlanceLights() {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;
  const lights = useMemo(() => entities?.lights.filter((l) => l.available) ?? [], [entities]);
  if (lights.length === 0) return null;

  return (
    <>
      {lights.map((l) => {
        const pending = ha.isPending(l.entityId);
        return (
          <button
            key={l.entityId}
            type="button"
            disabled={pending}
            aria-pressed={l.on}
            aria-label={`${l.on ? "Turn off" : "Turn on"} ${l.name}`}
            onClick={() => void ha.runAction({ entityId: l.entityId, action: "toggle" })}
            className={cn(
              // kiosk-press replaces active:scale-[0.98] + the bare
              // `transition` utility (see globals.css's KIOSK MOTION
              // VOCABULARY) — `.kiosk-press` already transitions
              // background-color/border-color/color, which is all this
              // pill's own hover/on-state swap touches.
              "flex h-14 min-w-0 shrink items-center gap-1.5 rounded-md border px-3 text-xs outline-none kiosk-press focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none",
              l.on
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line text-ink-dim hover:border-line-bright hover:bg-panel-2 hover:text-ink",
              pending && "opacity-60",
            )}
          >
            <Lightbulb size={15} className="shrink-0" aria-hidden />
            <span className="truncate">{l.name}</span>
          </button>
        );
      })}
    </>
  );
}

/* ── the glance-only content ────────────────────────────────────────────── */

export function KioskGlance({
  period,
  onAdminClick,
  onDoorbellClick,
}: {
  period: KioskPeriod;
  onAdminClick: () => void;
  /** Threaded through to the optional "doorbell" widget only — see
   *  kiosk-widgets.tsx's KioskWidgetCtx. Full mode already has its own,
   *  always-present doorbell button in the header; glance has none by
   *  default, so this only matters if someone adds that widget deliberately. */
  onDoorbellClick: () => void;
}) {
  const ctx: Omit<KioskWidgetCtx, "reportEmpty"> = useMemo(
    () => ({ period, onDoorbellClick }),
    [period, onDoorbellClick],
  );

  return (
    <>
      {/* The rotating carousel moved UP into the forecast band (see
          kiosk-surface.tsx's shared FLIP node) — the owner wanted the wide
          band to be what rotates, not a second pane area stacked under the
          clock. What stays here is glance's own quiet content: the weather
          sentence, the morning briefing, and the light/scene controls.

          These are rendered as a fixed stack rather than a second carousel on
          purpose. A control that rotates away mid-reach is hostile — you go to
          press the floodlight and the pane has moved — so the things you TOUCH
          stay put, and only the things you READ rotate. */}
      {BELOW_BAND_WIDGETS.map((id) => {
        const def = KIOSK_WIDGET_MAP.get(id);
        if (!def) return null;
        /* On a SHORT viewport the two sentences are the first thing to go.
           Glance is a fixed-height box now, so anything that doesn't fit is
           clipped rather than scrolled to — and measured at 800x480 the
           floodlight tile landed at y=513 against a 480px viewport, i.e. a
           control you could no longer reach at all. Dropping the prose first
           buys back exactly the room the controls need, and costs least:
           the band directly above is already showing the weather and the
           news, so these two lines are the most redundant thing on screen. */
        const dropsWhenShort = INFORMATIONAL_WIDGETS.has(id);
        return (
          <div key={id} className={cn(dropsWhenShort && "[@media(max-height:700px)]:hidden")}>
            {def.render(ctx)}
          </div>
        );
      })}

      {/* `fixed` escapes KioskThemeScope's safe-area padding (kiosk-theme.tsx
          applies env(safe-area-inset-*) as padding on an ancestor div, which
          only affects in-flow descendants) — bake the inset into each
          button's own offset instead, or an iPad's home indicator can sit
          on top of them. */}
      {/* The bottom-left CLUSTER: timers plus every light (see GlanceLights).
          One row, `max-w` capped at half the viewport so it can never grow
          under the Admin button in the opposite corner. */}
      <div
        className="fixed flex max-w-[calc(50vw-2rem)] items-center gap-3"
        style={{
          bottom: "calc(1rem + env(safe-area-inset-bottom))",
          left: "calc(1.25rem + env(safe-area-inset-left))",
        }}
        // KioskTimersButton lives in kiosk-timers.tsx (not owned here), so the
        // opt-out from the root promoter is applied on this wrapping div
        // instead of inside that component — same rule as the tiles above:
        // in glance, a control's own press is consumed by the control; only
        // dead space promotes the view. GlanceLights is covered by the same
        // wrapper for the same reason: tapping the floodlight must toggle the
        // floodlight, not also expand the surface underneath it.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <KioskTimersButton className="h-14" />
        <GlanceLights />
      </div>
      <button
        type="button"
        /* Admin DOES opt out, and it has to — this is not a style choice.
           An earlier version let the press reach the root handler on the
           reasoning that promoting to full underneath the PIN pad is
           harmless. It is no longer merely harmless, it is fatal to the
           button: the root's pointerdown flips the mode, and on that same
           commit kiosk-surface.tsx makes the OUTGOING glance block
           `absolute pointer-events-none` (the fix for the glance⇄full
           jitter). The block therefore stops accepting pointer events
           between this button's own pointerdown and its click, the click
           never dispatches, and the pad never opens — measured on
           production: mode went glance→full with no dialog.

           Stopping propagation costs nothing, because entering elevation
           pins the surface to full anyway (`pinned` in kiosk-surface.tsx),
           so the promotion this used to rely on arrives a moment later by
           a route that cannot swallow the click. */
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onAdminClick();
        }}
        style={{
          bottom: "calc(1rem + env(safe-area-inset-bottom))",
          right: "calc(1.25rem + env(safe-area-inset-right))",
        }}
        // h-14 to match the wall-layout's 56px convention (Glance is the
        // default surface on a fresh device now, so its own chrome should
        // hold the same touch floor as everything else). ink-faint measures
        // below the 4.5:1 AA floor on Glance's panel-less ground in 7/16
        // themes — this is an interactive control, not a caption, so it
        // gets ink-dim regardless of where ink-faint itself ends up landing.
        //
        // ADDITION, not a conversion: this was the only kiosk control with no
        // press feedback at all — a 56px control on the primary resting
        // surface with zero response to touch. `kiosk-press` (see globals.css's
        // KIOSK MOTION VOCABULARY) is new here, and the bare `transition`
        // utility that used to carry the hover colour swap is dropped for the
        // same reason as every converted site: `.kiosk-press` already
        // transitions background-color/color, so a second, layered
        // `transition` utility would have been inert dead weight underneath it.
        className="fixed h-14 px-4 rounded-md text-xs text-ink-dim outline-none kiosk-press hover:text-ink hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent"
      >
        Admin
      </button>
    </>
  );
}
