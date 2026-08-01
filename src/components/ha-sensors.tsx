import { BatteryFull, Droplets, Thermometer } from "lucide-react";
import type { HaSensor, HaSensorKind } from "@/lib/ha-types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<HaSensorKind, typeof Thermometer> = {
  temperature: Thermometer,
  humidity: Droplets,
  battery: BatteryFull,
};

function formatSensor(s: HaSensor): string {
  if (s.value == null) return "—";
  const digits = s.kind === "battery" ? 0 : 1;
  return `${s.value.toFixed(digits)}${s.unit ? ` ${s.unit}` : ""}`;
}

/**
 * Battery is the one sensor kind here with a real, universal threshold — a
 * device that stops reporting because it ran flat is a genuinely different
 * fact from "23.4°C", so it earns colour per the Threshold Rule. Temperature
 * and humidity get no such treatment: this panel has no context for what a
 * given reading should be, and inventing a threshold would be a feeling, not
 * a limit.
 */
function batteryTone(s: HaSensor): string {
  if (s.kind !== "battery" || s.value == null) return "text-ink";
  if (s.value <= 10) return "text-bad";
  if (s.value <= 20) return "text-warn";
  return "text-ink";
}

/** Read-only by design (see the feature's §4 spec) — no controls, ever. */
export function HaSensorsPanel({ sensors }: { sensors: HaSensor[] }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Thermometer size={13} className="text-ink-faint" aria-hidden />
        <span className="microlabel">Sensors</span>
      </div>

      {sensors.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No temperature, humidity or battery sensors exposed by Home Assistant.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {sensors.map((s) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <div key={s.entityId} className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon size={11} className="shrink-0 text-ink-faint" aria-hidden />
                  <span className="microlabel truncate" title={s.name}>
                    {s.name}
                  </span>
                </div>
                <div className={cn("mt-0.5 font-mono text-xs", s.available ? batteryTone(s) : "text-ink-faint")}>
                  {s.available ? formatSensor(s) : "unavailable"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
