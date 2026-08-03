"use client";

/* THESIS: the redesigned /kiosk homepage — smart-home controls as the main
   surface, reachable with no PIN (a deliberate owner choice: this is a public
   LAN surface, not the admin one). Home-first means big touch tiles rank
   above read-only detail: Lights, Switches and Scenes get equal-weight tile
   grids because they're all "tap to act"; Climate gets its own card because a
   thermostat carries more state than a tile can show; Sensors is a strip at
   the bottom because it's the one section nobody touches. No locks — the
   owner's call, not an oversight.

   OWN-WORLD: same hairline .panel / mono / microlabel vocabulary the
   ha-*.tsx panels use on /smarthome, resized for touch (56px+ tiles instead
   of 44px rows) and composed fresh against the public /kiosk/api/ha/* contract
   rather than importing those components or lib/use-ha.ts, which point at the
   authenticated /api/ha/* routes.

   POLLING CONTRACT: poll every ~7s; pause while any action POST is in flight
   (a resync landing mid-tap could stomp the optimistic flip with stale data)
   and force an immediate refetch the moment it settles, success or failure,
   so the real state is on screen within one round trip either way. */

import { memo, useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  Battery,
  BatteryFull,
  Droplets,
  House,
  Lightbulb,
  type LucideIcon,
  Sparkles,
  Thermometer,
  ToggleLeft,
} from "lucide-react";
import { ApiError, fetcher, postJson } from "@/lib/client";
import { StaleTag } from "@/components/kiosk-stale-tag";
import type {
  HaActionRequest,
  HaClimate,
  HaEntities,
  HaLight,
  HaScene,
  HaSensor,
  HaSensorKind,
  HaStatesResponse,
  HaSwitch,
} from "@/lib/ha-types";
import { cn } from "@/lib/utils";

const HA_STATES_KEY = "/kiosk/api/ha/states";
const POLL_MS = 7000;
const ERROR_DISMISS_MS = 4000;
const NUDGE_STEP = 0.5;
// color-mix against the live --color-ink-faint token, not a literal rgb —
// see the identical fix (and its rationale) in kiosk-display.tsx's own
// HATCH_PATTERN const. Kept as a duplicate constant rather than a shared
// export: this file composes fresh against its own /kiosk/api/ha/* contract
// by design (see THESIS above) rather than importing from kiosk-display.
const HATCH_PATTERN =
  "repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--color-ink-faint) 14%, transparent) 8px 10px)";

// Touch-first tile grid: 2 columns fits a phone (390px) and an iPad portrait
// (820px) without crowding; the next two steps are custom min-width
// breakpoints (not the standard sm/md scale) chosen to land specifically on
// the iPad landscape sizes this surface targets — 1024x768 wants 3, 1366x1024
// wants 4, and neither is a Tailwind default breakpoint.
const TILE_GRID = "grid grid-cols-2 min-[900px]:grid-cols-3 min-[1200px]:grid-cols-4 gap-3";

const HVAC_LABEL: Record<string, string> = {
  off: "Off",
  heat: "Heat",
  cool: "Cool",
  heat_cool: "Range",
  auto: "Auto",
  dry: "Dry",
  fan_only: "Fan",
};

const SENSOR_ICON: Record<HaSensorKind, LucideIcon> = {
  temperature: Thermometer,
  humidity: Droplets,
  battery: BatteryFull,
};

function formatTemp(v: number | null, unit: string | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}°${unit ?? ""}`;
}

function formatSensor(s: HaSensor): string {
  if (s.value == null) return "—";
  const digits = s.kind === "battery" ? 0 : 1;
  return `${s.value.toFixed(digits)}${s.unit ? ` ${s.unit}` : ""}`;
}

/** Battery is the one sensor kind with a real, universal threshold (a device
 *  that stopped reporting because it went flat is a different fact from a
 *  reading) — see ha-sensors.tsx, which this mirrors for the same reason. */
function batteryTone(s: HaSensor): string {
  if (s.kind !== "battery" || s.value == null) return "text-ink";
  if (s.value <= 10) return "text-bad";
  if (s.value <= 20) return "text-warn";
  return "text-ink";
}

/* ── data + actions ─────────────────────────────────────────────────────── */

interface UseKioskHaResult {
  data: HaStatesResponse | undefined;
  error: unknown;
  isLoading: boolean;
  /** Resolves `true` on success, `false` on failure — callers that need to
   *  react to the outcome (the scene "activated" flash) must use this return
   *  value rather than reading `actionErrors` right after the call, since a
   *  state update made inside `runAction` isn't visible on the caller's own
   *  closure until the next render. */
  runAction: (req: HaActionRequest, optimisticEntities?: HaEntities) => Promise<boolean>;
  actionErrors: Record<string, string>;
  isPending: (entityId: string) => boolean;
}

export function useKioskHa(): UseKioskHaResult {
  const [paused, setPaused] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<HaStatesResponse>(HA_STATES_KEY, fetcher, {
    refreshInterval: paused ? 0 : POLL_MS,
    keepPreviousData: true,
  });

  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const errorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissActionError = useCallback((entityId: string) => {
    const timer = errorTimers.current[entityId];
    if (timer) {
      clearTimeout(timer);
      delete errorTimers.current[entityId];
    }
    setActionErrors((prev) => {
      if (!(entityId in prev)) return prev;
      const next = { ...prev };
      delete next[entityId];
      return next;
    });
  }, []);

  const runAction = useCallback(
    async (req: HaActionRequest, optimisticEntities?: HaEntities) => {
      const previous = data;
      dismissActionError(req.entityId);
      setPendingIds((prev) => new Set(prev).add(req.entityId));

      if (previous?.status === "ok" && optimisticEntities) {
        await mutate({ ...previous, entities: optimisticEntities }, { revalidate: false });
      }

      setPaused(true);
      let ok = true;
      try {
        await postJson("/kiosk/api/ha/action", req);
      } catch (e) {
        ok = false;
        if (previous) await mutate(previous, { revalidate: false });
        const message =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Action failed — try again.";
        setActionErrors((prev) => ({ ...prev, [req.entityId]: message }));
        errorTimers.current[req.entityId] = setTimeout(() => {
          dismissActionError(req.entityId);
        }, ERROR_DISMISS_MS);
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(req.entityId);
          return next;
        });
        setPaused(false);
        void mutate();
      }
      return ok;
    },
    [data, mutate, dismissActionError],
  );

  const isPending = useCallback((entityId: string) => pendingIds.has(entityId), [pendingIds]);

  // SWR's default `compare` (dequal) already keeps `data` referentially
  // stable across content-identical polls — the bug this guards against is
  // this hook wrapping that stable `data` in a fresh object literal on every
  // render regardless. Memoized so the object itself stays stable too;
  // sections below take this whole result as a prop, and without this every
  // render of KioskHub would hand them a brand-new object even when nothing
  // in it changed.
  return useMemo(
    () => ({ data, error, isLoading, runAction, actionErrors, isPending }),
    [data, error, isLoading, runAction, actionErrors, isPending],
  );
}

/* ── shared tile shapes ─────────────────────────────────────────────────── */

function ToggleTile({
  icon: Icon,
  name,
  on,
  available,
  subtitle,
  brightnessPct,
  error,
  onToggle,
}: {
  icon: LucideIcon;
  name: string;
  on: boolean;
  available: boolean;
  subtitle: string;
  brightnessPct?: number | null;
  error?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${name}`}
      disabled={!available}
      onClick={onToggle}
      className={cn(
        "flex min-h-16 flex-col justify-between gap-2 rounded-tile border px-3 py-3 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98]",
        !available && "pointer-events-none opacity-40",
        on ? "border-accent/40 bg-accent/10" : "border-line bg-panel-2 hover:border-line-bright",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon size={16} className={on ? "text-accent" : "text-ink-faint"} aria-hidden />
        <span
          aria-hidden
          className={cn("h-2.5 w-2.5 rounded-full", on ? "dot dot-running" : "bg-line-bright")}
        />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-ink">{name}</div>
        <div className={cn("mt-0.5 truncate font-mono text-2xs", error ? "text-bad" : "text-ink-faint")}>
          {error ?? subtitle}
        </div>
      </div>
      {on && brightnessPct != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
          <div
            className="h-full rounded-full bg-accent-dim transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${brightnessPct}%` }}
          />
        </div>
      )}
    </button>
  );
}

function SceneTile({
  scene,
  activated,
  pending,
  error,
  onActivate,
}: {
  scene: HaScene;
  activated: boolean;
  pending: boolean;
  error?: string;
  onActivate: () => void;
}) {
  const statusText = error ?? (activated ? "activated" : pending ? "activating…" : "tap to activate");
  return (
    <button
      type="button"
      aria-label={`Activate ${scene.name}`}
      disabled={!scene.available || pending}
      onClick={onActivate}
      className={cn(
        "flex min-h-16 flex-col items-start justify-center gap-1.5 rounded-tile border px-3 py-3 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none",
        !scene.available && "opacity-40",
        activated ? "border-accent/50 bg-accent/15" : "border-line bg-panel-2 hover:border-line-bright",
      )}
    >
      <Sparkles size={16} className={activated ? "text-accent" : "text-ink-faint"} aria-hidden />
      <span className="truncate text-xs text-ink">{scene.name}</span>
      <span
        className={cn("font-mono text-2xs", error ? "text-bad" : activated ? "text-accent" : "text-ink-faint")}
      >
        {statusText}
      </span>
    </button>
  );
}

/* ── sections ────────────────────────────────────────────────────────────── */

function SectionHeader({ icon: Icon, label, note }: { icon: LucideIcon; label: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon size={13} className="text-ink-faint" aria-hidden />
        {/* Real heading, not a styled span — the page supplies an <h1>, so
            these five section captions (Lights/Switches/Scenes/Climate/
            Sensors) sit at <h2>. `.microlabel` carries the visuals unchanged;
            Tailwind's preflight zeroes the browser's own h2 margin/size. */}
        <h2 className="microlabel">{label}</h2>
      </div>
      {note && <span className="microlabel">{note}</span>}
    </div>
  );
}

// Wrapped in memo() because `ha`/`entities` now hold a stable identity across
// content-identical 7s polls (see the `compare` option on useKioskHa's SWR
// call and the useMemo on its return) — without memo() here the sections
// would still re-render on every poll despite that stability, since a parent
// re-render always reconciles children unless props are shallow-equal AND
// the component opts in.
const LightsSection = memo(function LightsSection({
  ha,
  lights,
  entities,
}: {
  ha: UseKioskHaResult;
  lights: HaLight[];
  entities: HaEntities;
}) {
  const onCount = lights.filter((l) => l.on).length;
  return (
    <section className="panel p-4">
      <SectionHeader icon={Lightbulb} label="Lights" note={`${onCount} of ${lights.length} on`} />
      <div className={TILE_GRID}>
        {lights.map((light) => {
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
            <ToggleTile
              key={light.entityId}
              icon={Lightbulb}
              name={light.name}
              on={light.on}
              available={light.available}
              subtitle={statusText}
              brightnessPct={light.brightnessPct}
              error={ha.actionErrors[light.entityId]}
              onToggle={toggle}
            />
          );
        })}
      </div>
    </section>
  );
});

const SwitchesSection = memo(function SwitchesSection({
  ha,
  switches,
  entities,
}: {
  ha: UseKioskHaResult;
  switches: HaSwitch[];
  entities: HaEntities;
}) {
  const onCount = switches.filter((s) => s.on).length;
  return (
    <section className="panel p-4">
      <SectionHeader icon={ToggleLeft} label="Switches" note={`${onCount} of ${switches.length} on`} />
      <div className={TILE_GRID}>
        {switches.map((sw) => {
          const toggle = () => {
            const next: HaEntities = {
              ...entities,
              switches: entities.switches.map((s) => (s.entityId === sw.entityId ? { ...s, on: !s.on } : s)),
            };
            void ha.runAction({ entityId: sw.entityId, action: "toggle" }, next);
          };
          return (
            <ToggleTile
              key={sw.entityId}
              icon={ToggleLeft}
              name={sw.name}
              on={sw.on}
              available={sw.available}
              subtitle={!sw.available ? "unavailable" : sw.on ? "on" : "off"}
              error={ha.actionErrors[sw.entityId]}
              onToggle={toggle}
            />
          );
        })}
      </div>
    </section>
  );
});

const ScenesSection = memo(function ScenesSection({ ha, scenes }: { ha: UseKioskHaResult; scenes: HaScene[] }) {
  const [activated, setActivated] = useState<Set<string>>(new Set());
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activate = (scene: HaScene) => {
    const timer = flashTimers.current[scene.entityId];
    if (timer) clearTimeout(timer);
    void ha.runAction({ entityId: scene.entityId, action: "activate_scene" }).then((ok) => {
      if (!ok) return;
      setActivated((prev) => new Set(prev).add(scene.entityId));
      flashTimers.current[scene.entityId] = setTimeout(() => {
        setActivated((prev) => {
          const next = new Set(prev);
          next.delete(scene.entityId);
          return next;
        });
      }, 1200);
    });
  };

  return (
    <section className="panel p-4">
      <SectionHeader icon={Sparkles} label="Scenes" />
      <div className={TILE_GRID}>
        {scenes.map((scene) => (
          <SceneTile
            key={scene.entityId}
            scene={scene}
            activated={activated.has(scene.entityId)}
            pending={ha.isPending(scene.entityId)}
            error={ha.actionErrors[scene.entityId]}
            onActivate={() => activate(scene)}
          />
        ))}
      </div>
    </section>
  );
});

function ClimateCard({
  ha,
  climate,
  entities,
}: {
  ha: UseKioskHaResult;
  climate: HaClimate;
  entities: HaEntities;
}) {
  const error = ha.actionErrors[climate.entityId];
  const pending = ha.isPending(climate.entityId);
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
    <div
      className={cn(
        "rounded-tile border border-line bg-panel-2 p-4",
        !climate.available && "opacity-60",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* min-w-0 on the flex item: flex children default to min-width:auto,
            which lets the name grow to its full content width and never lets
            `truncate` engage — see ToggleTile above for the same pattern. */}
        <div className="min-w-0">
          <div className="truncate text-xs text-ink">{climate.name}</div>
        </div>
        {!climate.available && <span className="microlabel !text-warn">unavailable</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div>
          <div className="microlabel">Current</div>
          <div className="mt-0.5 font-mono text-lg text-ink">{formatTemp(climate.currentTemp, climate.unit)}</div>
        </div>

        {nudgeable && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={`Lower target temperature for ${climate.name}`}
              disabled={pending}
              onClick={() => nudge(-NUDGE_STEP)}
              className="flex h-14 w-14 items-center justify-center rounded-md border border-line font-mono text-lg text-ink-dim outline-none transition hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              −
            </button>
            <div className="text-center">
              <div className="microlabel">Target</div>
              <div className="mt-0.5 font-mono text-lg text-accent">
                {dualSetpoint
                  ? `${formatTemp(climate.targetTempLow, climate.unit)} – ${formatTemp(climate.targetTempHigh, climate.unit)}`
                  : formatTemp(climate.targetTemp, climate.unit)}
              </div>
            </div>
            <button
              type="button"
              aria-label={`Raise target temperature for ${climate.name}`}
              disabled={pending}
              onClick={() => nudge(NUDGE_STEP)}
              className="flex h-14 w-14 items-center justify-center rounded-md border border-line font-mono text-lg text-ink-dim outline-none transition hover:border-line-bright hover:text-ink focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}
      </div>

      {climate.hvacModes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${climate.name} mode`}>
          {climate.hvacModes.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={climate.hvacMode === mode}
              aria-label={`Set ${climate.name} to ${HVAC_LABEL[mode] ?? mode} mode`}
              disabled={pending}
              onClick={() => setMode(mode)}
              className={cn(
                "h-14 min-w-[4.5rem] rounded-md border px-3 text-xs font-medium outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
                climate.hvacMode === mode
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-line text-ink-dim hover:bg-panel hover:text-ink",
              )}
            >
              {HVAC_LABEL[mode] ?? mode}
            </button>
          ))}
        </div>
      )}

      {error && <div className="mt-2 text-2xs text-bad">{error}</div>}
    </div>
  );
}

const ClimateSection = memo(function ClimateSection({
  ha,
  climates,
  entities,
}: {
  ha: UseKioskHaResult;
  climates: HaClimate[];
  entities: HaEntities;
}) {
  return (
    <section className="panel p-4">
      <SectionHeader icon={Thermometer} label="Climate" />
      <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
        {climates.map((c) => (
          <ClimateCard key={c.entityId} ha={ha} climate={c} entities={entities} />
        ))}
      </div>
    </section>
  );
});

const SensorsSection = memo(function SensorsSection({ sensors }: { sensors: HaSensor[] }) {
  return (
    <section className="panel p-4">
      <SectionHeader icon={Battery} label="Sensors" />
      <div className="flex flex-wrap gap-2">
        {sensors.map((s) => {
          const Icon = SENSOR_ICON[s.kind];
          return (
            <div
              key={s.entityId}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2",
                !s.available && "opacity-50",
              )}
            >
              <Icon size={12} className="shrink-0 text-ink-faint" aria-hidden />
              <div className="min-w-0">
                <div className="microlabel max-w-32 truncate" title={s.name}>
                  {s.name}
                </div>
                <div className={cn("font-mono text-xs", s.available ? batteryTone(s) : "text-ink-faint")}>
                  {s.available ? formatSensor(s) : "unavailable"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});

/* ── non-happy states ───────────────────────────────────────────────────── */

function HubSkeleton() {
  const labels: { label: string; icon: LucideIcon }[] = [
    { label: "Lights", icon: Lightbulb },
    { label: "Switches", icon: ToggleLeft },
    { label: "Scenes", icon: Sparkles },
  ];
  return (
    <div className="space-y-4">
      {labels.map(({ label, icon: Icon }, i) => (
        <div key={label} className="panel p-4">
          <SectionHeader icon={Icon} label={label} />
          <div className={TILE_GRID}>
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="min-h-16 animate-pulse rounded-tile bg-panel-2 motion-reduce:animate-none"
                style={{ animationDelay: `${(i * 4 + j) * 60}ms` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HubLoadError({ error }: { error: unknown }) {
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="microlabel !text-bad">load failed</span>
      <p className="text-xs text-ink-dim">
        {error instanceof Error ? error.message : "Could not reach nightwatch's own /kiosk/api/ha/states."}
      </p>
    </div>
  );
}

// Compact by design (impeccable layout assessment 2026-08-03): this state
// once deliberately owned the whole surface, back when the kiosk was only
// strip + hub and everything below it was void. The weather/display band now
// carries the page, so a flex-1 hero of hatch texture was measured eating
// 57-73% of the viewport as dead air. A placeholder should size to its
// sentence; the page's open ground below is the glance-board idiom, not
// emptiness to be papered over.
function HubUnconfigured() {
  return (
    <div role="status" className="panel relative flex flex-wrap items-center gap-3 overflow-hidden px-4 py-3">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HATCH_PATTERN }} />
      <House size={16} className="relative shrink-0 text-ink-faint" aria-hidden />
      <span className="microlabel relative !text-warn">Home Assistant not connected</span>
      <p className="relative text-xs text-ink-dim">Connect it in Settings → Integrations, and your lights, scenes and climate appear here.</p>
    </div>
  );
}

function HubStatusIssue({ kind, detail }: { kind: "unreachable" | "unauthorized"; detail?: string }) {
  const isUnreachable = kind === "unreachable";
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-2 px-4 py-3">
      <span className={cn("dot", isUnreachable ? "dot-dead" : "dot-unhealthy")} aria-hidden />
      <span className={cn("microlabel", isUnreachable ? "!text-bad" : "!text-warn")}>
        Home Assistant {kind}
      </span>
      {detail && <span className="text-xs text-ink-dim">{detail}</span>}
    </div>
  );
}

function HubEmpty() {
  return (
    <div role="status" className="panel relative flex flex-wrap items-center gap-3 overflow-hidden px-4 py-3">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HATCH_PATTERN }} />
      <House size={16} className="relative shrink-0 text-ink-faint" aria-hidden />
      <span className="microlabel relative">Nothing to control yet</span>
      <p className="relative text-xs text-ink-dim">
        Home Assistant is connected but exposes no lights, switches, scenes, climate or sensors.
      </p>
    </div>
  );
}

/* ── hub ─────────────────────────────────────────────────────────────────── */

export function KioskHub() {
  const ha = useKioskHa();
  const { data, error, isLoading } = ha;

  if (isLoading && !data) return <HubSkeleton />;
  if (Boolean(error) && !data) return <HubLoadError error={error} />;
  if (!data) return null;

  // `error` here means the *latest* poll failed while `data` still holds the
  // last successful one (SWR keeps it — see useFreshness in kiosk-client.ts
  // for why that's safe to rely on). Every branch below is drawn from that
  // possibly-old `data`, tiles included — they stay tappable because the
  // server is the source of truth for the action itself, but a stale read is
  // still a stale read and gets marked rather than repainted as current.
  const stale = Boolean(error);

  if (data.status === "unconfigured") return <HubUnconfigured />;
  if (data.status === "unreachable") return <HubStatusIssue kind="unreachable" detail={data.detail} />;
  if (data.status === "unauthorized") return <HubStatusIssue kind="unauthorized" detail={data.detail} />;

  const entities = data.entities;
  if (!entities) return <HubEmpty />;

  const total =
    entities.lights.length +
    entities.switches.length +
    entities.scenes.length +
    entities.climates.length +
    entities.sensors.length;
  if (total === 0) return <HubEmpty />;

  return (
    <div className="space-y-4">
      {stale && (
        <div className="flex items-center gap-2 px-1">
          <StaleTag />
          <span className="text-2xs text-ink-dim">last confirmed state — may not reflect a recent change</span>
        </div>
      )}
      {entities.lights.length > 0 && <LightsSection ha={ha} lights={entities.lights} entities={entities} />}
      {entities.switches.length > 0 && <SwitchesSection ha={ha} switches={entities.switches} entities={entities} />}
      {entities.scenes.length > 0 && <ScenesSection ha={ha} scenes={entities.scenes} />}
      {entities.climates.length > 0 && <ClimateSection ha={ha} climates={entities.climates} entities={entities} />}
      {entities.sensors.length > 0 && <SensorsSection sensors={entities.sensors} />}
    </div>
  );
}
