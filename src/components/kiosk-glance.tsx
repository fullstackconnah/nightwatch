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
import { KIOSK_WIDGET_MAP, type KioskWidgetCtx, type KioskWidgetId } from "@/lib/kiosk-widgets";
import { type KioskPeriod } from "@/components/kiosk-display";
import { KioskTimersButton } from "@/components/kiosk-timers";

/* The fixed, non-rotating stack under the band. Deliberately NOT the
   reorderable layout: `layout.glance` now drives the BAND (kiosk-surface.tsx),
   and these are the controls plus the two quiet sentences that were glance's
   original content before the widget work. Kept as a constant here rather
   than a third persisted screen so the Widgets tab stays a single, honest
   question — "what rotates through the band?" — instead of two lists whose
   difference nobody would remember. */
const BELOW_BAND_WIDGETS: readonly KioskWidgetId[] = ["weather-outlook", "briefing", "lights", "scenes"];

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
        return def ? <div key={id}>{def.render(ctx)}</div> : null;
      })}

      {/* `fixed` escapes KioskThemeScope's safe-area padding (kiosk-theme.tsx
          applies env(safe-area-inset-*) as padding on an ancestor div, which
          only affects in-flow descendants) — bake the inset into each
          button's own offset instead, or an iPad's home indicator can sit
          on top of them. */}
      <div
        className="fixed"
        style={{
          bottom: "calc(1rem + env(safe-area-inset-bottom))",
          left: "calc(1.25rem + env(safe-area-inset-left))",
        }}
        // KioskTimersButton lives in kiosk-timers.tsx (not owned here), so the
        // opt-out from the root promoter is applied on this wrapping div
        // instead of inside that component — same rule as the tiles above:
        // in glance, a control's own press is consumed by the control; only
        // dead space promotes the view.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <KioskTimersButton className="h-14" />
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
        className="fixed h-14 px-4 rounded-md text-xs text-ink-dim outline-none transition hover:text-ink hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent"
      >
        Admin
      </button>
    </>
  );
}
