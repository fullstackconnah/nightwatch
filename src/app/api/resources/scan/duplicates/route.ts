import { NextRequest, NextResponse } from "next/server";
import { startScanJob, getJob, getLatestJob } from "@/lib/disk-scan";

export const dynamic = "force-dynamic";

const KIND = "duplicates" as const;

// Auth: gated by src/middleware.ts, same as every other /api/* route.

/** Starts a duplicates job rooted at `{ root }`. Mirrors largest-files' route
 *  exactly except for the job kind — see disk-scan.ts for the algorithm
 *  (same-size grouping, then head+tail 1MiB hash within each group). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const root = typeof (body as { root?: unknown })?.root === "string" ? (body as { root: string }).root : null;
  if (!root) return NextResponse.json({ error: "missing root path" }, { status: 400 });

  const result = startScanJob(KIND, root);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.job);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const job = id ? getJob(id) : getLatestJob(KIND);
  if (!job) return NextResponse.json({ error: "no job found" }, { status: 404 });
  if (job.kind !== KIND) return NextResponse.json({ error: "job kind mismatch" }, { status: 400 });
  return NextResponse.json(job);
}
