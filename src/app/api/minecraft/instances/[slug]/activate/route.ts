import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const probe = await mcManager.activate(slug);
  if (!isProbeOk(probe)) {
    const { status, error } = probeErrorResponse(probe);
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json(probe.data);
}
