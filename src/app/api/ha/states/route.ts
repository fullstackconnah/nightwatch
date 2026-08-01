import { NextResponse } from "next/server";
import { getHaStates } from "@/lib/ha";

export const dynamic = "force-dynamic";

export async function GET() {
  // Always 200: an unconfigured/unreachable/unauthorized Home Assistant is a
  // valid snapshot state (status !== "ok") the UI renders, not a transport
  // failure — mirrors /api/transcodes. Crucially this must never be a real
  // HTTP 401, even for the "unauthorized" case: src/lib/client.ts's `fetcher`
  // treats a 401 as THIS app's own session expiring and redirects to /login,
  // which would be wrong here — the dashboard session is fine, HA's token isn't.
  return NextResponse.json(await getHaStates());
}
