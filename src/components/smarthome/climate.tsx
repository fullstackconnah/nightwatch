"use client";

import { Button } from "@/components/ui/button";
import { SegmentButton } from "@/components/ui/segment-button";
import { RowError, useBusy } from "@/components/smarthome/shared";
import { acWrites } from "@/lib/smarthome/page-model";
import type { HaClimate, HaEntities } from "@/lib/types/ha";
import type { UseHaResult } from "@/lib/use-ha";

/** Half-degree steps match roundHalf() on the server, so a tap lands on a number the API accepts. */
const NUDGE_STEP = 0.5;
const HVAC_LABEL: Record<string, string> = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Range", auto: "Auto", dry: "Dry", fan_only: "Fan" };
const temp = (v: number | null, unit: string | null) => (v == null ? "—" : `${v.toFixed(1)}°${unit ?? ""}`);

export function ClimateDetail({ ha, climates, entities, stale }: { ha: UseHaResult; climates: HaClimate[]; entities: HaEntities; stale: boolean }) {
  if (climates.length === 0) return <p className="st-note">Home Assistant shares no climate devices.</p>;
  return (
    <div className="divide-y divide-line/50">
      {climates.map((c) => (
        <ClimateRow key={c.entityId} climate={c} ha={ha} entities={entities} stale={stale} />
      ))}
    </div>
  );
}

function ClimateRow({ climate, ha, entities, stale }: { climate: HaClimate; ha: UseHaResult; entities: HaEntities; stale: boolean }) {
  const { busy, run } = useBusy();
  const can = acWrites(climate, stale);
  const dual = climate.targetTempLow != null && climate.targetTempHigh != null;
  const patch = (fn: (c: HaClimate) => HaClimate): HaEntities => ({
    ...entities,
    climates: entities.climates.map((c) => (c.entityId === climate.entityId ? fn(c) : c)),
  });
  const setMode = (mode: string) =>
    run(() => ha.runAction({ entityId: climate.entityId, action: "set_hvac_mode", hvacMode: mode }, patch((c) => ({ ...c, hvacMode: mode }))));
  const nudge = (delta: number) =>
    run(() =>
      ha.runAction(
        { entityId: climate.entityId, action: "nudge_temp", delta },
        patch((c) =>
          dual
            ? { ...c, targetTempLow: c.targetTempLow! + delta, targetTempHigh: c.targetTempHigh! + delta }
            : { ...c, targetTemp: c.targetTemp != null ? c.targetTemp + delta : c.targetTemp },
        ),
      ),
    );

  return (
    <div className="py-3.5 first:pt-0 last:pb-0" data-entity={climate.entityId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-ink">{climate.name}</span>
        {!climate.available && <span className="microlabel !text-warn">not answering</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <div className="microlabel">Current</div>
          <div className="mt-0.5 font-mono text-base text-ink">{temp(climate.currentTemp, climate.unit)}</div>
        </div>
        <div>
          <div className="microlabel">Target</div>
          <div className="mt-0.5 font-mono text-base text-accent">
            {dual ? `${temp(climate.targetTempLow, climate.unit)} – ${temp(climate.targetTempHigh, climate.unit)}` : temp(climate.targetTemp, climate.unit)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="icon" variant="outline" disabled={!can.nudge || busy} onClick={() => void nudge(-NUDGE_STEP)} aria-label={`Lower target temperature for ${climate.name}`}>
            −
          </Button>
          <Button size="icon" variant="outline" disabled={!can.nudge || busy} onClick={() => void nudge(NUDGE_STEP)} aria-label={`Raise target temperature for ${climate.name}`}>
            +
          </Button>
        </div>
      </div>
      {climate.hvacModes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`${climate.name} mode`}>
          {climate.hvacModes.map((mode) => (
            <SegmentButton
              key={mode}
              active={climate.hvacMode === mode}
              disabled={!can.mode || busy}
              onClick={() => void setMode(mode)}
              label={`Set ${climate.name} to ${HVAC_LABEL[mode] ?? mode} mode`}
            >
              {HVAC_LABEL[mode] ?? mode}
            </SegmentButton>
          ))}
        </div>
      )}
      <RowError ha={ha} entityId={climate.entityId} what={`change ${climate.name}`} />
    </div>
  );
}
