"use client";

import { Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentButton } from "@/components/ui/segment-button";
import type { HaClimate, HaEntities } from "@/lib/ha-types";
import type { UseHaResult } from "@/lib/use-ha";

/** Degrees per tap. Half-degree steps match roundHalf() on the server, so a
 *  tap always lands on the same number the API will actually accept. */
const NUDGE_STEP = 0.5;

const HVAC_LABEL: Record<string, string> = {
  off: "Off",
  heat: "Heat",
  cool: "Cool",
  heat_cool: "Range",
  auto: "Auto",
  dry: "Dry",
  fan_only: "Fan",
};

function formatTemp(v: number | null, unit: string | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}°${unit ?? ""}`;
}

export function HaClimatePanel({
  ha,
  climates,
  entities,
}: {
  ha: UseHaResult;
  climates: HaClimate[];
  entities: HaEntities;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Thermometer size={13} className="text-ink-faint" aria-hidden />
        <span className="microlabel">Climate</span>
      </div>

      {climates.length === 0 ? (
        <p className="text-xs text-ink-faint">No climate entities exposed by Home Assistant.</p>
      ) : (
        <div className="divide-y divide-line/50">
          {climates.map((c) => (
            <HaClimateRow key={c.entityId} climate={c} ha={ha} entities={entities} />
          ))}
        </div>
      )}
    </section>
  );
}

function HaClimateRow({
  climate,
  ha,
  entities,
}: {
  climate: HaClimate;
  ha: UseHaResult;
  entities: HaEntities;
}) {
  const error = ha.actionErrors[climate.entityId];
  const dualSetpoint = climate.targetTempLow != null && climate.targetTempHigh != null;
  const nudgeable = climate.available && (climate.targetTemp != null || dualSetpoint);

  const setMode = (mode: string) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => (c.entityId === climate.entityId ? { ...c, hvacMode: mode } : c)),
    };
    void ha.runAction({ entityId: climate.entityId, action: "set_hvac_mode", hvacMode: mode }, next);
  };

  const nudge = (delta: number) => {
    const next: HaEntities = {
      ...entities,
      climates: entities.climates.map((c) => {
        if (c.entityId !== climate.entityId) return c;
        if (dualSetpoint) {
          return {
            ...c,
            targetTempLow: c.targetTempLow != null ? c.targetTempLow + delta : c.targetTempLow,
            targetTempHigh: c.targetTempHigh != null ? c.targetTempHigh + delta : c.targetTempHigh,
          };
        }
        return { ...c, targetTemp: c.targetTemp != null ? c.targetTemp + delta : c.targetTemp };
      }),
    };
    void ha.runAction({ entityId: climate.entityId, action: "nudge_temp", delta }, next);
  };

  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-ink">{climate.name}</span>
        {!climate.available && <span className="microlabel !text-warn">unavailable</span>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <div className="microlabel">Current</div>
          <div className="mt-0.5 font-mono text-base text-ink">{formatTemp(climate.currentTemp, climate.unit)}</div>
        </div>
        <div>
          <div className="microlabel">Target</div>
          <div className="mt-0.5 font-mono text-base text-accent">
            {dualSetpoint
              ? `${formatTemp(climate.targetTempLow, climate.unit)} – ${formatTemp(climate.targetTempHigh, climate.unit)}`
              : formatTemp(climate.targetTemp, climate.unit)}
          </div>
        </div>

        {nudgeable && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="icon"
              variant="outline"
              onClick={() => nudge(-NUDGE_STEP)}
              aria-label={`Lower target temperature for ${climate.name}`}
            >
              −
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => nudge(NUDGE_STEP)}
              aria-label={`Raise target temperature for ${climate.name}`}
            >
              +
            </Button>
          </div>
        )}
      </div>

      {climate.hvacModes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`${climate.name} mode`}>
          {climate.hvacModes.map((mode) => (
            <SegmentButton
              key={mode}
              active={climate.hvacMode === mode}
              onClick={() => setMode(mode)}
              label={`Set ${climate.name} to ${HVAC_LABEL[mode] ?? mode} mode`}
            >
              {HVAC_LABEL[mode] ?? mode}
            </SegmentButton>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-2 flex items-start gap-2 text-[0.7rem] text-bad">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => ha.dismissActionError(climate.entityId)}
            aria-label="Dismiss error"
            // DESIGN.md's 44px Rule: this control had no size class at all, so
            // it rendered at content size (~18px). min-h-11 md:min-h-0 is the
            // idiom this app already uses for inline text dismiss buttons
            // (reclaim-shared.tsx, log-console.tsx) — height only, since the
            // control sits beside wrapping error text rather than in its own row.
            className="inline-flex items-center shrink-0 rounded px-1 min-h-11 md:min-h-0 text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
