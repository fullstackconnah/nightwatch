import { NextResponse } from "next/server";
import { getSmartSnapshot } from "@/lib/smart";

export const dynamic = "force-dynamic";

export async function GET() {
  // Always 200: a collection failure is a valid snapshot state (error: set,
  // empty drives) that the UI renders, not a transport failure — mirrors
  // /api/processes. Auth (401 for unauthenticated requests) is handled
  // globally by middleware.ts, same as every other route in this app.
  return NextResponse.json(await getSmartSnapshot());
}
