/**
 * The /minecraft page's one-glance card: which pack is active (name, source,
 * MC version, memory), the container's own lifecycle state (via the same
 * ContainerStatus/LifecycleActions the containers table uses), and a single
 * line for "what's happening right now" — players online, booting, or
 * stopped. Kept to one fact per line rather than a dense table: this card is
 * read before every other one on the page.
 */
"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ContainerStatus,
  LifecycleActions,
  LifecycleError,
  type Lifecycle,
} from "@/components/resources/container-controls";
import type { MinecraftStatusResponse, TiledContainer } from "@/lib/client";

const SOURCE_VARIANT = { curseforge: "accent", modrinth: "blue", upload: "neutral" } as const;

/**
 * Exactly one of: players online (rcon ok), booting (container running but
 * rcon hasn't answered yet — normal for the first few minutes of a modpack
 * boot), or stopped. rcon === "unconfigured" while running falls through to
 * null — ContainerStatus's own "up Xh" already says it's running, and the
 * Console card explains the missing RCON config.
 */
function statusLine(status: MinecraftStatusResponse, container: TiledContainer | undefined): string | null {
  if (!container || container.state !== "running") return "stopped";
  if (status.rcon === "ok" && status.players) {
    const { online, max, players } = status.players;
    return players.length > 0 ? `${online} / ${max} — ${players.join(", ")}` : `${online} / ${max}`;
  }
  if (status.rcon === "unavailable") return "booting — console unavailable";
  return null;
}

export function StatusCard({
  status,
  container,
  lifecycle,
}: {
  status: MinecraftStatusResponse;
  container: TiledContainer | undefined;
  lifecycle: Lifecycle;
}) {
  const active = status.instances.find((i) => i.slug === status.active);
  const line = statusLine(status, container);

  // 143 is 128+SIGTERM — an operator-requested stop, not a crash. Same
  // convention as ContainerStatus's own exit-code read.
  const cleanExit = container?.exitCode == null || container.exitCode === 0 || container.exitCode === 143;
  const installFailed = Boolean(active) && container?.state === "exited" && !cleanExit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server</CardTitle>
        {container && <LifecycleActions state={container.state} name={container.name} lifecycle={lifecycle} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {active ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink font-medium">{active.name}</span>
            <Badge variant={SOURCE_VARIANT[active.source]}>{active.source}</Badge>
            <Badge variant="neutral">{active.mcVersion || "—"}</Badge>
            <Badge variant="neutral">{active.memoryGb} GB</Badge>
          </div>
        ) : (
          <p className="text-xs text-ink-faint">No pack active — pick one below.</p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {container ? (
            <ContainerStatus c={container} />
          ) : (
            <span className="font-mono text-ink-dim text-xs">no minecraft container found</span>
          )}
          {line && <span className="text-xs text-ink-dim">{line}</span>}
        </div>

        {installFailed && (
          <p className="text-xs text-bad">
            Install failed — check the log below for files that need manual download.
          </p>
        )}

        <LifecycleError lifecycle={lifecycle} className="!text-xs" />
      </CardContent>
    </Card>
  );
}
