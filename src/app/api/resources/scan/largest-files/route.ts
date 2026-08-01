import { NextRequest, NextResponse } from "next/server";
import { startScanJob, getJob, getLatestJob } from "@/lib/disk-scan";

export const dynamic = "force-dynamic";

const KIND = "largest-files" as const;

// Auth: gated by src/middleware.ts, same as every other /api/* route.

/** Starts a largest-files job rooted at `{ root }` (an absolute path — same
 *  validation as the CONTENTS drill-down). 409 when one is already running;
 *  the job continues in the background, polled via GET below. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const root = typeof (body as { root?: unknown })?.root === "string" ? (body as { root: string }).root : null;
  if (!root) return NextResponse.json({ error: "missing root path" }, { status: 400 });

  const result = startScanJob(KIND, root);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.job);
}

/** Polls the current (or a specific, via `?id=`) largest-files job's state,
 *  progress and result. Auto-expires 30 minutes after it finishes (see
 *  disk-scan.ts's JOB_TTL_MS) — a 404 past that point is expected, not an error. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const job = id ? getJob(id) : getLatestJob(KIND);
  if (!job) return NextResponse.json({ error: "no job found" }, { status: 404 });
  if (job.kind !== KIND) return NextResponse.json({ error: "job kind mismatch" }, { status: 400 });
  return NextResponse.json(job);
}
