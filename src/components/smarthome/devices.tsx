"use client";

import { BatteryFull, Droplets, Thermometer } from "lucide-react";
import { HaSwitchControl } from "@/components/integrations/ha-toggle";
import { RowError, useBusy } from "@/components/smarthome/shared";
import type { HaEntities, HaLight, HaSensor, HaSensorKind, HaSwitch } from "@/lib/types/ha";
import type { UseHaResult } from "@/lib/use-ha";
import { cn } from "@/lib/utils";

interface Common {
  ha: UseHaResult;
  entities: HaEntities;
  /** The model's write switch for this strip (false while the page shows old data or nothing answers). */
  enabled: boolean;
}

/**
 * Brightness renders as a meter, never as a coloured bulb (DESIGN.md's Bent-Colour Rule): the rgb() a light is set to
 * is never read. Magnitude is bar length (`accent-dim`), not hue.
 */
export function LightsDetail({ ha, entities, enabled }: Common) {
  if (entities.lights.length === 0) return <p className="st-note">Home Assistant shares no lights.</p>;
  return (
    <ul className="divide-y divide-line/50">
      {entities.lights.map((l) => (
        <LightRow key={l.entityId} light={l} ha={ha} entities={entities} enabled={enabled} />
      ))}
    </ul>
  );
}

function LightRow({ light, ha, entities, enabled }: Common & { light: HaLight }) {
  const { busy, run } = useBusy();
  const toggle = () =>
    run(() =>
      ha.runAction(
        { entityId: light.entityId, action: "toggle" },
        { ...entities, lights: entities.lights.map((l) => (l.entityId === light.entityId ? { ...l, on: !l.on, brightnessPct: l.on ? null : l.brightnessPct } : l)) },
      ),
    );
  const text = !light.available ? "not answering" : light.on && light.brightnessPct != null ? `${light.brightnessPct}%` : light.on ? "on" : "off";
  return (
    <li className="py-2.5 first:pt-0 last:pb-0" data-entity={light.entityId}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-ink">{light.name}</div>
          <div className="mt-0.5 font-mono text-[0.7rem] text-ink-faint">{text}</div>
        </div>
        {light.on && light.brightnessPct != null && (
          <div className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-panel-2 sm:block">
            <div
              className="h-full w-full origin-left rounded-full bg-accent-dim transition-transform duration-500 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${light.brightnessPct / 100})` }}
            />
          </div>
        )}
        <HaSwitchControl on={light.on} disabled={!enabled || !light.available || busy} onToggle={() => void toggle()} label={`Toggle ${light.name}`} />
      </div>
      <RowError ha={ha} entityId={light.entityId} what={`change ${light.name}`} />
    </li>
  );
}

export function SwitchesDetail({ ha, entities, enabled }: Common) {
  if (entities.switches.length === 0) return <p className="st-note">Home Assistant shares no switches.</p>;
  return (
    <ul className="divide-y divide-line/50">
      {entities.switches.map((s) => (
        <SwitchRow key={s.entityId} sw={s} ha={ha} entities={entities} enabled={enabled} />
      ))}
    </ul>
  );
}

function SwitchRow({ sw, ha, entities, enabled }: Common & { sw: HaSwitch }) {
  const { busy, run } = useBusy();
  const toggle = () =>
    run(() =>
      ha.runAction(
        { entityId: sw.entityId, action: "toggle" },
        { ...entities, switches: entities.switches.map((s) => (s.entityId === sw.entityId ? { ...s, on: !s.on } : s)) },
      ),
    );
  return (
    <li className="py-2.5 first:pt-0 last:pb-0" data-entity={sw.entityId}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-ink">{sw.name}</div>
          <div className="mt-0.5 font-mono text-[0.7rem] text-ink-faint">{!sw.available ? "not answering" : sw.on ? "on" : "off"}</div>
        </div>
        <HaSwitchControl on={sw.on} disabled={!enabled || !sw.available || busy} onToggle={() => void toggle()} label={`Toggle ${sw.name}`} />
      </div>
      <RowError ha={ha} entityId={sw.entityId} what={`change ${sw.name}`} />
    </li>
  );
}

const KIND_ICON: Record<HaSensorKind, typeof Thermometer> = { temperature: Thermometer, humidity: Droplets, battery: BatteryFull };

function reading(s: HaSensor): string {
  if (s.value == null) return "—";
  return `${s.value.toFixed(s.kind === "battery" ? 0 : 1)}${s.unit ? ` ${s.unit}` : ""}`;
}

/** Battery is the one kind with a universal threshold (Threshold Rule); temperature and humidity get no colour. */
function batteryTone(s: HaSensor): string {
  if (s.kind !== "battery" || s.value == null) return "text-ink";
  return s.value <= 10 ? "text-bad" : s.value <= 20 ? "text-warn" : "text-ink";
}

/** Read-only by design: no controls, ever. */
export function SensorsDetail({ sensors }: { sensors: HaSensor[] }) {
  if (sensors.length === 0) return <p className="st-note">Home Assistant shares no temperature, humidity or battery sensors.</p>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {sensors.map((s) => {
        const Icon = KIND_ICON[s.kind];
        return (
          <div key={s.entityId} className="min-w-0" data-entity={s.entityId}>
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon size={11} className="shrink-0 text-ink-faint" aria-hidden />
              <span className="microlabel truncate" title={s.name}>
                {s.name}
              </span>
            </div>
            <div className={cn("mt-0.5 font-mono text-xs", s.available ? batteryTone(s) : "text-ink-faint")}>{s.available ? reading(s) : "not answering"}</div>
          </div>
        );
      })}
    </div>
  );
}
