import { NextResponse } from "next/server";
import { getResourceSnapshot } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getResourceSnapshot());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "resources failed" },
      { status: 502 },
    );
  }
}
