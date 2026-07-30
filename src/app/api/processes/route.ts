import { NextResponse } from "next/server";
import { getProcessSnapshot } from "@/lib/processes";

export const dynamic = "force-dynamic";

export async function GET() {
  // Always 200: a scan failure is a valid snapshot state (error: set, empty
  // processes) that the UI renders, not a transport failure — mirrors
  // /api/transcodes. Auth (401 for unauthenticated requests) is handled
  // globally by middleware.ts, same as every other route in this app.
  return NextResponse.json(await getProcessSnapshot());
}
