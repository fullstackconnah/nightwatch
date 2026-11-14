/* Container health counts, shared by the public kiosk route and the desk glance.
 * Type-only imports so node:test can load it without dockerode or the @/ aliases. */
import type { ContainerSummary } from "./docker.ts";

/**
 * Public container health counts for the ambient kiosk display — counts
 * only, never names, images or ports (those stay behind the real session,
 * same as everywhere else in the app). Mirrors the bucketing in
 * /api/docker/containers/route.ts (running/paused/restarting exhaust "not
 * stopped"; everything else, including dead, falls into `stopped`) and
 * additionally breaks `dead` out on its own, since the kiosk's attention
 * strip needs to name it specifically rather than lump it into "stopped".
 */
export async function collectCounts(list: () => Promise<Pick<ContainerSummary, "state" | "health">[]>) {
  const containers = await list();
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

export type ContainerCounts = Awaited<ReturnType<typeof collectCounts>>;
