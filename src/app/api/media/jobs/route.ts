import type { NextRequest } from "next/server";
import { enqueueResponse, jobsResponse } from "@/lib/media/routes";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts; the kiosk may not call POST.
export async function GET() {
  return jobsResponse();
}

export async function POST(req: NextRequest) {
  return enqueueResponse(await req.json().catch(() => null));
}
