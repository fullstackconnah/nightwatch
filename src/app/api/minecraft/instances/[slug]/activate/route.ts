import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { isProbeOk } from "@/lib/integration-client";
import { busyMessage, tryBegin } from "@/lib/minecraft-busy";
import { sanitizeSlug } from "@/lib/minecraft/slug";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (sanitizeSlug(slug) !== slug) {
    return NextResponse.json({ error: "invalid instance slug" }, { status: 400 });
  }
  const release = tryBegin("activate");
  if (!release) return NextResponse.json({ error: busyMessage() }, { status: 409 });
  try {
    const probe = await mcManager.activate(slug);
    if (!isProbeOk(probe)) {
      const { status, error } = probeErrorResponse(probe);
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json(probe.data);
  } finally {
    release();
  }
}
