import { NextResponse } from "next/server";
import { getDiskReclaimSnapshot } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getDiskReclaimSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    console.error("docker disk usage failed", e);
    return NextResponse.json({ error: "Docker unreachable." }, { status: 502 });
  }
}
