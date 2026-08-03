"use client";

/* THESIS: the glance-only remainder of the old "Glance Board" layout. Since
   redesign-06 §5 merges Glance and Standard into one surface, the clock,
   the current-temperature reading and the server/health line all moved out
   of this file into kiosk-surface.tsx's shared header — those three are
   FLIP shared elements (same DOM node in both modes, see that file's
   structural-rule comment), and this component only ever renders while the
   surface is in glance mode, so it can't own a node that has to survive
   into full mode too. What's left here is genuinely glance-exclusive: the
   weather-outlook sentence, the morning briefing line, the four auto-picked
   control tiles, and the two fixed corner buttons — content that fades out
   entirely (never travels) when the surface flips to full.

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
import { cn } from "@/lib/utils";
import { useWeatherView, useKioskBriefing, type KioskPeriod } from "@/components/kiosk-display";
import { useKioskHa } from "@/components/kiosk-hub";
import { KioskTimersButton } from "@/components/kiosk-timers";

/* ── the quiet sentences ─────────────────────────────────────────────────── */

function weatherSentence(period: KioskPeriod, view: ReturnType<typeof useWeatherView>): string | null {
  const ok = view.ok;
  if (!ok) return view.status === "unreachable-empty" ? "weather unreachable" : null;
  const today = ok.days[0];
  const tomorrow = ok.days[1];
  if (period === "evening" && tomorrow) {
    return `tomorrow ${tomorrow.label.toLowerCase()} ${Math.round(tomorrow.maxC)}° · rain ${tomorrow.rainPct}%`;
  }
  if (!today) return null;
  return `high ${Math.round(today.maxC)}° low ${Math.round(today.minC)}° · rain ${today.rainPct}%`;
}

/* ── auto-picked control tiles ──────────────────────────────────────────── */

const TILE_COUNT = 4;

/** Four entities chosen by time of day: evenings reach for scenes first
 *  (movie night, wind-down), mornings/days for lights. Deterministic — same
 *  hour, same four tiles — so the wall display never reshuffles underfoot. */
function GlanceTiles({ period }: { period: KioskPeriod }) {
  const ha = useKioskHa();
  const entities = ha.data?.status === "ok" ? ha.data.entities : null;

  const picks = useMemo(() => {
    if (!entities) return [];
    const scenes = entities.scenes
      .filter((s) => s.available)
      .map((s) => ({ key: s.entityId, name: s.name, kind: "scene" as const, on: false }));
    const lights = entities.lights
      .filter((l) => l.available)
      .map((l) => ({ key: l.entityId, name: l.name, kind: "light" as const, on: l.on }));
    const switches = entities.switches
      .filter((s) => s.available)
      .map((s) => ({ key: s.entityId, name: s.name, kind: "switch" as const, on: s.on }));
    const ordered = period === "evening" ? [...scenes, ...lights, ...switches] : [...lights, ...scenes, ...switches];
    return ordered.slice(0, TILE_COUNT);
  }, [entities, period]);

  // HA not connected (or nothing usable): render nothing. The standard
  // layout owns the explanatory empty state — a wall clock doesn't nag.
  if (picks.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {picks.map((p) => {
        const pending = ha.isPending(p.key);
        return (
          <button
            key={p.key}
            type="button"
            disabled={pending}
            onClick={() => {
              if (p.kind === "scene") {
                void ha.runAction({ entityId: p.key, action: "activate_scene" });
              } else {
                void ha.runAction({ entityId: p.key, action: "toggle" });
              }
            }}
            className={cn(
              "min-h-16 min-w-32 max-w-48 rounded-tile border px-4 py-3 text-sm outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98]",
              p.on
                ? "border-accent/40 bg-accent/10 text-ink"
                : "border-line bg-transparent text-ink-dim hover:border-line-bright hover:text-ink",
              pending && "opacity-60",
            )}
          >
            {/* An auto-picked HA entity name has no length contract, same
                risk as the hub's tiles (kiosk-hub.tsx ToggleTile/SceneTile).
                This button isn't a flex/grid cell with a track width to lean
                on, so `truncate` needs its own bound — max-w-48 above plays
                the role min-w-0 plays there. */}
            <span className="block truncate">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── the glance-only content ────────────────────────────────────────────── */

export function KioskGlance({
  period,
  onAdminClick,
}: {
  period: KioskPeriod;
  onAdminClick: () => void;
}) {
  const weather = useWeatherView();
  const briefing = useKioskBriefing(period === "morning");

  const wLine = weatherSentence(period, weather);
  const digest = briefing.data?.status === "ok" ? briefing.data.digest : undefined;
  const digestAttention = Boolean(digest && digest.actionNeeded && digest.actionNeeded.toLowerCase() !== "no");

  return (
    <>
      <div className="flex flex-col items-center gap-2 text-base text-ink-dim">
        {wLine && <p>{wLine}</p>}
        {period === "morning" && digest && (
          <p className={cn("max-w-xl", digestAttention ? "text-warn" : "text-ink-dim")}>
            briefing: {digest.headline.replace(/\.$/, "")}
            {digestAttention && ` — ${digest.actionNeeded.replace(/^yes\s*[—-]?\s*/i, "")}`}
          </p>
        )}
      </div>

      <GlanceTiles period={period} />

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
      >
        <KioskTimersButton className="h-14" />
      </div>
      <button
        type="button"
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
