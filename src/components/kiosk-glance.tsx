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
   now owned by the widget registry (kiosk-widgets.tsx) and rendered through
   <KioskCarousel/> as `layout.glance`, reorderable from the Widgets tab
   (kiosk-appearance.tsx) — this file's own remaining job is the carousel's
   placement and the two fixed corner buttons, which stay OUTSIDE the widget
   system on purpose (see KioskCarousel's own render call below).

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
import { KioskCarousel } from "@/components/kiosk-carousel";
import { useKioskWidgetLayout, type KioskWidgetCtx } from "@/lib/kiosk-widgets";
import { type KioskPeriod } from "@/components/kiosk-display";
import { KioskTimersButton } from "@/components/kiosk-timers";

/* ── the glance-only content ────────────────────────────────────────────── */

export function KioskGlance({
  period,
  onAdminClick,
  onDoorbellClick,
  onInteraction,
}: {
  period: KioskPeriod;
  onAdminClick: () => void;
  /** Threaded through to the optional "doorbell" widget only — see
   *  kiosk-widgets.tsx's KioskWidgetCtx. Full mode already has its own,
   *  always-present doorbell button in the header; glance has none by
   *  default, so this only matters if someone adds that widget deliberately. */
  onDoorbellClick: () => void;
  /** The same promotion kiosk-surface.tsx's root pointerdown handler
   *  performs on its own — handed to the carousel so it can replay it for a
   *  confirmed tap on dead space without letting a swipe trigger it too
   *  early. See kiosk-carousel.tsx's THESIS for why this can't just be
   *  "stop the pointerdown, let it bubble later." */
  onInteraction: () => void;
}) {
  const layout = useKioskWidgetLayout();
  const ctx: Omit<KioskWidgetCtx, "reportEmpty"> = useMemo(
    () => ({ period, onDoorbellClick }),
    [period, onDoorbellClick],
  );

  return (
    <>
      <KioskCarousel widgetIds={layout.glance} ctx={ctx} onInteraction={onInteraction} />

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
        // Admin does NOT opt out: unlike the tiles/timers button, pressing it
        // is meant to both promote to full (elevation pins the surface there
        // anyway, see the file header comment) and open the PIN pad — there's
        // no in-place action to protect from the promotion, so letting the
        // press reach the root handler is harmless and one fewer special
        // case to maintain.
        onClick={onAdminClick}
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
