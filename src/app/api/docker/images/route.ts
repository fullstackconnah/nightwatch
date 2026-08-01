import { NextResponse } from "next/server";
import { docker } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [images, containers] = await Promise.all([
      docker.listImages({ all: false }),
      docker.listContainers({ all: true }),
    ]);
    // Named owners, not just a boolean: the per-image delete action (G2) disables
    // itself on an in-use image and needs to say *whose* container it is rather
    // than just "in use" — computed here once rather than a second round trip.
    const ownersByImageId = new Map<string, string[]>();
    for (const c of containers) {
      const name = (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, "");
      const owners = ownersByImageId.get(c.ImageID);
      if (owners) owners.push(name);
      else ownersByImageId.set(c.ImageID, [name]);
    }
    return NextResponse.json({
      images: images
        .map((i) => {
          const usedBy = ownersByImageId.get(i.Id) ?? [];
          return {
            id: i.Id,
            tags: i.RepoTags?.filter((t) => t !== "<none>:<none>") ?? [],
            size: i.Size,
            created: i.Created,
            inUse: usedBy.length > 0,
            usedBy,
          };
        })
        .sort((a, b) => b.created - a.created),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "docker unreachable" },
      { status: 502 },
    );
  }
}
