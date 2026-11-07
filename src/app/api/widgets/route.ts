import { NextResponse } from "next/server";
import { listContainers } from "@/lib/docker";
import { fetchAllWidgets } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const containers = await listContainers();
    return NextResponse.json({ widgets: await fetchAllWidgets(containers) });
  } catch (e) {
    console.error("widgets load failed", e);
    return NextResponse.json(
      { error: "Couldn't load widgets" },
      { status: 502 },
    );
  }
}
