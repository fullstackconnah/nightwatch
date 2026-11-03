import { NextResponse } from "next/server";
import { getAttentionReport } from "@/lib/attention";

export const dynamic = "force-dynamic";

/**
 * Home's attention report: every hit, each probe's status and the change feed.
 * Under /api, so middleware.ts session-gates it (probe errors carry socket
 * paths). It must never move under /kiosk, which is public. A probe failure is
 * a `failed` status inside the report, never a 500.
 */
export async function GET(req: Request) {
  const report = await getAttentionReport(new URL(req.url).searchParams.get("since"));
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
