import { NextResponse } from "next/server";
import { docker, DOCKER_CALL_MS } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [volumeData, containers] = await Promise.all([
      docker.listVolumes({ abortSignal: AbortSignal.timeout(DOCKER_CALL_MS) }),
      docker.listContainers({ all: true, abortSignal: AbortSignal.timeout(DOCKER_CALL_MS) }),
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
    console.error("docker volumes failed", e);
    return NextResponse.json({ error: "Docker unreachable." }, { status: 502 });
  }
}
