import { NextRequest, NextResponse } from "next/server";
import { getHermesActivity } from "@/lib/hermes-ctl";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const parsed = limitParam ? Number(limitParam) : 20;
  const limit = Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.floor(parsed))) : 20;

  // Same always-200 contract as /api/hermes-ctl/status — see that route for why.
  return NextResponse.json(await getHermesActivity(limit));
}
