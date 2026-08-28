"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useLifecycle } from "@/components/resources/container-controls";
import { StatusCard } from "@/components/minecraft/status-card";
import { PackBrowser } from "@/components/minecraft/pack-browser";
import { Console } from "@/components/minecraft/console";
import { BackupsPanel } from "@/components/minecraft/backups-panel";
import { fetcher, useContainers, useMinecraftStatus } from "@/lib/client";
import { cn } from "@/lib/utils";

const CONFIG_SNIPPET = `{
  "minecraft": {
    "managerUrl": "http://192.168.1.70:8090",
    "managerToken": "<MANAGER_TOKEN from the minecraft stack's secrets.env>",
    "rconHost": "192.168.1.70",
    "rconPort": 25575,
    "rconPassword": "<rcon password>",
    "curseforgeKey": "<optional — Modrinth search works without it>"
  }
}`;

/**
 * /minecraft — clone of ProxyUnconfigured (src/components/integrations/
 * proxy-status.tsx), pointed at the minecraft stack instead of NPM.
 */
function MinecraftUnconfigured() {
  return (
    <div className="panel p-4 space-y-3">
      <div className="text-sm text-warn font-medium">Minecraft manager not configured</div>
      <p className="text-xs text-ink-dim">
        Add a <span className="font-mono text-ink">minecraft</span> block to{" "}
        <span className="font-mono text-ink">data/config.json</span> — or fill it in under{" "}
        <span className="font-mono text-ink">Settings → Integrations</span> — with the mc-manager URL/token and RCON
        credentials. See the minecraft stack&apos;s DEPLOY.md for how mc-manager itself gets stood up.
      </p>
      <pre className="rounded-md bg-panel-2 border border-line px-3 py-2.5 font-mono text-xs text-ink-dim overflow-x-auto">
        {CONFIG_SNIPPET}
      </pre>
    </div>
  );
}

function statusCopy(status: "unreachable" | "unauthorized"): { headline: string; fix: string } {
  if (status === "unreachable") {
    return {
      headline: "mc-manager did not respond",
      fix: "Check the mc-manager container is running and that its managerUrl in Settings → Integrations is reachable from this container.",
    };
  }
  return {
    headline: "mc-manager rejected the request",
    fix: "Check managerToken in Settings → Integrations matches MANAGER_TOKEN in the minecraft stack's secrets.env.",
  };
}

function MinecraftError({ status, detail }: { status: "unreachable" | "unauthorized"; detail?: string }) {
  const copy = statusCopy(status);
  return (
    <div className="panel p-4 space-y-2">
      <div className="text-sm text-warn font-medium">{copy.headline}</div>
      <div className="text-xs text-ink-dim">{copy.fix}</div>
      {detail && <div className="font-mono text-xs text-ink-faint">{detail}</div>}
    </div>
  );
}

function MinecraftLoading() {
  return (
    <div className="panel p-6 text-xs text-ink-dim" aria-busy="true">
      Connecting to mc-manager…
    </div>
  );
}

/**
 * Verbatim copy of the containers/[id] detail page's Logs component (see
 * that file), bound to the minecraft container's id instead of the route
 * param — no new backend, same poll-tail GET.
 */
function Logs({ id, name }: { id: string; name: string }) {
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
          <Link
            href={`/logs?c=${encodeURIComponent(name)}`}
            className="text-[0.7rem] text-ink-faint hover:text-accent transition-colors whitespace-nowrap"
          >
            open in console
          </Link>
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
        <div
          ref={boxRef}
          className="logbox bg-bg rounded-md border border-line p-3 h-72 md:h-96 overflow-y-auto text-ink-dim"
        >
          {data?.logs || "no output"}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MinecraftPage() {
  const { data: status, error, mutate } = useMinecraftStatus();
  const { data: containersData, mutate: mutateContainers } = useContainers();
  const container = containersData?.containers.find((c) => c.name === "minecraft");

  const lifecycle = useLifecycle(container?.id ?? "", () => {
    void mutate();
    void mutateContainers();
  });

  const dotClass = !status
    ? "dot-restarting"
    : status.manager === "unreachable" || status.manager === "unauthorized"
      ? "dot-dead"
      : status.manager === "unconfigured"
        ? "dot-stopped"
        : container?.state === "running"
          ? "dot-running"
          : container?.state === "restarting"
            ? "dot-restarting"
            : "dot-stopped";

  const statusLabel = !status ? "connecting" : status.manager !== "ok" ? status.manager : (container?.state ?? "no container");

  return (
    <div className="space-y-5 pb-2">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Minecraft</h1>
          <p className="text-xs text-ink-dim mt-0.5">
            Modpack install/switch, RCON console, and world backups for the minecraft stack
          </p>
        </div>
        <span className="flex items-center gap-1.5">
          <span className={cn("dot", dotClass)} aria-hidden />
          <span className="microlabel">{statusLabel}</span>
        </span>
      </header>

      {error && (
        <MinecraftError status="unreachable" detail={error.message ?? "Could not reach /api/minecraft/status."} />
      )}

      {!error && !status && <MinecraftLoading />}

      {!error && status?.manager === "unconfigured" && <MinecraftUnconfigured />}

      {!error && status && (status.manager === "unreachable" || status.manager === "unauthorized") && (
        <MinecraftError status={status.manager} detail={status.managerDetail} />
      )}

      {!error && status?.manager === "ok" && (
        <>
          <StatusCard status={status} container={container} lifecycle={lifecycle} />
          <PackBrowser instances={status.instances} active={status.active} onChanged={() => void mutate()} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Console rcon={status.rcon} />
            <BackupsPanel containerState={container?.state} />
          </div>
          {container && <Logs id={container.id} name={container.name} />}
        </>
      )}
    </div>
  );
}
