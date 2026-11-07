import { listContainers } from "@/lib/docker";
import { throwingSnapshotRoute } from "@/lib/snapshot-route";

export const dynamic = "force-dynamic";

/**
 * Public container health counts for the ambient kiosk display — counts
 * only, never names, images or ports (those stay behind the real session,
 * same as everywhere else in the app). Mirrors the bucketing in
 * /api/docker/containers/route.ts (running/paused/restarting exhaust "not
 * stopped"; everything else, including dead, falls into `stopped`) and
 * additionally breaks `dead` out on its own, since the kiosk's attention
 * strip needs to name it specifically rather than lump it into "stopped".
 */
async function collectCounts() {
  const containers = await listContainers();
  const running = containers.filter((c) => c.state === "running").length;
  const paused = containers.filter((c) => c.state === "paused").length;
  const restarting = containers.filter((c) => c.state === "restarting").length;
  const dead = containers.filter((c) => c.state === "dead").length;
  const unhealthy = containers.filter((c) => c.health === "unhealthy").length;
  return {
    total: containers.length,
    running,
    paused,
    restarting,
    stopped: containers.length - running - paused - restarting,
    unhealthy,
    dead,
  };
}

// 502 with a fixed text; the real error is logged server-side only.
export const GET = throwingSnapshotRoute({ collect: collectCounts }, 502, "docker unreachable");
