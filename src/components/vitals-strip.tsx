"use client";

import { ArrowDown, ArrowUp, Clock, Cpu, MemoryStick, Thermometer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, Meter } from "@/components/charts";
import { useHost } from "@/lib/client";
import { formatBytes, formatRate, formatUptime } from "@/lib/format";

export function VitalsStrip() {
  const { data: host, error } = useHost(5000);

  if (error) {
    return (
      <Card className="p-4 text-bad text-sm">
        Host metrics unavailable: {error.message}
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {/* CPU */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Cpu size={11} /> CPU
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Gauge percent={host?.cpu.percent ?? 0} label="load" />
          <div className="min-w-0 text-xs text-ink-dim space-y-0.5">
            <div className="truncate" title={host?.cpu.model}>
              {host?.cpu.model ?? "…"}
            </div>
            <div className="font-mono">{host?.cpu.cores ?? "–"} cores</div>
            {host?.tempC != null && (
              <div className="flex items-center gap-1 font-mono">
                <Thermometer size={11} className={host.tempC > 80 ? "text-bad" : host.tempC > 65 ? "text-warn" : "text-accent"} />
                {host.tempC.toFixed(0)}°C
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Memory */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <MemoryStick size={11} /> Memory
          </CardTitle>
          <span className="font-mono text-xs text-ink-dim">
            {host ? `${(host.memory.percent).toFixed(0)}%` : "…"}
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          <Meter percent={host?.memory.percent ?? 0} />
          <div className="font-mono text-xs text-ink-dim">
            {host ? `${formatBytes(host.memory.used)} / ${formatBytes(host.memory.total)}` : "…"}
          </div>
        </CardContent>
      </Card>

      {/* Disk */}
      <Card>
        <CardHeader>
          <CardTitle>Disk</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(host?.disk ?? []).slice(0, 3).map((d) => (
            <div key={d.mount}>
              <div className="flex justify-between text-xs font-mono text-ink-dim mb-0.5">
                <span className="truncate">{d.mount}</span>
                <span>
                  {formatBytes(d.used, 0)}/{formatBytes(d.total, 0)}
                </span>
              </div>
              {d.mounts && d.mounts.length > 1 && (
                <div className="text-[0.625rem] text-ink-faint truncate mb-0.5">
                  {d.mounts.join(" · ")}
                </div>
              )}
              <Meter percent={d.percent} warnAt={85} badAt={95} />
            </div>
          ))}
          {!host && <div className="text-xs text-ink-faint">…</div>}
        </CardContent>
      </Card>

      {/* Network */}
      <Card>
        <CardHeader>
          <CardTitle>Network</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 font-mono text-sm">
          <div className="flex items-center gap-2">
            <ArrowDown size={13} className="text-accent" />
            {host ? formatRate(host.network.rxPerSec) : "…"}
          </div>
          <div className="flex items-center gap-2">
            <ArrowUp size={13} className="text-blue" />
            {host ? formatRate(host.network.txPerSec) : "…"}
          </div>
        </CardContent>
      </Card>

      {/* Host */}
      <Card className="col-span-1 min-[420px]:col-span-2 lg:col-span-4 xl:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Clock size={11} /> Host
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          <div className="font-mono text-ink">{host?.hostname ?? "…"}</div>
          <div className="text-ink-dim truncate" title={host?.os}>
            {host?.os ?? "…"}
          </div>
          <div className="font-mono text-accent">
            up {host ? formatUptime(host.uptimeSeconds) : "…"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
