"use client";

/* THESIS: this page mirrors the same five things a person actually touches on
   a smart-home wall panel — lights, switches, climate, locks — plus a read-only
   sensor strip, in that order, because that's the order of "things I might act
   on" before "things I'm just checking". OWN-WORLD: nightwatch console —
   hairline .panel, teal accent, mono numerals, microlabels; no chart library,
   no raw hex, no colour without a threshold behind it. */

import { useMemo } from "react";
import { useHa } from "@/lib/use-ha";
import { HaLoadError, HaSkeleton, HaUnauthorized, HaUnconfigured, HaUnreachable } from "@/components/ha-status";
import { HaLightsPanel } from "@/components/ha-lights";
import { HaSwitchesPanel } from "@/components/ha-switches";
import { HaClimatePanel } from "@/components/ha-climate";
import { HaLocksPanel } from "@/components/ha-locks";
import { HaSensorsPanel } from "@/components/ha-sensors";
import type { HaEntities } from "@/lib/ha-types";

function countEntities(e: HaEntities): number {
  return e.lights.length + e.switches.length + e.climates.length + e.locks.length + e.sensors.length;
}

export default function SmarthomePage() {
  const ha = useHa();
  const { data, error, isLoading } = ha;

  const count = useMemo(() => (data?.status === "ok" && data.entities ? countEntities(data.entities) : null), [data]);

  return (
    <div className="space-y-5 pb-2">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Home Assistant</h1>
          <p className="mt-0.5 text-xs text-ink-dim">
            {count != null
              ? `${count} ${count === 1 ? "entity" : "entities"} · polling every 3s`
              : "lights, switches, climate and locks mirrored from Home Assistant"}
          </p>
        </div>
        {data?.status === "ok" && (
          <div className="flex items-center gap-2">
            <span className="dot dot-running" aria-hidden />
            <span className="microlabel">connected</span>
          </div>
        )}
      </header>

      {Boolean(error) && !data && <HaLoadError error={error} />}

      {isLoading && !data && <HaSkeleton />}

      {data?.status === "unconfigured" && <HaUnconfigured />}
      {data?.status === "unreachable" && <HaUnreachable detail={data.detail} />}
      {data?.status === "unauthorized" && <HaUnauthorized detail={data.detail} />}

      {data?.status === "ok" && data.entities && (
        <div className="space-y-5">
          <HaLightsPanel ha={ha} lights={data.entities.lights} entities={data.entities} />
          <HaSwitchesPanel ha={ha} switches={data.entities.switches} entities={data.entities} />
          <HaClimatePanel ha={ha} climates={data.entities.climates} entities={data.entities} />
          <HaLocksPanel ha={ha} locks={data.entities.locks} entities={data.entities} />
          <HaSensorsPanel sensors={data.entities.sensors} />
        </div>
      )}
    </div>
  );
}
