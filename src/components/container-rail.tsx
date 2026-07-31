"use client";

import { cn } from "@/lib/utils";
import { stateDotClass } from "@/components/container-tile";

/**
 * The rail is the console's other half of the "off the rail, onto the floor"
 * metaphor: selecting a container does not remove its chip, it hollows it —
 * the socket stays in place so 26 chips keep their geometry and a glance at
 * the rail tells you which containers you are watching without hunting for
 * what moved.
 */

export interface RailContainer {
  name: string;
  state: string;
  health: "healthy" | "unhealthy" | "starting" | null;
  composeProject: string | null;
}

const UNGROUPED = "ungrouped";

function groupContainers(containers: RailContainer[]): Array<[string, RailContainer[]]> {
  const groups = new Map<string, RailContainer[]>();
  for (const c of containers) {
    const key = c.composeProject ?? UNGROUPED;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  // Ungrouped containers go last: a bare container is the exception on a
  // compose-managed host, not the organising fact worth leading with.
  const entries = [...groups.entries()];
  entries.sort(([a], [b]) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b);
  });
  return entries;
}

function RailChip({
  container: c,
  isSelected,
  disabled,
  pulseAt,
  onToggle,
}: {
  container: RailContainer;
  isSelected: boolean;
  disabled: boolean;
  /**
   * Count of lines this container has delivered LIVE since it went on the floor.
   * A counter rather than a timestamp on purpose: seeded scrollback must not
   * flash the socket (the line may be hours old), and two lines landing in the
   * same millisecond have to produce two flashes, which a docker timestamp
   * cannot express. Zero or undefined means nothing has arrived yet.
   */
  pulseAt: number | undefined;
  onToggle: () => void;
}) {
  const stopped = c.state !== "running";

  if (isSelected) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed
        aria-label={`Stop watching ${c.name} — currently on the floor`}
        title="On the floor — click to put back on the rail"
        className={cn(
          "relative h-11 md:h-8 shrink-0 snap-start inline-flex items-center gap-1.5 rounded-md px-2.5",
          "border border-dashed border-line-bright bg-transparent",
          "cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent",
        )}
      >
        <span className="font-mono text-xs text-ink-faint truncate max-w-[9rem]">{c.name}</span>
        {/* A hollow socket is otherwise static, so a line landing on its track
            below has no echo up here. Keying this overlay on the arrival
            count remounts it, which replays `.rail-arrival` — the same
            authored moment as the line's own `.log-arrival` flash, so an
            arrival reads as one event in two places rather than two effects.
            An overlay rather than the button itself: remounting the button
            would drop keyboard focus mid-watch. */}
        {pulseAt !== undefined && pulseAt > 0 && (
          <span
            key={pulseAt}
            aria-hidden
            className="rail-arrival absolute inset-0 rounded-md pointer-events-none"
          />
        )}
        <span className="microlabel !text-ink-faint whitespace-nowrap">on the floor</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={false}
      aria-disabled={disabled}
      aria-label={`Watch ${c.name}${stopped ? ` (${c.state})` : ""}`}
      title={disabled ? "Rail is at capacity — free a slot to watch this one" : c.name}
      className={cn(
        "h-11 md:h-8 shrink-0 snap-start panel panel-hover inline-flex items-center gap-1.5 rounded-md px-2.5",
        "outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer",
        stopped && "opacity-60",
        disabled && "opacity-40 cursor-not-allowed pointer-events-none",
      )}
    >
      <span className={cn("dot", stateDotClass(c))} />
      <span className="font-mono text-xs text-ink truncate max-w-[9rem]">{c.name}</span>
      {stopped && <span className="microlabel !text-ink-faint whitespace-nowrap">{c.state}</span>}
    </button>
  );
}

export function ContainerRail({
  containers,
  selected,
  onToggle,
  max,
  pulse,
}: {
  containers: RailContainer[];
  selected: string[];
  onToggle: (name: string) => void;
  max: number;
  /**
   * Per-container count of lines received LIVE, keyed by name — only populated
   * for containers currently on the floor. A count, not a timestamp: seeded
   * scrollback must not flash the socket, and two lines in the same millisecond
   * have to produce two flashes. Optional; without it the rail simply loses the
   * floor-activity echo on the hollow sockets.
   */
  pulse?: Record<string, number>;
}) {
  const selectedSet = new Set(selected);
  const atCapacity = selected.length >= max;
  const groups = groupContainers(containers);

  return (
    <div className="space-y-2">
      {atCapacity && (
        // Framed as a scanability limit, not a technical one — the stream can
        // multiplex every container, the rail just stops being readable at a
        // glance past this many bands on screen.
        <p className="text-xs text-ink-faint">
          Watching {max} — the most a screen can read at a glance. Put one back on the rail to
          swap it for another.
        </p>
      )}

      {/* Groups always stack vertically — 26 chips ungrouped is a wall, the
          compose stack is the box's real organising fact, and that structure
          must survive at every width. What changes by breakpoint is only
          how each group's own chip row lays out: a momentum-scrolling strip
          on a phone, a wrapping field from md up. */}
      <div className="flex flex-col gap-3">
        {groups.map(([project, list]) => (
          <div key={project} className="flex flex-col gap-1.5 min-w-0">
            <span className="microlabel">{project === UNGROUPED ? "ungrouped" : project}</span>
            <div
              className="flex gap-1.5 flex-nowrap overflow-x-auto snap-x pb-1 md:flex-wrap md:overflow-x-visible md:pb-0"
              style={{ overscrollBehaviorX: "contain" }}
            >
              {list.map((c) => {
                const isSelected = selectedSet.has(c.name);
                return (
                  <RailChip
                    key={c.name}
                    container={c}
                    isSelected={isSelected}
                    disabled={!isSelected && atCapacity}
                    pulseAt={pulse?.[c.name]}
                    onToggle={() => onToggle(c.name)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
