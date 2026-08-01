import { NextRequest, NextResponse } from "next/server";
import { getHermesJob } from "@/lib/hermes-ctl";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Same always-200 "embed the problem state in the body" contract as
  // /api/hermes-ctl/status — this is polled via SWR's `fetcher`, which treats
  // a real 401 as this app's own session expiring, not Hermes'.
  return NextResponse.json(await getHermesJob(id));
}
