import { NextResponse } from "next/server";
import { listContainers } from "@/lib/docker";
import { fetchAllWidgets } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const containers = await listContainers();
    return NextResponse.json({ widgets: await fetchAllWidgets(containers) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "widgets failed" },
      { status: 502 },
    );
  }
}
