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
import { KioskClimateRow } from "@/components/kiosk-climate";
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
// color-mix against the live --color-ink-faint token, not a literal rgb —
// see the identical fix (and its rationale) in kiosk-display.tsx's own
// HATCH_PATTERN const. Kept as a duplicate constant rather than a shared
// export: this file composes fresh against its own /kiosk/api/ha/* contract
// by design (see THESIS above) rather than importing from kiosk-display.
const HATCH_PATTERN =
  "repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--color-ink-faint) 14%, transparent) 8px 10px)";

// Compact inline pills, not a tile grid (kiosk-analysis/redesign-06 follow-up,
// 2026-08-03: a 7-switch grid of full-size tiles measured eating ~60% of a
// wall panel's screen — this is a glance-and-act row, not a settings page).
// Auto-width chips wrap onto as many lines as they need at h-14 (56px touch
// floor); the row's total height scales with entity COUNT, not a fixed column
// count, so 1 light + 7 switches costs far less vertical space than the old
// 2-4 column grid did.
const CHIP_ROW = "flex flex-wrap gap-2";

const SENSOR_ICON: Record<HaSensorKind, LucideIcon> = {
  temperature: Thermometer,
  humidity: Droplets,
  battery: BatteryFull,
};

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

// Exported type-only: kiosk-climate.tsx imports this shape rather than
// re-declaring it, so the optimistic-update / rollback contract can't
// silently drift between the hook and its consumer.
export interface UseKioskHaResult {
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

// Chip, not a card: icon · name · state, one line, wraps freely. Rounded-full
// reads as a pill distinct from the square .rounded-tile touch targets
// elsewhere (advanced/nudge buttons), signalling "small toggle" rather than
// "primary control." Still a real 56px (h-14) touch target — density lowers
// footprint, not the touch floor. The brightness fill bar the old tile drew
// is dropped (no room in a pill); the percentage is still readable in
// `subtitle`, which is the reading that mattered, not the animation.
function ToggleChip({
  icon: Icon,
  name,
  on,
  available,
  subtitle,
  error,
  onToggle,
}: {
  icon: LucideIcon;
  name: string;
  on: boolean;
  available: boolean;
  subtitle: string;
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
        "flex h-14 max-w-full shrink-0 items-center gap-2 rounded-full border pl-3 pr-3.5 outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98]",
        !available && "pointer-events-none opacity-40",
        on ? "border-accent/40 bg-accent/10" : "border-line bg-panel-2 hover:border-line-bright",
      )}
    >
      <Icon size={15} className={on ? "text-accent" : "text-ink-faint"} aria-hidden />
      <span className="max-w-28 truncate text-sm text-ink">{name}</span>
      <span className={cn("max-w-24 truncate font-mono text-2xs", error ? "text-bad" : "text-ink-faint")} title={error}>
        {error ?? subtitle}
      </span>
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", on ? "dot dot-running" : "bg-line-bright")} />
    </button>
  );
}

function SceneChip({
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
        "flex h-14 max-w-full shrink-0 items-center gap-2 rounded-full border pl-3 pr-3.5 outline-none transition focus-visible:ring-1 focus-visible:ring-accent active:scale-[0.98] disabled:pointer-events-none",
        !scene.available && "opacity-40",
        activated ? "border-accent/50 bg-accent/15" : "border-line bg-panel-2 hover:border-line-bright",
      )}
    >
      <Sparkles size={15} className={activated ? "text-accent" : "text-ink-faint"} aria-hidden />
      <span className="max-w-28 truncate text-sm text-ink">{scene.name}</span>
      <span className={cn("max-w-28 truncate font-mono text-2xs", error ? "text-bad" : activated ? "text-accent" : "text-ink-faint")}>
        {statusText}
      </span>
    </button>
  );
}

/* ── sections ────────────────────────────────────────────────────────────── */

function SectionHeader({ icon: Icon, label, note }: { icon: LucideIcon; label: string; note?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-2">
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
    // No box: a pure section wrapper, not a touch target or alert (redesign-06
    // §E). A hairline top rule groups it from the section above; the first
    // rendered section (whichever it is, since sections are conditional on
    // data) sits flush with nothing above it via `first:`.
    <section className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <SectionHeader icon={Lightbulb} label="Lights" note={`${onCount} of ${lights.length} on`} />
      <div className={CHIP_ROW}>
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
            <ToggleChip
              key={light.entityId}
              icon={Lightbulb}
              name={light.name}
              on={light.on}
              available={light.available}
              subtitle={statusText}
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
    <section className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <SectionHeader icon={ToggleLeft} label="Switches" note={`${onCount} of ${switches.length} on`} />
      <div className={CHIP_ROW}>
        {switches.map((sw) => {
          const toggle = () => {
            const next: HaEntities = {
              ...entities,
              switches: entities.switches.map((s) => (s.entityId === sw.entityId ? { ...s, on: !s.on } : s)),
            };
            void ha.runAction({ entityId: sw.entityId, action: "toggle" }, next);
          };
          return (
            <ToggleChip
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
    <section className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <SectionHeader icon={Sparkles} label="Scenes" />
      <div className={CHIP_ROW}>
        {scenes.map((scene) => (
          <SceneChip
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
    <section className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <SectionHeader icon={Thermometer} label="Climate" />
      {/* Rows, not cards (redesign-06 §B): a hairline divider between rooms
          rather than each room boxed on its own. The section wrapper itself
          lost its `.panel p-4` box in the density pass (agent E) along with
          every other pure-container section here. */}
      <div className="divide-y divide-line">
        {climates.map((c) => (
          <KioskClimateRow key={c.entityId} ha={ha} climate={c} entities={entities} />
        ))}
      </div>
    </section>
  );
});

const SensorsSection = memo(function SensorsSection({ sensors }: { sensors: HaSensor[] }) {
  return (
    <section className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <SectionHeader icon={Battery} label="Sensors" />
      {/* Read-only readings, no touch target and no alert — the chip box and
          the stacked name/value are both chrome the density pass drops:
          open ground, name and value collapsed onto one line. */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {sensors.map((s) => {
          const Icon = SENSOR_ICON[s.kind];
          return (
            <div key={s.entityId} className={cn("flex items-center gap-2", !s.available && "opacity-50")}>
              <Icon size={13} className="shrink-0 text-ink-faint" aria-hidden />
              <span className="microlabel max-w-32 truncate" title={s.name}>
                {s.name}
              </span>
              <span className={cn("font-mono text-sm", s.available ? batteryTone(s) : "text-ink-faint")}>
                {s.available ? formatSensor(s) : "unavailable"}
              </span>
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
    <div className="space-y-3">
      {labels.map(({ label, icon: Icon }, i) => (
        <div key={label} className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
          <SectionHeader icon={Icon} label={label} />
          <div className={CHIP_ROW}>
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="h-14 w-28 animate-pulse rounded-full bg-panel-2 motion-reduce:animate-none"
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
    <div className="space-y-2.5">
      {stale && (
        <div className="flex items-center gap-2 px-1">
          <StaleTag />
          <span className="text-2xs text-ink-dim">last confirmed state — may not reflect a recent change</span>
        </div>
      )}
      {/* Climate first (redesign-06 follow-up, 2026-08-03: "climate first,
          switches condensed" is the owner's stated priority) — it's the
          section people walk up to the panel for, and it sits directly under
          the weather line above with nothing else between. Lights/switches/
          scenes condense into chip rows next; sensors, read-only, stay last. */}
      {entities.climates.length > 0 && <ClimateSection ha={ha} climates={entities.climates} entities={entities} />}
      {entities.lights.length > 0 && <LightsSection ha={ha} lights={entities.lights} entities={entities} />}
      {entities.switches.length > 0 && <SwitchesSection ha={ha} switches={entities.switches} entities={entities} />}
      {entities.scenes.length > 0 && <ScenesSection ha={ha} scenes={entities.scenes} />}
      {entities.sensors.length > 0 && <SensorsSection sensors={entities.sensors} />}
    </div>
  );
}
