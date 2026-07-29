import { NextResponse } from "next/server";
import { docker } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [volumeData, containers] = await Promise.all([
      docker.listVolumes(),
      docker.listContainers({ all: true }),
    ]);
    const usedBy = new Map<string, string[]>();
    for (const c of containers) {
      for (const m of c.Mounts || []) {
        if (m.Type === "volume" && m.Name) {
          const list = usedBy.get(m.Name) || [];
          list.push((c.Names?.[0] || "").replace(/^\//, ""));
          usedBy.set(m.Name, list);
        }
      }
    }
    return NextResponse.json({
      volumes: (volumeData.Volumes || [])
        .map((v) => ({
          name: v.Name,
          driver: v.Driver,
          mountpoint: v.Mountpoint,
          created: (v as { CreatedAt?: string }).CreatedAt ?? null,
          usedBy: usedBy.get(v.Name) || [],
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
