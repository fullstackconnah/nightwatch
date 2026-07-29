"use client";

import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { fetcher } from "@/lib/client";
import { formatBytes, relativeTime } from "@/lib/format";

interface ImageRow {
  id: string;
  tags: string[];
  size: number;
  created: number;
  inUse: boolean;
}

export default function ImagesPage() {
  const { data, error } = useSWR<{ images: ImageRow[] }>("/api/docker/images", fetcher, {
    refreshInterval: 30000,
  });

  const total = (data?.images ?? []).reduce((a, i) => a + i.size, 0);
  const dangling = (data?.images ?? []).filter((i) => !i.inUse);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Images</h1>
        <p className="text-xs text-ink-dim mt-0.5">
          {data
            ? `${data.images.length} images · ${formatBytes(total, 1)} total · ${dangling.length} unused`
            : "…"}
        </p>
      </header>

      {error && <div className="panel p-4 text-bad text-sm">{error.message}</div>}

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Tag", "Size", "Created", "Status"].map((h) => (
                <th key={h} className="microlabel text-left px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.images ?? []).map((img) => (
              <tr key={img.id} className="border-b border-line/50 last:border-0 hover:bg-panel-2/60">
                <td className="px-3 py-2 font-mono text-xs">
                  {img.tags.length ? (
                    img.tags.map((t) => <div key={t}>{t}</div>)
                  ) : (
                    <span className="text-ink-faint">{img.id.replace("sha256:", "").slice(0, 12)} (untagged)</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-ink-dim">{formatBytes(img.size, 0)}</td>
                <td className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
                  {relativeTime(img.created * 1000)}
                </td>
                <td className="px-3 py-2">
                  {img.inUse ? <Badge variant="ok">in use</Badge> : <Badge>unused</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
