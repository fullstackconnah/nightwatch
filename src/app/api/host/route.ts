import { NextResponse } from "next/server";
import { getHostVitals } from "@/lib/host-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getHostVitals());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "host metrics failed" },
      { status: 500 },
    );
  }
}
