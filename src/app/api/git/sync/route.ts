import { NextRequest, NextResponse } from "next/server";
import { triggerPushMirrorSync } from "@/lib/forgejo";

export const dynamic = "force-dynamic";

/**
 * Force-syncs a repo's push mirror. Auth: middleware.ts requires a valid
 * admin session cookie for every /api/** path (this app has only one role —
 * see PRODUCT.md's Users section — so there is no further permission check
 * to layer on). That's the same reliance the docker lifecycle POST routes
 * use (src/app/api/docker/containers/[id]/action/route.ts has no bespoke
 * auth check of its own either) — this route intentionally matches it
 * rather than adding a second, redundant check.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { owner?: unknown; repo?: unknown };
  const owner = typeof body.owner === "string" ? body.owner.trim() : "";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  const result = await triggerPushMirrorSync(owner, repo);
  if (!result.ok) {
    const status = result.status >= 400 && result.status < 600 ? result.status : 502;
    return NextResponse.json({ error: result.detail }, { status });
  }
  return NextResponse.json({ ok: true });
}
