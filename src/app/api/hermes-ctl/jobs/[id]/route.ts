import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { sessionEpoch } from "@/lib/config";
import { getHermesJob } from "@/lib/hermes-ctl";
import { JOB_ID_RE } from "@/lib/hermes-job-map";
import { jobVisible } from "@/lib/kiosk-access";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Same always-200-style body, 400 not 401, for the same SWR reason as below.
  if (!JOB_ID_RE.test(id)) return NextResponse.json({ ok: false, status: "error", detail: "Invalid job id." }, { status: 400 });
  // Same always-200 "embed the problem state in the body" contract as
  // /api/hermes-ctl/status — this is polled via SWR's `fetcher`, which treats
  // a real 401 as this app's own session expiring, not Hermes'.
  const result = await getHermesJob(id);
  // Elevation-only callers (kiosk) may read only "ask" jobs; 404 rather than 403 so the id is not confirmed.
  if (result.ok && !jobVisible(result.job.kind, await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, sessionEpoch()))) {
    return NextResponse.json({ ok: false, status: "not-found", detail: `Job ${id} was not found.` }, { status: 404 });
  }
  return NextResponse.json(result);
}
