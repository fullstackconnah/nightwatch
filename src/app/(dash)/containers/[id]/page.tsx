"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowLeft,
  ExternalLink,
  Play,
  RotateCw,
  ScrollText,
  Square,
} from "lucide-react";
import { Badge, stateBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Sparkline } from "@/components/charts";
import { fetcher, postJson, useContainers, useWidgets, type ContainerStatsSnapshot } from "@/lib/client";
import { formatBytes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Inspect {
  id: string;
  name: string;
  image: string;
  created: string;
  state: {
    status: string;
    running: boolean;
    startedAt: string;
    exitCode: number;
    health: string | null;
    restartCount: number;
    oomKilled: boolean;
  };
  restartPolicy: string;
  networkMode: string;
  composeProject: string | null;
  composeService: string | null;
  ports: { container: string; host: string[] }[];
  mounts: { source: string; destination: string; rw: boolean; type: string }[];
  env: string[];
  cmd: string;
}

const MAX_POINTS = 60;

function useStatsHistory(id: string, running: boolean) {
  const [history, setHistory] = useState<ContainerStatsSnapshot[]>([]);
  useEffect(() => {
    if (!running) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const res = await fetch(`/api/docker/containers/${id}/stats`);
        if (res.ok && alive) {
          const snap = (await res.json()) as ContainerStatsSnapshot;
          setHistory((h) => [...h, snap].slice(-MAX_POINTS));
        }
      } catch {
        // container may be mid-restart; keep polling
      }
      if (alive) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, running]);
  return history;
}

function Logs({ id, name }: { id: string; name: string | null }) {
  const [tail, setTail] = useState(200);
  const [paused, setPaused] = useState(false);
  const { data } = useSWR<{ logs: string }>(
    paused ? null : `/api/docker/containers/${id}/logs?tail=${tail}`,
    fetcher,
    { refreshInterval: 5000, keepPreviousData: true },
  );
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <ScrollText size={11} /> Logs
        </CardTitle>
        <div className="flex items-center gap-2">
          {/* Hand-off to the multi-container console. This card stays as it is —
              one container, polled, good enough for a quick look — and the link
              is how you get from here to watching this alongside others live. */}
          {name && (
            <Link
              href={`/logs?c=${encodeURIComponent(name)}`}
              className="text-[0.7rem] text-ink-faint hover:text-accent transition-colors whitespace-nowrap"
            >
              open in console
            </Link>
          )}
          <Select
            className="h-9 w-28 text-sm md:h-6 md:w-24 md:text-xs"
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
          >
            {[100, 200, 500, 1000, 5000].map((n) => (
              <option key={n} value={n}>
                tail {n}
              </option>
            ))}
          </Select>
          <Button size="sm" variant={paused ? "warn" : "ghost"} onClick={() => setPaused(!paused)}>
            {paused ? "resume" : "pause"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={boxRef} className="logbox bg-bg rounded-md border border-line p-3 h-72 md:h-96 overflow-y-auto text-ink-dim">
          {data?.logs || "no output"}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ContainerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: info, error, mutate } = useSWR<Inspect>(`/api/docker/containers/${id}`, fetcher, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });
  const { data: containersData } = useContainers(10000);
  const { data: widgetData } = useWidgets(20000);
  const [busy, setBusy] = useState<string | null>(null);
  const [showEnv, setShowEnv] = useState(false);

  const history = useStatsHistory(id, info?.state.running ?? false);
  const latest = history[history.length - 1];

  // net rates from cumulative counters
  const netRates = history.slice(1).map((s, i) => {
    const prev = history[i];
    const dt = (s.ts - prev.ts) / 1000 || 1;
    return { rx: Math.max(0, (s.rxBytes - prev.rxBytes) / dt), tx: Math.max(0, (s.txBytes - prev.txBytes) / dt) };
  });

  const listEntry = containersData?.containers.find((c) => c.id.startsWith(id));
  const widget = listEntry ? widgetData?.widgets[listEntry.name] : undefined;

  async function act(action: "start" | "stop" | "restart") {
    setBusy(action);
    try {
      await postJson(`/api/docker/containers/${id}/action`, { action });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/containers" className="text-xs text-ink-dim hover:text-accent flex items-center gap-1">
          <ArrowLeft size={12} /> containers
        </Link>
        <div className="panel p-6 text-bad text-sm">Container not found: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/containers" className="text-xs text-ink-dim hover:text-accent inline-flex items-center gap-1">
        <ArrowLeft size={12} /> containers
      </Link>

      {/* header */}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold font-mono">{info?.name ?? id}</h1>
        {info && (
          <Badge variant={stateBadgeVariant(info.state.status, info.state.health)}>
            {info.state.health === "unhealthy" ? "unhealthy" : info.state.status}
          </Badge>
        )}
        {info?.state.oomKilled && <Badge variant="bad">OOM killed</Badge>}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {listEntry?.tile.url && (
            <a href={listEntry.tile.url} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <ExternalLink size={13} /> Open app
              </Button>
            </a>
          )}
          {info?.state.running ? (
            <>
              <Button variant="outline" disabled={!!busy} onClick={() => act("restart")}>
                <RotateCw size={13} className={busy === "restart" ? "animate-spin" : ""} /> Restart
              </Button>
              <Button variant="danger" disabled={!!busy} onClick={() => act("stop")}>
                <Square size={13} /> Stop
              </Button>
            </>
          ) : (
            <Button disabled={!!busy} onClick={() => act("start")}>
              <Play size={13} /> Start
            </Button>
          )}
        </div>
      </header>

      {/* live graphs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>CPU</CardTitle>
            <span className="font-mono text-xs text-accent">
              {latest ? `${latest.cpuPercent.toFixed(1)}%` : "—"}
            </span>
          </CardHeader>
          <CardContent>
            <Sparkline data={history.map((s) => s.cpuPercent)} max={Math.max(100, ...history.map((s) => s.cpuPercent))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Memory</CardTitle>
            <span className="font-mono text-xs text-accent">
              {latest ? formatBytes(latest.memUsage) : "—"}
            </span>
          </CardHeader>
          <CardContent>
            <Sparkline
              data={history.map((s) => s.memUsage)}
              max={latest?.memLimit || undefined}
              stroke="var(--color-blue)"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Network rx/tx</CardTitle>
            <span className="font-mono text-xs text-ink-dim">
              {netRates.length
                ? `${formatBytes(netRates[netRates.length - 1].rx)}/s · ${formatBytes(netRates[netRates.length - 1].tx)}/s`
                : "—"}
            </span>
          </CardHeader>
          <CardContent className="relative">
            <Sparkline data={netRates.map((r) => r.rx)} stroke="var(--color-accent)" height={24} />
            <Sparkline data={netRates.map((r) => r.tx)} stroke="var(--color-blue)" height={24} />
          </CardContent>
        </Card>
      </div>

      {/* widget + metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
              {(
                [
                  ["Image", info?.image],
                  ["Created", info ? relativeTime(info.created) : "…"],
                  ["Started", info?.state.running ? relativeTime(info.state.startedAt) : "—"],
                  ["Restart count", info ? String(info.state.restartCount) : "…"],
                  ["Restart policy", info?.restartPolicy],
                  ["Network mode", info?.networkMode],
                  [
                    "Compose stack",
                    info?.composeProject
                      ? `${info.composeProject} / ${info.composeService ?? ""}`
                      : "— (not compose-managed)",
                  ],
                  ["Command", info?.cmd || "—"],
                  ["PIDs", latest ? String(latest.pids) : "—"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="microlabel">{k}</dt>
                  <dd className="font-mono text-ink-dim break-all">{v ?? "…"}</dd>
                </div>
              ))}
            </dl>

            {info && info.ports.length > 0 && (
              <>
                <div className="microlabel mt-4 mb-1.5">Ports</div>
                <div className="font-mono text-xs text-ink-dim space-y-0.5">
                  {info.ports.map((p) => (
                    <div key={p.container}>
                      {p.container} {p.host.length ? `← ${p.host.join(", ")}` : "(not published)"}
                    </div>
                  ))}
                </div>
              </>
            )}

            {info && info.mounts.length > 0 && (
              <>
                <div className="microlabel mt-4 mb-1.5">Mounts</div>
                <div className="font-mono text-xs text-ink-dim space-y-0.5">
                  {info.mounts.map((m, i) => (
                    <div key={i} className="break-all">
                      {m.source} → {m.destination}
                      {!m.rw && <span className="text-warn"> :ro</span>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {info && info.env.length > 0 && (
              <>
                <button
                  className="microlabel mt-4 mb-1.5 cursor-pointer hover:text-accent block"
                  onClick={() => setShowEnv(!showEnv)}
                >
                  Environment ({info.env.length}) {showEnv ? "▾" : "▸ click to reveal"}
                </button>
                {showEnv && (
                  <div className="font-mono text-xs text-ink-dim space-y-0.5">
                    {info.env.map((e, i) => (
                      <div key={i} className="break-all">
                        {e}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Service widget</CardTitle>
          </CardHeader>
          <CardContent>
            {widget && !widget.error && widget.fields.length > 0 ? (
              <div className="space-y-2">
                {widget.fields.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between">
                    <span className="microlabel">{f.label}</span>
                    <span
                      className={cn(
                        "font-mono text-sm",
                        f.intent === "warn" && "text-warn",
                        f.intent === "ok" && "text-accent",
                      )}
                    >
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-faint">
                {widget?.error
                  ? `widget error: ${widget.error}`
                  : "No widget configured. Add one in Settings or via dashboard.widget.* labels."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Logs id={id} name={info?.name ?? null} />
    </div>
  );
}
