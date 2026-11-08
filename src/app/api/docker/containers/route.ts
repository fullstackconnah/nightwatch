import { NextRequest, NextResponse } from "next/server";
import {
  createAndStartContainer,
  listContainersWithRuntime,
  refuseCreate,
  type CreateContainerSpec,
} from "@/lib/docker";
import { validateSpecShape } from "@/lib/create-spec";
import { createErrorCopy } from "@/lib/docker-create-error";
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
    console.error("docker containers failed", e);
    return NextResponse.json({ error: "Docker unreachable." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const bad = validateSpecShape(body);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    const spec = body as CreateContainerSpec;
    spec.ports ||= [];
    spec.env ||= [];
    spec.volumes ||= [];
    const refusal = await refuseCreate(spec);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
    const id = await createAndStartContainer(spec);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error("docker create failed", e);
    return NextResponse.json(
      { error: createErrorCopy(String(Reflect.get(Object(e), "message") ?? "")) },
      { status: 500 },
    );
  }
}
