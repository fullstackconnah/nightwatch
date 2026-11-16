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
   the clock to be what cycles — forecast, sun-air, news, climate, containers — rather
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIOSK_WIDGET_MAP, type KioskWidgetCtx, type KioskWidgetId } from "@/lib/kiosk-widgets";
import { type KioskPeriod } from "@/components/kiosk/kiosk-display";
import { BinNightLine } from "@/components/kiosk/kiosk-bins";
import { KioskTimersButton } from "@/components/kiosk/kiosk-timers";
import { useKioskHa } from "@/components/kiosk/kiosk-hub";
import { fitChips, foldedOn } from "@/components/kiosk/glance-fit";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { useKioskFonts } from "@/lib/kiosk-fonts";

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

/** One chip's classes, shared by every light chip and the "+n" chip so they cannot drift apart (h-14 is the 56 px touch floor). */
const GLANCE_CHIP =
  // kiosk-press replaces active:scale-[0.98] + the bare `transition` utility (see globals.css's KIOSK MOTION VOCABULARY).
  // shrink-0 + max-w-40: a chip keeps its natural width (so fitChips can measure it) and a long name ends in an ellipsis.
  "flex h-14 max-w-40 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs outline-none kiosk-press focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none";
const CHIP_OFF = "border-line text-ink-dim hover:border-line-bright hover:bg-panel-2 hover:text-ink";
const CLUSTER_GAP = 12; // gap-3
const MORE_W = 56; // the "+n" chip is a w-14 square

/** The bottom-left cluster: the timers button plus every available Home Assistant light, as compact chips.
 *
 *  Deliberately NOT a reuse of kiosk-widgets.tsx's LightsWidget (wide wrapping tiles for the band and full mode); this is a
 *  corner control holding the same 56 px floor as KioskTimersButton beside it. Same `useKioskHa()` and optimistic `runAction`.
 *
 *  One row, and it never runs under the centred scene chips: the chips that do not fit between the cluster's left edge and the
 *  nearest scene chip on its row fold into one "+n" chip, which opens the Full view (it lists every light). Widths are measured
 *  once per light set in a layout effect (before paint) and cached; a resize only recomputes the count. */
function GlanceCluster({ lifted, onMore }: { lifted: boolean; onMore: () => void }) {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;
  const lights = useMemo(() => entities?.lights.filter((l) => l.available) ?? [], [entities]);
  // The typeface is part of the key: a new face changes every chip's natural width, so it re-measures like a new light set.
  const fontKey = useKioskFonts(useKioskTheme()).sans;
  const key = lights.map((l) => `${l.entityId}:${l.name}`).join("|") + `#${fontKey}`;
  const ref = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [fit, setFit] = useState<{ key: string; k: number } | null>(null);
  const [tick, setTick] = useState(0);
  // A new light set renders every chip once (k = all) so the layout effect can measure it.
  const k = fit && fit.key === key ? fit.k : lights.length;

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener("resize", on);
    // A web font arriving after first paint changes chip widths: drop the fit so every chip renders once and is measured again.
    const refit = () => setFit(null);
    document.fonts.addEventListener("loadingdone", refit);
    return () => {
      window.removeEventListener("resize", on);
      document.fonts.removeEventListener("loadingdone", refit);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || lights.length === 0) return;
    if (!fit || fit.key !== key) {
      widths.current = new Map();
      el.querySelectorAll<HTMLElement>("[data-glance-light]").forEach((c) => widths.current.set(c.dataset.glanceLight ?? "", c.offsetWidth));
    }
    const box = el.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    let right = window.innerWidth / 2 - 2 * rem; // today's cap, the cluster's max-w
    document.querySelectorAll<HTMLElement>('[data-glance-widget="scenes"] button').forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.top < box.bottom && r.bottom > box.top) right = Math.min(right, r.left - CLUSTER_GAP - box.left);
    });
    const timersW = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
    const next = fitChips(lights.map((l) => widths.current.get(l.entityId) ?? 0), right - timersW - CLUSTER_GAP, CLUSTER_GAP, MORE_W);
    setFit((f) => (f && f.key === key && f.k === next ? f : { key, k: next }));
  }, [key, entities, lifted, tick, fit, lights]);

  const foldOn = foldedOn(lights, k);
  const foldOnTone = foldOn > 0 ? "border-accent/40 bg-accent/10 text-accent" : CHIP_OFF;

  return (
    <div
      ref={ref}
      data-rain-zone="tiles"
      /* Below 641px it takes the same lifted row as the alert and downloads cluster (kiosk-surface.tsx), because the
         now-playing pill is centred and near full width there; while the pill plays, `data-lifted` lifts it at every width (a variant, so it beats the base row). */
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-[calc(1.25rem+env(safe-area-inset-left))] flex max-w-[calc(50vw-2rem)] items-center gap-3 max-[640px]:bottom-[calc(5.25rem+env(safe-area-inset-bottom))] data-[lifted]:bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
      data-lifted={lifted || undefined}
      // KioskTimersButton lives in kiosk-timers.tsx (not owned here), so the opt-out from the root promoter is applied on this
      // wrapping div: a control's own press is consumed by the control; only dead space promotes the view. The "+n" chip calls
      // onMore itself for the same reason.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <KioskTimersButton className="h-14" />
      {lights.slice(0, k).map((l) => {
        const pending = ha.isPending(l.entityId);
        return (
          <button
            key={l.entityId}
            type="button"
            data-glance-light={l.entityId}
            disabled={pending}
            aria-pressed={l.on}
            aria-label={`${l.on ? "Turn off" : "Turn on"} ${l.name}`}
            onClick={() => void ha.runAction({ entityId: l.entityId, action: "toggle" })}
            className={cn(GLANCE_CHIP, l.on ? "border-accent/40 bg-accent/10 text-accent" : CHIP_OFF, pending && "opacity-60")}
          >
            <Lightbulb size={15} className="shrink-0" aria-hidden />
            <span className="truncate">{l.name}</span>
          </button>
        );
      })}
      {k < lights.length && (
        <button
          type="button"
          aria-label={`Show all ${lights.length} lights${foldOn > 0 ? `, ${foldOn} on` : ""}`}
          onClick={() => onMore()}
          className={cn(GLANCE_CHIP, "w-14 justify-center px-0", foldOnTone)}
        >
          +{lights.length - k}
        </button>
      )}
    </div>
  );
}

/* ── the glance-only content ────────────────────────────────────────────── */

export function KioskGlance({
  period,
  onDoorbellClick,
  lifted,
  onMore,
}: {
  period: KioskPeriod;
  /** Threaded through to the optional "doorbell" widget only — see
   *  kiosk-widgets.tsx's KioskWidgetCtx. Full mode already has its own,
   *  always-present doorbell button in the header; glance has none by
   *  default, so this only matters if someone adds that widget deliberately. */
  onDoorbellClick: () => void;
  /** The now-playing pill is on screen: the bottom-left cluster lifts above it at every width. */
  lifted: boolean;
  /** The "+n" chip's destination: the surface's promote-to-Full handler (Full lists every light). */
  onMore: () => void;
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
      {/* Bin night leads the stack (priority bin > briefing > outlook). It shows only on the evening before a collection,
          when the briefing (morning only) is absent, so the stack holds at most two prose lines; it renders no wrapper at all otherwise. */}
      <BinNightLine period={period} />
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
          <div
            key={id}
            data-glance-widget={id}
            // Every widget in this centre column, prose or control (scenes), shares one rain-mask zone (same-named rects union).
            data-rain-zone="sentence"
            data-lifted={(lifted && id === "scenes") || undefined}
            className={cn(
              dropsWhenShort && "[@media(max-height:700px)]:hidden",
              // While the pill plays the scene row joins the lifted band: fixed, centred, above the pill by a band (5.25rem) and, below 641px,
              // above the cluster row too (cluster 5.25rem + 3.5rem chip + 0.75rem gap). The strip passes pointer events through to its chips.
              lifted && id === "scenes" &&
                "fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] flex justify-center px-6 pointer-events-none *:pointer-events-auto max-[640px]:bottom-[calc(9.5rem+env(safe-area-inset-bottom))]",
            )}
          >
            {def.render(ctx)}
          </div>
        );
      })}
      {/* `fixed` escapes KioskThemeScope's safe-area padding (the inset is baked into the cluster's own offset) and sits last. */}
      <GlanceCluster lifted={lifted} onMore={onMore} />
    </>
  );
}
