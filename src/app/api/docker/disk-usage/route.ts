import { NextResponse } from "next/server";
import { getDiskReclaimSnapshot } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getDiskReclaimSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "docker unreachable" },
      { status: 502 },
    );
  }
}
