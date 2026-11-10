"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { AppCard } from "@/components/home/app-card";
import { Button } from "@/components/ui/button";
import { SegmentButton } from "@/components/ui/segment-button";
import { stateSeverity } from "@/lib/container-rank";
import type { ContainersResponse, TiledContainer, WidgetData } from "@/lib/client";

export type SortKey = "group" | "name" | "state";
export const SORT_KEYS: readonly SortKey[] = ["group", "name", "state"];
const SORT_TEXT: Record<SortKey, string> = { group: "Groups", name: "Name", state: "State" };
const SORT_LABEL: Record<SortKey, string> = {
  group: "Group into sections (default)",
  name: "Sort by name",
  state: "Sort by state, needs-attention first",
};

/** `?sort=cpu|mem` links from before fall back to groups, because the unknown key is dropped. */
export function isSortKey(v: string | null): v is SortKey {
  return v !== null && (SORT_KEYS as readonly string[]).includes(v);
}

function sorted(list: TiledContainer[], sort: SortKey): TiledContainer[] {
  const by = [...list];
  if (sort === "name") return by.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "state") return by.sort((a, b) => stateSeverity(a) - stateSeverity(b) || a.name.localeCompare(b.name));
  return by;
}

/** Every app, with the filter, the order control and the links to where the rest lives. */
export function Launcher({
  data,
  error,
  filtered,
  widgets,
  query,
  setQuery,
  sort,
  setSort,
  filterRef,
  onChanged,
}: {
  data: ContainersResponse | undefined;
  /** Docker could not be reached and there is nothing to show. */
  error: boolean;
  filtered: TiledContainer[];
  widgets: Record<string, WidgetData> | undefined;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
  /** A start, stop or restart finished: refresh the container list. */
  onChanged: () => void;
}) {
  const counts = data?.counts;
  const unknown = error || !counts;
  const countText = unknown
    ? "unknown"
    : `${counts.running} running · ${counts.stopped} stopped${counts.unhealthy > 0 ? ` · ${counts.unhealthy} unhealthy` : ""}`;
  const card = (c: TiledContainer) => <AppCard key={c.id} c={c} widget={widgets?.[c.name]} onChanged={onChanged} />;

  let body: React.ReactNode;
  if (error) body = <p className="hm-note">Apps are unknown while Docker can&apos;t be reached.</p>;
  else if (!data) body = <p className="hm-note">Discovering containers…</p>;
  else if (filtered.length === 0) body = <p className="hm-note">No apps match &ldquo;{query.trim()}&rdquo;.</p>;
  else if (sort === "group") {
    body = data.groups.map((group) => {
      const members = filtered.filter((c) => c.tile.group === group);
      if (!members.length) return null;
      return (
        <div key={group} className="hm-group" data-group={group}>
          <div className="flex items-center gap-3" data-feature="groups">
            <h3 className="microlabel !text-accent">{group}</h3>
            <div className="h-px flex-1 bg-line" />
            <span className="microlabel">{members.length}</span>
          </div>
          <div className="hm-app-grid">{members.map(card)}</div>
        </div>
      );
    });
  } else body = <div className="hm-app-grid">{sorted(filtered, sort).map(card)}</div>;

  return (
    <section className="hm-apps" data-feature="launcher" aria-label="Apps">
      <div className="hm-sec-head">
        <h2 className="microlabel">Apps</h2>
        <span className="font-mono text-xs text-ink-dim" data-feature="counts">
          {countText}
        </span>
      </div>
      <div className="hm-tools">
        <div className="hm-search">
          <Search size={13} className="hm-search-icon" aria-hidden />
          <input
            ref={filterRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter by name or image…"
            aria-label="Filter apps"
            data-feature="filter"
            className="h-11 md:h-8 w-full rounded-md bg-panel-2 border border-line pl-8 pr-2 font-mono text-xs placeholder:text-ink-faint outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-colors"
          />
          <kbd
            data-feature="slash-key"
            title="Press / to filter"
            className="font-mono text-[0.6rem] text-ink-faint border border-line rounded px-1 py-px"
          >
            /
          </kbd>
          {/* Always rendered, so the row never changes width as the first letter is typed. */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear filter"
            style={{ visibility: query ? "visible" : "hidden" }}
            tabIndex={query ? 0 : -1}
            onClick={() => setQuery("")}
          >
            <X size={13} aria-hidden />
          </Button>
        </div>
        <div className="panel p-1 flex gap-1" role="group" aria-label="Order apps">
          {SORT_KEYS.map((key) => (
            <SegmentButton key={key} active={sort === key} onClick={() => setSort(key)} label={SORT_LABEL[key]}>
              {SORT_TEXT[key]}
            </SegmentButton>
          ))}
        </div>
        <Link href="/resources?metric=cpu" className="hm-link" data-feature="sort-link">
          CPU or memory order in Resources
        </Link>
      </div>
      {body}
    </section>
  );
}
