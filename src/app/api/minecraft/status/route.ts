import { NextResponse } from "next/server";
import { mcManager, type McInstance } from "@/lib/minecraft/manager";
import { rconCommand, parsePlayerList } from "@/lib/minecraft/rcon";
import { loadConfig } from "@/lib/config";
import { isProbeOk } from "@/lib/integration-client";

export const dynamic = "force-dynamic";

/**
 * Merges mc-manager's instance list with a live RCON `list` — the two are
 * independent upstreams (manager HTTP API vs. the running server's RCON
 * port) and either can be down while the other is fine, so this always
 * returns 200 and reports each independently rather than failing the whole
 * request when one is unavailable. A booting modpack refuses RCON
 * connections for minutes; that is normal, not an error, hence "unavailable"
 * rather than surfacing the rcon rejection's message.
 */
export async function GET() {
  const mc = loadConfig().minecraft;
  const rconConfigured = Boolean(mc?.rconHost && mc?.rconPassword);

  const rconPromise: Promise<string | null> = rconConfigured
    ? rconCommand({
        host: mc!.rconHost!,
        port: mc?.rconPort ?? 25575,
        password: mc!.rconPassword!,
        command: "list",
        timeoutMs: 3000,
      })
    : Promise.resolve(null);

  const [instancesResult, rconResult] = await Promise.allSettled([mcManager.instances(), rconPromise]);

  let manager: "ok" | "unconfigured" | "unreachable" | "unauthorized" = "unreachable";
  let managerDetail: string | undefined;
  let instances: McInstance[] = [];
  let active: string | null = null;

  if (instancesResult.status === "fulfilled") {
    const probe = instancesResult.value;
    if (isProbeOk(probe)) {
      manager = "ok";
      instances = probe.data.instances;
      active = probe.data.active;
    } else {
      manager = probe.status;
      managerDetail = probe.detail;
    }
  } else {
    // mcManager.instances() resolves — never rejects — per IntegrationClient's
    // contract, but this branch is kept as a defensive fallback rather than
    // asserted away.
    managerDetail = instancesResult.reason instanceof Error ? instancesResult.reason.message : String(instancesResult.reason);
  }

  let rcon: "ok" | "unavailable" | "unconfigured" = "unconfigured";
  let players: { online: number; max: number; players: string[] } | null = null;

  if (rconConfigured) {
    if (rconResult.status === "fulfilled" && typeof rconResult.value === "string") {
      rcon = "ok";
      players = parsePlayerList(rconResult.value);
    } else {
      rcon = "unavailable";
    }
  }

  return NextResponse.json({
    manager,
    ...(managerDetail ? { managerDetail } : {}),
    instances,
    active,
    players,
    rcon,
  });
}
