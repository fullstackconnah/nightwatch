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

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
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
import { KIOSK_IDLE_AFTER_MS, kioskEffectiveInterval, useKioskIdle, useKioskNight } from "@/lib/kiosk-activity";
import { StaleTag } from "@/components/kiosk/kiosk-stale-tag";
import { KioskClimateTile } from "@/components/kiosk/kiosk-climate";
import { useClimateAutoOff, type UseClimateAutoOffResult } from "@/lib/kiosk/use-climate-auto-off";
import { ClimateAutoOffBanner, ClimateAutoOffPill } from "@/components/kiosk/kiosk-climate-auto-off";
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
} from "@/lib/types/ha";
import { cn } from "@/lib/utils";
import { chipWord, showSub } from "@/lib/sunroom-controls";
import { CHIP_COLS, LG_COL_SPAN, SCENE_COLS, TILE_COLS, mergeToggles, rowOneSpans, rowTwoLayout } from "@/lib/kiosk-board";
import { useKioskTheme } from "@/components/kiosk/kiosk-theme";
import { aimCatch, SunCatch, SunChipMarks } from "@/components/kiosk/kiosk-sun-catch";

const HA_STATES_KEY = "/kiosk/api/ha/states";
// Idle/night backoff (2026-08 perf pass): a light/switch/scene flip is the
// one interaction this whole surface exists for, so 7s stays the ACTIVE
// rate. Nobody is standing at the panel toggling anything while it's idle or
// at 3am, so those windows back off — 20s idle is still well inside "notices
// a change within a glance," and 60s at night matches the alerts tier below
// rather than picking an unrelated number. See kiosk-activity.ts for the
// shared idle/night signal and KIOSK_IDLE_AFTER_MS for the shared threshold.
const POLL_MS_ACTIVE = 7000;
const POLL_MS_IDLE = 20_000;
const POLL_MS_NIGHT = 60_000;
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
  /** Force a re-read of HA's state, outside the normal poll cadence.
   *
   *  Exists for one specific shape of problem: these IR/WiFi AC units accept a
   *  write instantly and take SECONDS to report the new attribute back through
   *  /api/states, while `runAction`'s own `finally { void mutate() }` refetches
   *  the moment the POST resolves — i.e. always too early to see the change. A
   *  caller holding its own optimistic value (kiosk-climate.tsx) uses this to
   *  ask again a few seconds later and release the hold as soon as HA agrees,
   *  rather than waiting out the poll interval. */
  revalidate: () => void;
}

export function useKioskHa(): UseKioskHaResult {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const isIdle = useKioskIdle(KIOSK_IDLE_AFTER_MS);
  const isNight = useKioskNight();
  // Recomputed every render, so a touch (isIdle -> false) or the clock
  // crossing 05:00/22:00 (isNight flips) lands on the very next render —
  // there's no separate "wake up" path to keep in sync with this one.
  const pollMs = kioskEffectiveInterval({
    active: POLL_MS_ACTIVE,
    idle: POLL_MS_IDLE,
    night: POLL_MS_NIGHT,
    isIdle,
    isNight,
  });
  const { data, error, isLoading, mutate } = useSWR<HaStatesResponse>(HA_STATES_KEY, fetcher, {
    // Any action in flight wins outright over the backoff — it must not resync
    // mid-tap, and the last one to finish is the one that resumes the poll.
    refreshInterval: pendingIds.size > 0 ? 0 : pollMs,
    keepPreviousData: true,
  });

  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
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
        void mutate();
      }
      return ok;
    },
    [data, mutate, dismissActionError],
  );

  const isPending = useCallback((entityId: string) => pendingIds.has(entityId), [pendingIds]);

  // Plain re-read, no optimistic payload — see the interface comment. Stable so
  // callers can safely put it in an effect's dependency list or a timer.
  const revalidate = useCallback(() => {
    void mutate();
  }, [mutate]);

  // SWR's default `compare` (dequal) already keeps `data` referentially
  // stable across content-identical polls — the bug this guards against is
  // this hook wrapping that stable `data` in a fresh object literal on every
  // render regardless. Memoized so the object itself stays stable too;
  // sections below take this whole result as a prop, and without this every
  // render of KioskHub would hand them a brand-new object even when nothing
  // in it changed.
  return useMemo(
    () => ({ data, error, isLoading, runAction, actionErrors, isPending, revalidate }),
    [data, error, isLoading, runAction, actionErrors, isPending, revalidate],
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
  fullName,
  on,
  available,
  subtitle,
  error,
  onToggle,
}: {
  icon: LucideIcon;
  /** Visible pill label — may be `fullName` with a shared section prefix
   *  stripped (see shortenSharedPrefix below). */
  name: string;
  /** Unabbreviated entity name. Always used for the accessible name and
   *  hover title, even when `name` has been shortened, so screen-reader
   *  users and anyone hovering on a non-touch display still get the full
   *  entity (2026-08-03 legibility pass — see kiosk-hub THESIS). */
  fullName: string;
  on: boolean;
  available: boolean;
  subtitle: string;
  error?: string;
  onToggle: () => void;
}) {
  const sr = useKioskTheme() === "sunroom";
  const unavailable = !available;
  const nameEl = <span className="sr-chip-name min-w-[5ch] truncate text-sm text-ink">{name}</span>;
  const subEl = (
    <span
      className={cn(
        unavailable ? "sr-chip-sub shrink-0 whitespace-nowrap font-mono text-2xs" : "sr-chip-sub min-w-0 max-w-24 shrink-[8] truncate font-mono text-2xs",
        error ? "text-bad" : "text-ink-faint",
      )}
      title={error}
      data-sr-tone={error ? "bad" : undefined}
    >
      {error ?? (sr && !showSub(subtitle, chipWord({ on }).word) ? "" : subtitle)}
    </span>
  );
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${fullName}`}
      title={fullName}
      disabled={!available}
      onClick={onToggle}
      onPointerDown={aimCatch}
      className={cn(
        "sr-chip sr-chip-sm kiosk-press relative flex h-11 w-full min-w-0 items-center gap-2 rounded-full border pl-3 pr-3.5 outline-none focus-visible:ring-1 focus-visible:ring-accent",
        unavailable && "h-auto min-h-11 pointer-events-none opacity-40",
        on ? "border-accent/40 bg-accent/10" : "border-line bg-panel-2 hover:border-line-bright",
      )}
      // The "elastic toggle" half of the brief lands HERE rather than on a
      // sliding knob: this control has no thumb to bounce, so the spring shows
      // up as the on/off wash arriving on the same release curve as the press.
      // No `transition-*` utility and no inline style is needed for that —
      // `.kiosk-press` names background-color/border-color/color in its own
      // property list precisely so a call site cannot have to. It has to: that
      // class is unlayered CSS and Tailwind's utilities are inside
      // `@layer utilities`, so an unlayered `transition:` shorthand deletes any
      // layered `transition-colors` outright rather than merging with it. The
      // reasoning and the measurement are recorded on the class itself.
    >
      <SunCatch />
      <Icon size={15} className={cn("shrink-0", on ? "text-accent" : "text-ink-faint")} aria-hidden />
      {/* The name outranks the sub: the sub (62%, unavailable) gives way first (shrink-8), the name keeps 5 characters. */}
      {/* An unavailable chip's "unavailable" is never cut: name and sub share a wrapping line, so a narrow chip puts the sub under the name. */}
      {unavailable ? <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">{nameEl}{subEl}</span> : <>{nameEl}{subEl}</>}
      {!sr && <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", on ? "dot dot-running" : "bg-line-bright")} />}
      <SunChipMarks on={on} error={!!error} bare />
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
  // Idle shows no status (aria-label says "Activate"): the name takes the width. Only a result or an error is worth a word.
  const statusText = error ?? (activated ? "activated" : pending ? "activating…" : null);
  return (
    <button
      type="button"
      aria-label={`Activate ${scene.name}`}
      disabled={!scene.available || pending}
      onClick={onActivate}
      onPointerDown={aimCatch}
      data-lit={activated}
      aria-busy={pending || undefined}
      className={cn(
        "sr-chip sr-chip-sm",
        // Same sheen pane as ToggleChip above. The bare `transition` utility
        // this used to carry is gone rather than left in place: `.kiosk-press`
        // is unlayered and fully owns the `transition` longhands, so a layered
        // Tailwind `transition` here would have been a dead class reading as
        // if it did something.
        "kiosk-press relative flex h-11 w-full min-w-0 items-center gap-2 rounded-full border pl-3 pr-3.5 outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none",
        !scene.available && "opacity-40",
        activated ? "border-accent/50 bg-accent/15" : "border-line bg-panel-2 hover:border-line-bright",
      )}
    >
      <SunCatch />
      <Sparkles size={15} className={cn("shrink-0", activated ? "text-accent" : "text-ink-faint")} aria-hidden />
      <span className="sr-chip-name min-w-[5ch] flex-1 truncate text-sm text-ink" title={scene.name}>{scene.name}</span>
      {statusText && (
        <span className={cn("sr-chip-sub min-w-0 max-w-28 shrink-[8] truncate font-mono text-2xs", error ? "text-bad" : activated ? "text-accent" : "text-ink-faint")} data-sr-tone={error ? "bad" : undefined} data-sr-num="">
          {statusText}
        </span>
      )}
      <SunChipMarks on={activated} error={!!error} busy={pending} scene />
    </button>
  );
}

/* ── sections ────────────────────────────────────────────────────────────── */

function SectionHeader({
  icon: Icon,
  label,
  qualifier,
  note,
  stale,
}: {
  icon: LucideIcon;
  label: string;
  /** Shared prefix stripped from this section's pill labels (e.g. "Front
   *  door") — surfaced once here instead of repeating it on every pill. */
  qualifier?: string | null;
  note?: string;
  /** The HA cells' stale mark, beside the heading (-my-1: the 24 px sunroom pill overflows the line evenly, so no height changes). */
  stale?: boolean;
}) {
  return (
    // @container: the stale note drops to screen-reader-only when under ~120 px is left beside the heading and tag.
    <div className="@container flex items-baseline justify-between gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <Icon size={13} className="text-ink-faint" aria-hidden />
        {/* Real heading, not a styled span — the page supplies an <h1>, so
            these five section captions (Lights/Switches/Scenes/Climate/
            Sensors) sit at <h2>. `.microlabel` carries the visuals unchanged;
            Tailwind's preflight zeroes the browser's own h2 margin/size. */}
        <h2 className="microlabel whitespace-nowrap">{label}</h2>
        {qualifier && <span className="microlabel opacity-70">{qualifier}</span>}
        {stale && <span className="-my-1 flex"><StaleTag title={note} /></span>}
      </div>
      {note && <span className="microlabel min-w-0 flex-1 truncate text-right @max-[24rem]:sr-only" title={note}>{note}</span>}
    </div>
  );
}

// Wrapped in memo() because `ha`/`entities` now hold a stable identity across
// content-identical 7s polls (see the `compare` option on useKioskHa's SWR
// call and the useMemo on its return) — without memo() here the sections
// would still re-render on every poll despite that stability, since a parent
// re-render always reconciles children unless props are shallow-equal AND
// the component opts in.
const STALE_NOTE = "last confirmed state — may not reflect a recent change";

/** Every board cell: one `.panel` (one pane deep, nothing inside is a panel), its own `<section>` and rise step. */
function Cell({ className, riseIndex, children }: { className: string; riseIndex: number; children: ReactNode }) {
  return (
    <section
      // relative: sunroom sheen anchor, as on the old sections.
      className={cn("panel relative kiosk-rise flex min-w-0 flex-col gap-2 p-3", className)}
      style={{ "--kiosk-rise-i": riseIndex } as React.CSSProperties}
    >
      {children}
    </section>
  );
}

/** Row 1 spans: 12 wide below 641 px, 6 each from 641 px, then by the zone count from lg (kiosk-board.ts). */
const rowOneCell = (lgSpan: number) => cn("col-span-12 min-[641px]:col-span-6", LG_COL_SPAN[lgSpan]);
/** Where a status cell (not connected, load error, skeleton) sits: Climate's slot, so Today keeps its 5 columns. */
const STATUS_SLOT = rowOneCell(7);

function TodayCell({ today, zones }: { today: ReactNode; zones: number }) {
  const span = rowOneSpans(zones).today;
  return (
    <Cell className={span === 12 ? "col-span-12" : rowOneCell(span)} riseIndex={1}>
      {today}
    </Cell>
  );
}

const TogglesSection = memo(function TogglesSection({
  ha,
  lights,
  switches,
  entities,
  className,
  columns,
  stale,
}: {
  ha: UseKioskHaResult;
  lights: HaLight[];
  switches: HaSwitch[];
  entities: HaEntities;
  /** Row 2 span and chip columns (kiosk-board.ts). */
  className: string;
  columns: string;
  stale: boolean;
}) {
  // One merged grid: lights, then switches, one count and one shared-prefix qualifier over both.
  const { entries, qualifier, note } = useMemo(() => mergeToggles(lights, switches), [lights, switches]);
  return (
    <Cell className={className} riseIndex={3}>
      <SectionHeader icon={Lightbulb} label="Lights and switches" qualifier={qualifier} note={stale ? STALE_NOTE : note} stale={stale} />
      <div className={cn("grid gap-2", columns)}>
        {entries.map((e) => {
          if (e.kind === "light") {
            const light = e.item;
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
                name={e.label}
                fullName={light.name}
                on={light.on}
                available={light.available}
                subtitle={statusText}
                error={ha.actionErrors[light.entityId]}
                onToggle={toggle}
              />
            );
          }
          const sw = e.item;
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
              name={e.label}
              fullName={sw.name}
              on={sw.on}
              available={sw.available}
              subtitle={!sw.available ? "unavailable" : sw.on ? "on" : "off"}
              error={ha.actionErrors[sw.entityId]}
              onToggle={toggle}
            />
          );
        })}
      </div>
    </Cell>
  );
});

/** Scenes, then (under the hub's own hairline) the read-only sensors: one panel, the house beside the day. */
const SidePanel = memo(function SidePanel({
  ha,
  scenes,
  sensors,
  className,
  columns,
  stale,
}: {
  ha: UseKioskHaResult;
  scenes: HaScene[];
  sensors: HaSensor[];
  className: string;
  columns: string;
  stale: boolean;
}) {
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
    <Cell className={className} riseIndex={4}>
      {scenes.length > 0 && (
        <>
          <SectionHeader icon={Sparkles} label="Scenes" stale={stale} />
          <div className={cn("grid gap-2", columns)}>
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
        </>
      )}
      {sensors.length > 0 && (
        <div className={cn("flex flex-col gap-2", scenes.length > 0 && "border-t border-line pt-2")}>
          <SectionHeader icon={Battery} label="Sensors" stale={scenes.length === 0 && stale} />
          {/* Read-only readings, no touch target and no alert: name and value on one line; the readings wrap and the panel grows. */}
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
        </div>
      )}
    </Cell>
  );
});

const ClimateSection = memo(function ClimateSection({
  ha,
  climates,
  entities,
  autoOff,
  className,
  tileColumns,
  stale,
}: {
  ha: UseKioskHaResult;
  climates: HaClimate[];
  entities: HaEntities;
  /** The nightly-sweep engine result, lifted to KioskHub (its config poll and fire effect must run whether or not this cell is
   *  mounted, see useClimateAutoOff's THESIS) and threaded down for the header pill and the banner. useClimateAutoOff
   *  identity-stabilizes it, so passing it does not defeat the memo. */
  autoOff: UseClimateAutoOffResult;
  /** Row 1 span and tile columns by zone count (kiosk-board.ts). */
  className: string;
  tileColumns: string;
  stale: boolean;
}) {
  // Which tile (by entityId) is under adjustment, for the depth-of-field exemption (globals.css "focus isolation"). Owned
  // here: two tiles adjusting at once would both claim the one "in focus" slot, and the grid is what arbitrates.
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  return (
    <Cell className={className} riseIndex={2}>
      {/* Row 1 is one line from 641 px. The pill is 44 px in a 24 px row (-my-2.5 = 10 px over each edge): pb-3.5 = 10 + the tile gap (gap-3, 12) - this cell's gap-2 (8), so it clears the tiles by the tile gap.
          Below 640 px the pill is its own left-aligned line (pb-1 = 12 - 8) and the row keeps the fixed bottom-right cluster's width (two min-w-14 buttons and gap-3) clear on its right. */}
      <div className="flex items-center justify-between gap-2 pb-3.5 max-[640px]:flex-col max-[640px]:items-start max-[640px]:pb-1 max-[640px]:pr-[calc(2*3.5rem+0.75rem)]">
        <SectionHeader icon={Thermometer} label="Climate" stale={stale} />
        <ClimateAutoOffPill autoOff={autoOff} />
      </div>
      <ClimateAutoOffBanner autoOff={autoOff} />
      <div
        className={cn("grid gap-3", tileColumns)}
        // Arms the depth-of-field isolation the moment ANY tile is adjusting (globals.css
        // `[data-kiosk-focus="on"] .kiosk-defocus`); the matching tile marks itself data-kiosk-focused.
        data-kiosk-focus={adjustingId ? "on" : undefined}
      >
        {climates.map((c) => (
          <KioskClimateTile
            key={c.entityId}
            ha={ha}
            climate={c}
            entities={entities}
            focused={adjustingId === c.entityId}
            onAdjustingChange={(adjusting: boolean) =>
              // `prev === c.entityId ? null : prev` is load-bearing: a stale "I stopped" from tile A must never clear a
              // focus tile B has since claimed (A's `interacting` can flip false one tick after B's flips true).
              setAdjustingId((prev) => (adjusting ? c.entityId : prev === c.entityId ? null : prev))
            }
          />
        ))}
      </div>
    </Cell>
  );
});

/* ── non-happy states ───────────────────────────────────────────────────── */

/** Loading: the Climate and Lights and switches slots, so the board keeps its shape. Today shows its own content. */
function HubSkeleton() {
  return (
    <>
      <Cell className={STATUS_SLOT} riseIndex={2}>
        <SectionHeader icon={Thermometer} label="Climate" />
        <div className="grid grid-cols-1 gap-3 min-[641px]:grid-cols-2">
          {Array.from({ length: 2 }).map((_, j) => (
            <div key={j} className="h-24 animate-pulse rounded-md bg-panel-2 motion-reduce:animate-none" style={{ animationDelay: `${j * 60}ms` }} />
          ))}
        </div>
      </Cell>
      <Cell className="col-span-12" riseIndex={3}>
        <SectionHeader icon={Lightbulb} label="Lights and switches" />
        <div className="grid grid-cols-2 gap-2 min-[641px]:grid-cols-4">
          {Array.from({ length: 8 }).map((_, j) => (
            <div key={j} className="h-11 animate-pulse rounded-full bg-panel-2 motion-reduce:animate-none" style={{ animationDelay: `${j * 60}ms` }} />
          ))}
        </div>
      </Cell>
    </>
  );
}

function HubLoadError({ error }: { error: unknown }) {
  return (
    <div role="status" className={cn("panel flex flex-wrap items-center gap-3 px-4 py-3", STATUS_SLOT)}>
      <span className="microlabel !text-bad" data-sr-tone="bad">load failed</span>
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
    <div role="status" className={cn("panel relative flex flex-wrap items-center gap-3 overflow-hidden px-4 py-3", STATUS_SLOT)}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HATCH_PATTERN }} />
      <House size={16} className="relative shrink-0 text-ink-faint" aria-hidden />
      <span className="microlabel relative !text-warn" data-sr-tone="warn">Home Assistant not connected</span>
      <p className="relative text-xs text-ink-dim">Connect it in Settings → Integrations, and your lights, scenes and climate appear here.</p>
    </div>
  );
}

function HubStatusIssue({ kind, detail }: { kind: "unreachable" | "unauthorized"; detail?: string }) {
  const isUnreachable = kind === "unreachable";
  return (
    <div role="status" className={cn("panel flex flex-wrap items-center gap-2 px-4 py-3", STATUS_SLOT)}>
      <span className={cn("dot", isUnreachable ? "dot-dead" : "dot-unhealthy")} aria-hidden />
      <span className={cn("microlabel", isUnreachable ? "!text-bad" : "!text-warn")} data-sr-tone={isUnreachable ? "bad" : "warn"}>
        Home Assistant {kind}
      </span>
      {detail && <span className="text-xs text-ink-dim">{detail}</span>}
    </div>
  );
}

function HubEmpty() {
  return (
    <div role="status" className={cn("panel relative flex flex-wrap items-center gap-3 overflow-hidden px-4 py-3", STATUS_SLOT)}>
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

/** The board's cells, as a fragment so they are direct children of FullContent's 12-column grid: Today beside Climate (row 1),
 *  Lights and switches beside Scenes and Sensors (row 2). `today` is the Today cell's content: its span depends on the
 *  climate-zone count, which only this hook knows. A status state (not connected, error, empty) is the Climate-slot cell and row 2 is absent. */
export function KioskHub({ today }: { today: ReactNode }) {
  const ha = useKioskHa();
  const autoOff = useClimateAutoOff(ha);
  const { data, error, isLoading } = ha;

  if (isLoading && !data) return <><TodayCell today={today} zones={2} /><HubSkeleton /></>;
  if (Boolean(error) && !data) return <><TodayCell today={today} zones={2} /><HubLoadError error={error} /></>;
  if (!data) return <TodayCell today={today} zones={0} />;

  // `error` here means the *latest* poll failed while `data` still holds the
  // last successful one (SWR keeps it — see useFreshness in kiosk-client.ts
  // for why that's safe to rely on). Every branch below is drawn from that
  // possibly-old `data`, tiles included — they stay tappable because the
  // server is the source of truth for the action itself, but a stale read is
  // still a stale read and gets marked rather than repainted as current.
  const stale = Boolean(error);

  const status = (cell: ReactNode) => (
    <>
      <TodayCell today={today} zones={2} />
      {cell}
    </>
  );
  if (data.status === "unconfigured") return status(<HubUnconfigured />);
  if (data.status === "unreachable") return status(<HubStatusIssue kind="unreachable" detail={data.detail} />);
  if (data.status === "unauthorized") return status(<HubStatusIssue kind="unauthorized" detail={data.detail} />);

  const entities = data.entities;
  if (!entities) return status(<HubEmpty />);

  const total =
    entities.lights.length +
    entities.switches.length +
    entities.scenes.length +
    entities.climates.length +
    entities.sensors.length;
  if (total === 0) return status(<HubEmpty />);

  const zones = entities.climates.length;
  const one = rowOneSpans(zones);
  const hasChips = entities.lights.length + entities.switches.length > 0;
  const hasSide = entities.scenes.length + entities.sensors.length > 0;
  const two = rowTwoLayout(hasChips, hasSide);

  return (
    <>
      <TodayCell today={today} zones={zones} />
      {zones > 0 && (
        <ClimateSection
          ha={ha}
          climates={entities.climates}
          entities={entities}
          autoOff={autoOff}
          className={rowOneCell(one.climate)}
          tileColumns={TILE_COLS[one.tileColumns]}
          stale={stale}
        />
      )}
      {hasChips && (
        <TogglesSection
          ha={ha}
          lights={entities.lights}
          switches={entities.switches}
          entities={entities}
          className={cn("col-span-12", LG_COL_SPAN[two.chips])}
          columns={CHIP_COLS[two.chipColumns]}
          stale={stale}
        />
      )}
      {hasSide && (
        <SidePanel
          ha={ha}
          scenes={entities.scenes}
          sensors={entities.sensors}
          className={cn("col-span-12", LG_COL_SPAN[two.side])}
          columns={SCENE_COLS[two.sceneColumns] ?? SCENE_COLS[4]}
          stale={stale}
        />
      )}
    </>
  );
}
