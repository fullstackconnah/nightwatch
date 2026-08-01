import { NextResponse } from "next/server";
import { getGitSnapshot } from "@/lib/forgejo";

export const dynamic = "force-dynamic";

// Auth: gated by middleware.ts for every /api/** path except the public
// login routes — same as every other read-only route in this app (e.g.
// /api/docker/volumes), so nothing extra is added here.
export async function GET() {
  const snapshot = await getGitSnapshot();
  return NextResponse.json(snapshot);
}
