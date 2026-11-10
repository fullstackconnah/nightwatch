import { NextRequest, NextResponse } from "next/server";
import { mcManager, probeErrorResponse } from "@/lib/minecraft/manager";
import { busyMessage, holdAfterTimeout, tryBegin } from "@/lib/minecraft-busy";
import { isProbeOk } from "@/lib/integration-client";
import { sanitizeSlug } from "@/lib/minecraft/slug";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (sanitizeSlug(slug) !== slug) {
    return NextResponse.json({ error: "invalid instance slug" }, { status: 400 });
  }
  // Deleting the instance a restore or backup is working on would remove its files mid-job.
  const release = tryBegin("delete");
  if (!release) return NextResponse.json({ error: busyMessage() }, { status: 409 });
  let probe: Awaited<ReturnType<typeof mcManager.deleteInstance>> | undefined;
  try {
    probe = await mcManager.deleteInstance(slug);
    if (!isProbeOk(probe)) {
      const { status, error } = probeErrorResponse(probe);
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json(probe.data);
  } finally {
    if (probe?.timedOut) holdAfterTimeout(release);
    else release();
  }
}
