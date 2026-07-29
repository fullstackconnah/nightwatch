import { NextResponse } from "next/server";
import { docker } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [networks, containers] = await Promise.all([
      docker.listNetworks(),
      docker.listContainers({ all: false }),
    ]);
    const attached = new Map<string, string[]>();
    for (const c of containers) {
      for (const netName of Object.keys(c.NetworkSettings?.Networks || {})) {
        const list = attached.get(netName) || [];
        list.push((c.Names?.[0] || "").replace(/^\//, ""));
        attached.set(netName, list);
      }
    }
    return NextResponse.json({
      networks: networks
        .map((n) => ({
          id: n.Id,
          name: n.Name,
          driver: n.Driver,
          subnet: n.IPAM?.Config?.[0]?.Subnet ?? null,
          internal: n.Internal,
          containers: attached.get(n.Name) || [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "docker unreachable" },
      { status: 502 },
    );
  }
}
