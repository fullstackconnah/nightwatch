"use client";

import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { fetcher } from "@/lib/client";

interface VolumeRow {
  name: string;
  driver: string;
  mountpoint: string;
  created: string | null;
  usedBy: string[];
}

export default function VolumesPage() {
  const { data, error } = useSWR<{ volumes: VolumeRow[] }>("/api/docker/volumes", fetcher, {
    refreshInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Volumes</h1>
        <p className="text-xs text-ink-dim mt-0.5">
          {data ? `${data.volumes.length} volumes` : "…"}
        </p>
      </header>

      {error && <div className="panel p-4 text-bad text-sm">{error.message}</div>}

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Name", "Driver", "Mountpoint", "Used by"].map((h) => (
                <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.volumes ?? []).map((v) => (
              <tr key={v.name} className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
                <td className="px-3 py-2 font-mono text-xs max-w-64 truncate" title={v.name}>
                  {v.name}
                </td>
                <td className="px-3 py-2 text-xs text-ink-dim">{v.driver}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-faint max-w-72 truncate" title={v.mountpoint}>
                  {v.mountpoint}
                </td>
                <td className="px-3 py-2">
                  {v.usedBy.length ? (
                    <div className="flex flex-wrap gap-1">
                      {v.usedBy.map((c) => (
                        <Badge key={c} variant="accent">{c}</Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge>orphaned</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
