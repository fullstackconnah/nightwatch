import { NextResponse } from "next/server";
import { docker } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [images, containers] = await Promise.all([
      docker.listImages({ all: false }),
      docker.listContainers({ all: true }),
    ]);
    const inUse = new Set(containers.map((c) => c.ImageID));
    return NextResponse.json({
      images: images
        .map((i) => ({
          id: i.Id,
          tags: i.RepoTags?.filter((t) => t !== "<none>:<none>") ?? [],
          size: i.Size,
          created: i.Created,
          inUse: inUse.has(i.Id),
        }))
        .sort((a, b) => b.created - a.created),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "docker unreachable" },
      { status: 502 },
    );
  }
}
