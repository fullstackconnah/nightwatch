"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SegmentButton } from "@/components/ui/segment-button";
import { VitalsStrip } from "@/components/vitals-strip";
import { ContainerTile } from "@/components/container-tile";
import { useContainers, useResources, useWidgets, type TiledContainer } from "@/lib/client";
import { formatBytes } from "@/lib/format";
import { stateSeverity } from "@/lib/container-rank";

type SortKey = "group" | "name" | "cpu" | "mem" | "state";

const SORT_KEYS: readonly SortKey[] = ["group", "name", "cpu", "mem", "state"];
const SORT_CODE: Record<SortKey, string> = { group: "GROUPS", name: "NAME", cpu: "CPU", mem: "MEM", state: "STATE" };
const SORT_LABEL: Record<SortKey, string> = {
  group: "Group into sections (default)",
  name: "Sort by name",
  cpu: "Sort by CPU, highest first",
  mem: "Sort by memory, highest first",
  state: "Sort by state, needs-attention first",
};

function isSortKey(v: string | null): v is SortKey {
  return v !== null && (SORT_KEYS as readonly string[]).includes(v);
}

type Stats = { cpuPct: number; memBytes: number };

function sortContainers(list: TiledContainer[], sort: SortKey, statsById: Map<string, Stats>): TiledContainer[] {
  const arr = [...list];
  switch (sort) {
    case "name":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case "cpu":
      return arr.sort(
        (a, b) =>
          (statsById.get(b.id)?.cpuPct ?? 0) - (statsById.get(a.id)?.cpuPct ?? 0) || a.name.localeCompare(b.name),
      );
    case "mem":
      return arr.sort(
        (a, b) =>
          (statsById.get(b.id)?.memBytes ?? 0) - (statsById.get(a.id)?.memBytes ?? 0) || a.name.localeCompare(b.name),
      );
    case "state":
      return arr.sort((a, b) => stateSeverity(a) - stateSeverity(b) || a.name.localeCompare(b.name));
    default:
      return arr;
  }
}

/** The value the reader ranked by, printed mono on the tile — a ranking with
 *  nothing to point at is just a claim. Undefined for "group" (no ranking to
 *  show) and "name" (the tile's own name already is the sort key). */
function rankValueFor(
  sort: SortKey,
  c: TiledContainer,
  stats: Stats | undefined,
): { label: string; value: string } | undefined {
  switch (sort) {
    case "cpu":
      return { label: "CPU", value: stats ? `${stats.cpuPct.toFixed(1)}%` : "—" };
    case "mem":
      return { label: "MEM", value: stats ? formatBytes(stats.memBytes, 0) : "—" };
    case "state":
      return { label: "STATE", value: c.health === "unhealthy" ? "unhealthy" : c.state };
    default:
      return undefined;
  }
}

export default function OverviewPage() {
  const { data, error, isLoading, mutate } = useContainers(5000);
  const { data: widgetData } = useWidgets(20000);
  const { data: resourceData } = useResources(10000);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("group");
  const filterRef = useRef<HTMLInputElement | null>(null);

  // Mount-only: adopt ?sort= from the URL if present and valid (deep-linkable,
  // e.g. /?sort=cpu), and survives a refresh. Reading in an effect rather than
  // the useState initialiser avoids a server/client hydration mismatch — same
  // shape as /resources' ?metric= adoption.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("sort");
    if (isSortKey(requested)) setSort(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("sort", sort);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, [sort]);

  // `/` focuses the filter, the way every console the reader already uses does.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      filterRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(
    () => (data?.containers ?? []).filter((c) => !c.tile.hidden),
    [data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((c) => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q));
  }, [visible, query]);

  const statsById = useMemo(() => {
    const map = new Map<string, Stats>();
    for (const c of resourceData?.containers ?? []) {
      map.set(c.id, { cpuPct: c.cpuPct, memBytes: c.memBytes });
    }
    return map;
  }, [resourceData]);

  const ranked = useMemo(
    () => (sort === "group" ? [] : sortContainers(filtered, sort, statsById)),
    [filtered, sort, statsById],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            Everything on the box, at a glance.
          </p>
        </div>
        {data && (
          <div className="flex gap-2 flex-wrap">
            <Badge variant="ok">{data.counts.running} running</Badge>
            {data.counts.unhealthy > 0 && (
              <Badge variant="warn">{data.counts.unhealthy} unhealthy</Badge>
            )}
            {data.counts.restarting > 0 && (
              <Badge variant="blue">{data.counts.restarting} restarting</Badge>
            )}
            {data.counts.paused > 0 && <Badge variant="warn">{data.counts.paused} paused</Badge>}
            <Badge>{data.counts.stopped} stopped</Badge>
          </div>
        )}
      </header>

      <VitalsStrip />

      {error && (
        <div className="panel p-4 text-bad text-sm">
          Docker unreachable: {error.message}
        </div>
      )}
      {isLoading && !data && (
        <div className="panel p-8 text-center text-ink-faint text-sm">
          discovering containers…
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-64">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter by name or image…"
              aria-label="Filter containers by name or image"
              className="h-11 md:h-8 w-full rounded-md bg-panel-2 border border-line pl-8 pr-9 font-mono text-xs placeholder:text-ink-faint outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-colors"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear filter"
                  // md:h-6/w-6 (24px) was the smallest control in the app —
                  // bumped to md:h-7/w-7, the smallest pointer size already
                  // established elsewhere (image-delete-action.tsx's
                  // ICON_BUTTON), rather than inventing a new value.
                  className="inline-flex items-center justify-center h-11 w-11 md:h-7 md:w-7 text-ink-faint hover:text-ink cursor-pointer"
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd className="hidden sm:block font-mono text-[0.6rem] text-ink-faint border border-line rounded px-1 py-px">
                  /
                </kbd>
              )}
            </div>
          </div>

          <div
            // Edge-fade cue: at ~768px the segmented control's rightmost
            // button clips flush at the container edge with nothing to
            // suggest it scrolls. A right-edge mask feathers that last
            // sliver so the cut reads as "more here", not as a layout bug.
            className="panel p-1 flex gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black,black_calc(100%-1.5rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,black,black_calc(100%-1.5rem),transparent)]"
            role="group"
            aria-label="Sort containers"
          >
            {SORT_KEYS.map((key) => (
              <SegmentButton key={key} active={sort === key} onClick={() => setSort(key)} label={SORT_LABEL[key]}>
                {SORT_CODE[key]}
              </SegmentButton>
            ))}
          </div>
        </div>
      )}

      {data && filtered.length === 0 && (
        <div className="panel p-8 text-center text-ink-faint text-sm">no containers match</div>
      )}

      {sort === "group"
        ? data?.groups.map((group) => {
            const members = filtered.filter((c) => c.tile.group === group);
            if (!members.length) return null;
            return (
              <section key={group}>
                <div className="flex items-center gap-3 mb-2.5">
                  <h2 className="microlabel !text-accent">{group}</h2>
                  <div className="h-px flex-1 bg-line" />
                  <span className="microlabel">{members.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {members.map((c) => (
                    <ContainerTile
                      key={c.id}
                      container={c}
                      widget={widgetData?.widgets[c.name]}
                      stats={statsById.get(c.id)}
                      onChanged={() => mutate()}
                    />
                  ))}
                </div>
              </section>
            );
          })
        : filtered.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-2.5">
                <h2 className="microlabel !text-accent">Ranked by {SORT_CODE[sort]}</h2>
                <div className="h-px flex-1 bg-line" />
                <span className="microlabel">{ranked.length}</span>
              </div>
              {/* A grid of equal cards is a claim that the things are equal — the
                  reader asked for a ranking, so this is one ordered column, not a
                  reflowed grid, per DESIGN.md's "rank, don't grid equals" rule. */}
              <div className="flex flex-col gap-2">
                {ranked.map((c) => (
                  <ContainerTile
                    key={c.id}
                    container={c}
                    widget={widgetData?.widgets[c.name]}
                    stats={statsById.get(c.id)}
                    onChanged={() => mutate()}
                    rankValue={rankValueFor(sort, c, statsById.get(c.id))}
                  />
                ))}
              </div>
            </section>
          )}
    </div>
  );
}
