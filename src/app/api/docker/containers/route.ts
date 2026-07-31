import { NextRequest, NextResponse } from "next/server";
import {
  createAndStartContainer,
  listContainersWithRuntime,
  type CreateContainerSpec,
} from "@/lib/docker";
import { buildTiles, orderedGroups } from "@/lib/tiles";
import { resolveWidgetInstances } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const containers = await listContainersWithRuntime();
    const widgetContainers = new Set(resolveWidgetInstances(containers).map((w) => w.container));
    const tiles = buildTiles(containers, widgetContainers);
    // running/paused/restarting are exhaustive of "not stopped", so `stopped`
    // is the remainder rather than an enumeration — exited, created, dead and
    // removing all belong there, and a state Docker adds later still lands
    // somewhere instead of silently vanishing from the totals.
    const running = tiles.filter((t) => t.state === "running").length;
    const paused = tiles.filter((t) => t.state === "paused").length;
    const restarting = tiles.filter((t) => t.state === "restarting").length;
    return NextResponse.json({
      containers: tiles,
      groups: orderedGroups(tiles),
      counts: {
        total: tiles.length,
        running,
        paused,
        restarting,
        stopped: tiles.length - running - paused - restarting,
        unhealthy: tiles.filter((t) => t.health === "unhealthy").length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "docker unreachable" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const spec = (await req.json()) as CreateContainerSpec;
    if (!spec.image) {
      return NextResponse.json({ error: "image is required" }, { status: 400 });
    }
    spec.ports ||= [];
    spec.env ||= [];
    spec.volumes ||= [];
    const id = await createAndStartContainer(spec);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 500 },
    );
  }
}
