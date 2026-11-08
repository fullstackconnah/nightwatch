import { NextResponse } from "next/server";
import { getResourceSnapshot } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getResourceSnapshot());
  } catch (e) {
    console.error("resources failed", e);
    return NextResponse.json({ error: "Docker unreachable." }, { status: 502 });
  }
}
