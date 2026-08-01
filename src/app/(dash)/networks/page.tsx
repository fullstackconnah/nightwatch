"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Check, ChevronDown, Plus } from "lucide-react";
import { ListeningPorts } from "@/components/listening-ports";
import { NetConnections } from "@/components/net-connections";
import { NetCompare, type CompareContainer } from "@/components/net-compare";
import {
  RateReadout,
  RX_GLYPH,
  TX_GLYPH,
  ThroughputChart,
  interfaceSeries,
  seriesIsIdle,
  seriesPeak,
} from "@/components/net-throughput";
import { fetcher, useContainers, useNetwork, useTelemetryStream } from "@/lib/client";
import { formatBytes, formatPercent, formatRate } from "@/lib/format";
import type { NetInterface } from "@/lib/network-types";
import type { TelemetrySample } from "@/lib/telemetry-types";
import { cn } from "@/lib/utils";

/**
 * The page reads as the path a packet actually takes through this box: the uplink
 * at the top, the docker bridges behind it, the containers behind those, and last
 * what is listening. A flat grid of identical interface cards would hide the one
 * fact that matters most — every byte below the uplink is a second view of a byte
 * already counted above it, so the sections are ordered, not equal.
 */

interface DockerNetworkRow {
  id: string;
  name: string;
  driver: string;
  subnet: string | null;
  internal: boolean;
  containers: string[];
}

/** Latest per-interface rate in the telemetry ring, or zeros before the first tick. */
function latestRate(samples: TelemetrySample[], iface: string): { rx: number; tx: number } {
  for (let i = samples.length - 1; i >= 0; i--) {
    const row = samples[i].interfaces?.[iface];
    if (row) return { rx: row.rxRate, tx: row.txRate };
  }
  return { rx: 0, tx: 0 };
}

/** Bytes/sec a link carries in ONE direction. Ethernet is full duplex, so this is
 *  the ceiling for rx and for tx separately — never for their sum. */
function linkCapacityBytes(speedMbps: number | null): number | null {
  if (speedMbps === null || speedMbps <= 0) return null;
  return (speedMbps * 1_000_000) / 8;
}

function ErrorCounters({ iface }: { iface: NetInterface }) {
  const errs = iface.rxErrors + iface.txErrors;
  const drops = iface.rxDropped + iface.txDropped;
  if (errs === 0 && drops === 0) return null;
  return (
    <span className="font-mono text-[0.7rem] text-warn whitespace-nowrap">
      {errs > 0 && `${errs} err`}
      {errs > 0 && drops > 0 && " · "}
      {drops > 0 && `${drops} dropped`}
      <span className="text-ink-faint"> since boot</span>
    </span>
  );
}

function UplinkBand({
  iface,
  members,
  samples,
}: {
  iface: NetInterface;
  members: NetInterface[];
  samples: TelemetrySample[];
}) {
  const series = useMemo(() => interfaceSeries(samples, iface.name), [samples, iface.name]);
  const peak = seriesPeak(series);
  const now = latestRate(samples, iface.name);
  const capacity = linkCapacityBytes(iface.speedMbps);
  // Utilisation measures the busier direction, not rx+tx: on a full-duplex link
  // 125 MB/s each way at once is 100% both ways, not 200% of anything.
  const busier = Math.max(now.rx, now.tx);
  const utilisation = capacity ? Math.min(100, (busier / capacity) * 100) : null;

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-mono text-base font-semibold tracking-tight">{iface.name}</h2>
            <span className={cn("dot", iface.state === "up" ? "dot-running" : "dot-dead")} />
            <span className="text-xs text-ink-dim">
              {iface.speedMbps ? `${iface.speedMbps} Mb/s link` : "link rate unknown"}
            </span>
          </div>
          <p className="text-[0.7rem] text-ink-faint mt-1">
            uplink · everything this machine sends to or receives from the network crosses here
          </p>
        </div>
        <RateReadout rx={now.rx} tx={now.tx} size="lg" />
      </div>

      <div className="mt-4">
        <ThroughputChart series={series} peak={peak} height={104} reveal />
        <div className="flex items-center justify-between gap-3 mt-1.5">
          <span className="microlabel">
            60s · {RX_GLYPH} received above · {TX_GLYPH} sent below
          </span>
          <span className="font-mono text-[0.7rem] text-ink-faint tabular-nums whitespace-nowrap">
            {seriesIsIdle(series) ? "no traffic in the window" : `peak ${formatRate(peak)}`}
          </span>
        </div>
      </div>

      {utilisation !== null && capacity !== null && (
        <div className="mt-5 pt-4 border-t border-line">
          <div className="flex items-baseline justify-between gap-3">
            <span className="microlabel">link utilisation</span>
            <span className="font-mono text-xs tabular-nums">
              {formatPercent(utilisation, 1)}
              <span className="text-ink-faint"> of {formatRate(capacity)} each way</span>
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-line/60 overflow-hidden mt-2">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.max(utilisation, 0.4)}%`,
                background: utilisation >= 85 ? "var(--color-warn)" : "var(--color-accent)",
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-mono text-[0.7rem] text-ink-dim tabular-nums">
          {formatBytes(iface.rxBytes)} {RX_GLYPH} · {formatBytes(iface.txBytes)} {TX_GLYPH}
          <span className="text-ink-faint"> since boot</span>
        </span>
        <ErrorCounters iface={iface} />
        {iface.addresses.map((a) => (
          <span key={a} className="font-mono text-[0.7rem] text-ink-faint">
            {a}
          </span>
        ))}
      </div>

      {members.length > 0 && (
        <p className="mt-3 pt-3 border-t border-line/60 text-[0.7rem] text-ink-faint">
          Carried by{" "}
          {members.map((m, i) => (
            <span key={m.name}>
              {i > 0 && ", "}
              <span className="font-mono text-ink-dim">{m.name}</span>
              {m.speedMbps ? ` (${m.speedMbps} Mb/s)` : ""}
            </span>
          ))}
          . The same packets — counted once, here.
        </p>
      )}
    </section>
  );
}

function BridgeRow({
  iface,
  network,
  samples,
}: {
  iface: NetInterface;
  network: DockerNetworkRow | undefined;
  samples: TelemetrySample[];
}) {
  const series = useMemo(() => interfaceSeries(samples, iface.name), [samples, iface.name]);
  const peak = seriesPeak(series);
  const idle = seriesIsIdle(series);
  const now = latestRate(samples, iface.name);
  const name = network?.name ?? iface.label ?? iface.name;
  const renamed = name !== iface.name;
  const attached = network ? network.containers.length : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3 py-3 border-b border-line/50 last:border-0">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-sm truncate" title={name}>
            {name}
          </span>
          {iface.state !== "up" && <span className="microlabel shrink-0">{iface.state}</span>}
        </div>
        {/* Two lines rather than one: at 17rem the raw bridge name, the subnet and
            the attached count all fit only by ellipsing the count away, and the
            count is the part that tells you whether the bridge matters. */}
        <div className="font-mono text-[0.65rem] text-ink-faint truncate">
          {renamed ? iface.name : (network?.subnet ?? "subnet unknown")}
        </div>
        <div className="font-mono text-[0.65rem] text-ink-faint truncate">
          {renamed && network?.subnet ? `${network.subnet} · ` : ""}
          {attached === null
            ? "not a docker network"
            : `${attached} ${attached === 1 ? "container" : "containers"}`}
        </div>
      </div>

      <div className="order-last md:order-none col-span-2 md:col-span-1 min-w-0">
        <ThroughputChart series={series} peak={peak} height={34} />
      </div>

      <div className="text-right shrink-0">
        <RateReadout rx={now.rx} tx={now.tx} className="justify-end" />
        <div className="font-mono text-[0.65rem] text-ink-faint tabular-nums mt-0.5">
          {idle ? "idle" : `peak ${formatRate(peak)}`}
        </div>
      </div>
    </div>
  );
}

interface FootprintRow {
  id: string;
  name: string;
  /** Other containers sharing this row's network namespace, so the same bytes are
   *  attributed once but the sharers are still named. */
  sharing: string[];
  rx: number;
  tx: number;
}

const COMPARE_MAX = 4;

function ContainerFootprint({ samples }: { samples: TelemetrySample[] }) {
  const { data } = useContainers(15000);
  const latest = samples.length > 0 ? samples[samples.length - 1] : undefined;
  // Client-state only, no URL/persistence: this is a scratch comparison, not
  // a view worth bookmarking. Order is selection order, not row order, so a
  // container keeps its colour while it stays selected regardless of what
  // else gets added or removed around it.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPARE_MAX) return prev;
      return [...prev, id];
    });
  };

  const rows = useMemo<FootprintRow[]>(() => {
    if (!latest) return [];
    const containers = data?.containers ?? [];
    const nameById = new Map(containers.map((c) => [c.id, c.name]));

    // Containers sharing a network namespace report IDENTICAL docker network
    // counters, because there is only one namespace to count. The *arr stack runs
    // through the VPN container (`network_mode: service:gluetun` → docker's
    // `container:<id>`), so five containers each report gluetun's bytes; summing
    // them would count the same traffic five times and hand every one of them an
    // equal, wrong share of the bar. This is the same double-count the interface
    // roles exist to prevent, arriving from the other direction.
    //
    // Host-network containers are excluded outright: their "container" counters
    // are the whole box's, which does not belong in a per-container breakdown.
    const groups = new Map<string, FootprintRow>();
    for (const c of containers) {
      if (c.networkMode === "host") continue;
      const shared = c.networkMode?.startsWith("container:")
        ? c.networkMode.slice("container:".length)
        : null;
      const ownerId = shared ?? c.id;
      const row = latest.containers[c.id];
      const existing = groups.get(ownerId);
      if (existing) {
        // The namespace owner names the row when it is itself running; otherwise
        // the first sharer we saw keeps the name and the rest are listed.
        if (ownerId === c.id) {
          existing.sharing.push(existing.name);
          existing.name = c.name;
          existing.id = c.id;
        } else {
          existing.sharing.push(c.name);
        }
        // Counters are identical across the group by definition; keep the first
        // non-zero reading rather than adding, and never overwrite it with a zero
        // (a sharer whose stats have not been sampled yet reports nothing).
        if (existing.rx + existing.tx === 0 && row) {
          existing.rx = row.rxRate;
          existing.tx = row.txRate;
        }
      } else {
        groups.set(ownerId, {
          id: c.id,
          name: c.name,
          sharing: [],
          rx: row?.rxRate ?? 0,
          tx: row?.txRate ?? 0,
        });
      }
    }

    // A sharer whose owner is not in the container list (stopped, or filtered out)
    // still deserves its real name rather than the owner's id.
    for (const [ownerId, row] of groups) {
      const ownerName = nameById.get(ownerId);
      if (ownerName && row.name !== ownerName) row.name = ownerName;
    }

    return [...groups.values()]
      .filter((r) => r.rx + r.tx > 0)
      .sort((a, b) => b.rx + b.tx - (a.rx + a.tx));
  }, [data, latest]);

  const total = rows.reduce((a, r) => a + r.rx + r.tx, 0);

  if (total === 0) {
    return (
      <div className="panel p-4">
        <h2 className="text-sm font-semibold tracking-tight">Container footprint</h2>
        <p className="text-sm text-ink-dim mt-1">
          {samples.length === 0
            ? "Waiting for the first telemetry tick…"
            : "No container is moving traffic right now."}
        </p>
      </div>
    );
  }

  // A share bar, not another ranked bar chart: the question on this page is "who is
  // the traffic", not "who is biggest" — the ranking already lives on /resources.
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8);
  const restTotal = rest.reduce((a, r) => a + r.rx + r.tx, 0);
  // Teal → sky: the two hues this console already uses for rx and tx. Hue alone
  // cannot separate eight segments inside a 33° span — adjacent ones came out
  // indistinguishable and the bar read as one solid block — so lightness does most
  // of the work and hue carries the direction of travel. Extending the hue range
  // instead would reach magenta, which belongs to no other surface in this app.
  const hue = (i: number) => {
    const t = shown.length > 1 ? i / (shown.length - 1) : 0;
    return `hsl(${(172 + t * 33).toFixed(0)} ${(70 - t * 18).toFixed(0)}% ${(70 - t * 34).toFixed(0)}%)`;
  };

  const compareContainers: CompareContainer[] = compareIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is FootprintRow => Boolean(r))
    .map((r) => ({ id: r.id, name: r.name }));

  return (
    <div className="space-y-3">
      {compareContainers.length > 0 && <NetCompare containers={compareContainers} samples={samples} />}

      <section className="panel p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold tracking-tight">Container footprint</h2>
          <span className="font-mono text-xs text-ink-dim tabular-nums">
            {formatRate(total)}{" "}
            <span className="text-ink-faint">across {rows.length} namespaces</span>
          </span>
        </div>
        <p className="text-[0.7rem] text-ink-faint mt-0.5">
          one row per network namespace, not per container — containers behind a VPN
          container report its counters, and host-network containers are left out
          {shown.length > 0 && " · select up to 4 to compare their throughput above"}
        </p>

        <div className="flex h-2.5 w-full rounded-full overflow-hidden mt-3 bg-line/60">
          {shown.map((r, i) => (
            <div
              key={r.id}
              title={`${r.name}: ${formatRate(r.rx + r.tx)}`}
              style={{ width: `${((r.rx + r.tx) / total) * 100}%`, background: hue(i) }}
              className="transition-[width] duration-700 ease-out"
            />
          ))}
          {restTotal > 0 && (
            <div
              title={`${rest.length} others: ${formatRate(restTotal)}`}
              style={{ width: `${(restTotal / total) * 100}%`, background: "var(--color-ink-faint)" }}
            />
          )}
        </div>

        <ul className="mt-3 space-y-0.5">
          {shown.map((r, i) => {
            const isComparing = compareIds.includes(r.id);
            const atCap = !isComparing && compareIds.length >= COMPARE_MAX;
            return (
              <li key={r.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleCompare(r.id)}
                  disabled={atCap}
                  aria-pressed={isComparing}
                  aria-label={
                    isComparing
                      ? `Remove ${r.name} from the comparison chart`
                      : `Add ${r.name} to the comparison chart`
                  }
                  title={
                    atCap
                      ? "Comparison is full — remove one to add another"
                      : isComparing
                        ? "In the comparison chart — click to remove"
                        : "Add to the comparison chart"
                  }
                  className={cn(
                    "h-11 w-11 md:h-7 md:w-7 shrink-0 rounded-md inline-flex items-center justify-center",
                    "outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer",
                    isComparing
                      ? "border border-dashed border-line-bright bg-transparent"
                      : "border border-line bg-panel-2 hover:border-line-bright",
                    atCap && "opacity-40 cursor-not-allowed pointer-events-none",
                  )}
                >
                  {isComparing ? (
                    <Check size={13} className="text-ink-faint" aria-hidden />
                  ) : (
                    <Plus size={13} className="text-ink-faint" aria-hidden />
                  )}
                </button>
                <Link
                  href={`/containers/${r.id}`}
                  /* Wraps below sm: the rate pair needs ~11rem, which on a 390px
                     phone left the name so narrow that "homelab-dashboard" and
                     "homelab-dashboard-proxy" both truncated to the same string —
                     two different rows rendering identically. */
                  className="flex flex-1 flex-wrap sm:flex-nowrap items-center gap-x-2.5 gap-y-0.5 rounded px-1 -mx-1 py-1.5 hover:bg-panel-2 min-h-11 md:min-h-0 min-w-0"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ background: hue(i) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 basis-[calc(100%-1.5rem)] sm:basis-auto">
                    <span className="font-mono text-xs truncate block">{r.name}</span>
                    {r.sharing.length > 0 && (
                      <span
                        className="text-[0.65rem] text-ink-faint truncate block"
                        title={`Shares ${r.name}'s network namespace: ${r.sharing.join(", ")}`}
                      >
                        shared with {r.sharing.join(", ")}
                      </span>
                    )}
                  </span>
                  <RateReadout rx={r.rx} tx={r.tx} className="shrink-0" />
                </Link>
              </li>
            );
          })}
          {restTotal > 0 && (
            <li className="flex items-center gap-2.5 px-1 py-1.5">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0 bg-ink-faint" aria-hidden />
              <span className="text-xs text-ink-faint flex-1">{rest.length} others</span>
              <span className="font-mono text-xs text-ink-faint tabular-nums">
                {formatRate(restTotal)}
              </span>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

export default function NetworkPage() {
  const { data: snapshot, error } = useNetwork();
  const { samples, status } = useTelemetryStream();
  const { data: dockerNets } = useSWR<{ networks: DockerNetworkRow[] }>(
    "/api/docker/networks",
    fetcher,
    { refreshInterval: 30000 },
  );
  const [showVirtual, setShowVirtual] = useState(false);

  const interfaces = useMemo(() => snapshot?.interfaces ?? [], [snapshot]);
  const uplinks = interfaces.filter((i) => i.role === "uplink");
  const slaves = interfaces.filter((i) => i.role === "bond-slave");
  const bridges = useMemo(
    () => interfaces.filter((i) => i.role === "docker-bridge"),
    [interfaces],
  );
  const virtual = useMemo(
    () => interfaces.filter((i) => i.role === "virtual-link"),
    [interfaces],
  );

  // A bridge's name carries its docker network id: br-<first 12 hex>, and docker0 is
  // the network literally named "bridge". Joining here gives every bridge its stack
  // name and its attached containers without the collector needing either.
  const netByBridge = useMemo(() => {
    const map = new Map<string, DockerNetworkRow>();
    for (const n of dockerNets?.networks ?? []) {
      map.set(n.name === "bridge" ? "docker0" : `br-${n.id.slice(0, 12)}`, n);
    }
    return map;
  }, [dockerNets]);

  const sortedBridges = useMemo(() => {
    const load = (name: string) => {
      const r = latestRate(samples, name);
      return r.rx + r.tx;
    };
    return [...bridges].sort((a, b) => load(b.name) - load(a.name));
  }, [bridges, samples]);

  const virtualTotals = useMemo(() => {
    let rx = 0;
    let tx = 0;
    for (const v of virtual) {
      const r = latestRate(samples, v.name);
      rx += r.rx;
      tx += r.tx;
    }
    return { rx, tx };
  }, [virtual, samples]);

  return (
    <div className="space-y-5 pb-2">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Network</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            {snapshot
              ? `${interfaces.length} interfaces · ${snapshot.sockets.length} listening ports · ${snapshot.connections.length} remote peers`
              : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "dot",
              status === "live" ? "dot-running" : status === "lost" ? "dot-dead" : "dot-restarting",
            )}
          />
          <span className="microlabel">{status === "live" ? "live · 1 Hz" : status}</span>
        </div>
      </header>

      {error && <div className="panel p-4 text-bad text-sm">{error.message}</div>}
      {snapshot?.warnings.map((w) => (
        <div key={w} className="panel p-3 text-warn text-xs">
          {w}
        </div>
      ))}

      {!snapshot && !error && (
        <div className="panel p-4 text-sm text-ink-dim">Reading interfaces…</div>
      )}

      {uplinks.map((u) => (
        <UplinkBand
          key={u.name}
          iface={u}
          members={slaves.filter((s) => s.master === u.name)}
          samples={samples}
        />
      ))}

      {snapshot && uplinks.length === 0 && (
        <div className="panel p-4 text-sm text-ink-dim">
          No uplink interface identified — throughput below is per-bridge only.
        </div>
      )}

      {sortedBridges.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="px-3 pt-3 pb-2 border-b border-line">
            <h2 className="text-sm font-semibold tracking-tight">Docker networks</h2>
            <p className="text-[0.7rem] text-ink-faint mt-0.5">
              busiest first · {RX_GLYPH} is what the containers sent into the bridge, {TX_GLYPH} is
              what was delivered to them
            </p>
          </div>
          {sortedBridges.map((b) => (
            <BridgeRow key={b.name} iface={b} network={netByBridge.get(b.name)} samples={samples} />
          ))}
        </section>
      )}

      {virtual.length > 0 && (
        <div className="panel overflow-hidden">
          <button
            type="button"
            onClick={() => setShowVirtual((v) => !v)}
            aria-expanded={showVirtual}
            className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-panel-2/60 cursor-pointer min-h-11"
          >
            <ChevronDown
              size={14}
              className={cn(
                "text-ink-faint transition-transform shrink-0",
                showVirtual && "rotate-180",
              )}
            />
            <span className="text-xs text-ink-dim flex-1 min-w-0">
              {virtual.length} virtual links
              <span className="text-ink-faint"> — one per container, counted in the bridges above</span>
            </span>
            <RateReadout rx={virtualTotals.rx} tx={virtualTotals.tx} className="shrink-0" />
          </button>
          {showVirtual && (
            <div className="border-t border-line px-3 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {virtual.map((v) => {
                const r = latestRate(samples, v.name);
                return (
                  <span
                    key={v.name}
                    className="font-mono text-[0.65rem] text-ink-faint tabular-nums"
                  >
                    {v.name}
                    <span className="text-ink-dim"> {formatRate(r.rx + r.tx)}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ContainerFootprint samples={samples} />

      {snapshot ? (
        <NetConnections connections={snapshot.connections} available={snapshot.connectionsAvailable} />
      ) : (
        !error && <div className="panel p-4 text-sm text-ink-dim">Reading connections…</div>
      )}

      <ListeningPorts
        sockets={snapshot?.sockets ?? []}
        unavailable={Boolean(snapshot && snapshot.sockets.length === 0)}
      />
    </div>
  );
}
