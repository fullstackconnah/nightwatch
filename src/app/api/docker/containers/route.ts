import { NextRequest, NextResponse } from "next/server";
import { createAndStartContainer, listContainers, type CreateContainerSpec } from "@/lib/docker";
import { buildTiles, orderedGroups } from "@/lib/tiles";
import { resolveWidgetInstances } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const containers = await listContainers();
    const widgetContainers = new Set(resolveWidgetInstances(containers).map((w) => w.container));
    const tiles = buildTiles(containers, widgetContainers);
    return NextResponse.json({
      containers: tiles,
      groups: orderedGroups(tiles),
      counts: {
        total: tiles.length,
        running: tiles.filter((t) => t.state === "running").length,
        stopped: tiles.filter((t) => t.state === "exited" || t.state === "created").length,
        restarting: tiles.filter((t) => t.state === "restarting").length,
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
