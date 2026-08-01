"use client";

import { Lightbulb } from "lucide-react";
import { HaSwitchControl } from "@/components/ha-toggle";
import type { HaEntities, HaLight } from "@/lib/ha-types";
import type { UseHaResult } from "@/lib/use-ha";

/**
 * Brightness renders as a meter, never as a coloured bulb — DESIGN.md's
 * Bent-Colour Rule: HA hands back an rgb() a light is set to, and this panel
 * deliberately never reads it. Magnitude is bar length (`accent-dim`, the
 * "flatter working teal" DESIGN.md reserves for volume-style fills), not hue.
 */
export function HaLightsPanel({
  ha,
  lights,
  entities,
}: {
  ha: UseHaResult;
  lights: HaLight[];
  entities: HaEntities;
}) {
  const onCount = lights.filter((l) => l.on).length;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb size={13} className="text-ink-faint" aria-hidden />
          <span className="microlabel">Lights</span>
        </div>
        {lights.length > 0 && (
          <span className="microlabel">
            {onCount} of {lights.length} on
          </span>
        )}
      </div>

      {lights.length === 0 ? (
        <p className="text-xs text-ink-faint">No lights exposed by Home Assistant.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {lights.map((light) => (
            <HaLightRow key={light.entityId} light={light} ha={ha} entities={entities} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HaLightRow({ light, ha, entities }: { light: HaLight; ha: UseHaResult; entities: HaEntities }) {
  const error = ha.actionErrors[light.entityId];

  const toggle = () => {
    const next: HaEntities = {
      ...entities,
      lights: entities.lights.map((l) =>
        l.entityId === light.entityId
          ? { ...l, on: !l.on, brightnessPct: l.on ? null : l.brightnessPct }
          : l,
      ),
    };
    void ha.runAction({ entityId: light.entityId, action: "toggle" }, next);
  };

  const statusText = !light.available
    ? "unavailable"
    : light.on && light.brightnessPct != null
      ? `${light.brightnessPct}%`
      : light.on
        ? "on"
        : "off";

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-ink">{light.name}</div>
          <div className="mt-0.5 font-mono text-[0.7rem] text-ink-faint">{statusText}</div>
        </div>

        {light.on && light.brightnessPct != null && (
          <div className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-panel-2 sm:block">
            <div
              className="h-full rounded-full bg-accent-dim transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${light.brightnessPct}%` }}
            />
          </div>
        )}

        <HaSwitchControl on={light.on} disabled={!light.available} onToggle={toggle} label={`Toggle ${light.name}`} />
      </div>

      {error && (
        <div role="alert" className="mt-1.5 flex items-start gap-2 text-[0.7rem] text-bad">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => ha.dismissActionError(light.entityId)}
            aria-label="Dismiss error"
            className="shrink-0 rounded px-1 text-ink-dim outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent"
          >
            ×
          </button>
        </div>
      )}
    </li>
  );
}
