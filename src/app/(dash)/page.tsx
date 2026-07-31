"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { VitalsStrip } from "@/components/vitals-strip";
import { ContainerTile } from "@/components/container-tile";
import { useContainers, useResources, useWidgets } from "@/lib/client";

export default function OverviewPage() {
  const { data, error, isLoading, mutate } = useContainers(5000);
  const { data: widgetData } = useWidgets(20000);
  const { data: resourceData } = useResources(10000);

  const visible = useMemo(
    () => (data?.containers ?? []).filter((c) => !c.tile.hidden),
    [data],
  );

  const statsById = useMemo(() => {
    const map = new Map<string, { cpuPct: number; memBytes: number }>();
    for (const c of resourceData?.containers ?? []) {
      map.set(c.id, { cpuPct: c.cpuPct, memBytes: c.memBytes });
    }
    return map;
  }, [resourceData]);

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

      {data?.groups.map((group) => {
        const members = visible.filter((c) => c.tile.group === group);
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
      })}
    </div>
  );
}
