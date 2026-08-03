"use client";

import { Power } from "lucide-react";
import { HaSwitchControl } from "@/components/ha-toggle";
import type { HaEntities, HaSwitch } from "@/lib/ha-types";
import type { UseHaResult } from "@/lib/use-ha";

export function HaSwitchesPanel({
  ha,
  switches,
  entities,
}: {
  ha: UseHaResult;
  switches: HaSwitch[];
  entities: HaEntities;
}) {
  const onCount = switches.filter((s) => s.on).length;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Power size={13} className="text-ink-faint" aria-hidden />
          <span className="microlabel">Switches</span>
        </div>
        {switches.length > 0 && (
          <span className="microlabel">
            {onCount} of {switches.length} on
          </span>
        )}
      </div>

      {switches.length === 0 ? (
        <p className="text-xs text-ink-faint">No switches exposed by Home Assistant.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {switches.map((sw) => (
            <HaSwitchRow key={sw.entityId} sw={sw} ha={ha} entities={entities} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HaSwitchRow({ sw, ha, entities }: { sw: HaSwitch; ha: UseHaResult; entities: HaEntities }) {
  const error = ha.actionErrors[sw.entityId];

  const toggle = () => {
    const next: HaEntities = {
      ...entities,
      switches: entities.switches.map((s) => (s.entityId === sw.entityId ? { ...s, on: !s.on } : s)),
    };
    void ha.runAction({ entityId: sw.entityId, action: "toggle" }, next);
  };

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-ink">{sw.name}</div>
          <div className="mt-0.5 font-mono text-[0.7rem] text-ink-faint">
            {!sw.available ? "unavailable" : sw.on ? "on" : "off"}
          </div>
        </div>
        <HaSwitchControl on={sw.on} disabled={!sw.available} onToggle={toggle} label={`Toggle ${sw.name}`} />
      </div>

      {error && (
        <div role="alert" className="mt-1.5 flex items-start gap-2 text-[0.7rem] text-bad">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => ha.dismissActionError(sw.entityId)}
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
    </li>
  );
}
