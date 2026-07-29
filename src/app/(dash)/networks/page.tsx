"use client";

import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { fetcher } from "@/lib/client";

interface NetworkRow {
  id: string;
  name: string;
  driver: string;
  subnet: string | null;
  internal: boolean;
  containers: string[];
}

export default function NetworksPage() {
  const { data, error } = useSWR<{ networks: NetworkRow[] }>("/api/docker/networks", fetcher, {
    refreshInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Networks</h1>
        <p className="text-xs text-ink-dim mt-0.5">
          {data ? `${data.networks.length} networks` : "…"}
        </p>
      </header>

      {error && <div className="panel p-4 text-bad text-sm">{error.message}</div>}

      <div className="panel overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Name", "Driver", "Subnet", "Containers"].map((h) => (
                <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.networks ?? []).map((n) => (
              <tr key={n.id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
                <td className="px-3 py-2 font-mono text-xs">
                  {n.name}
                  {n.internal && <Badge className="ml-2">internal</Badge>}
                </td>
                <td className="px-3 py-2 text-xs text-ink-dim">{n.driver}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-faint">{n.subnet ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {n.containers.map((c) => (
                      <Badge key={c} variant="accent">{c}</Badge>
                    ))}
                    {!n.containers.length && <span className="text-xs text-ink-faint">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {(data?.networks ?? []).map((n) => (
          <div key={n.id} className="panel p-3 space-y-2">
            <div>
              <div className="microlabel">name</div>
              <div className="font-mono text-sm">
                {n.name}
                {n.internal && <Badge className="ml-2">internal</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <div className="microlabel">driver</div>
                <div className="text-xs text-ink-dim">{n.driver}</div>
              </div>
              <div>
                <div className="microlabel">subnet</div>
                <div className="font-mono text-xs text-ink-faint">{n.subnet ?? "—"}</div>
              </div>
            </div>
            <div>
              <div className="microlabel mb-1">containers</div>
              <div className="flex flex-wrap gap-1">
                {n.containers.map((c) => (
                  <Badge key={c} variant="accent">{c}</Badge>
                ))}
                {!n.containers.length && <span className="text-xs text-ink-faint">—</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
