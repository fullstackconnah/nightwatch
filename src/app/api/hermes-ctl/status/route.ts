import { NextResponse } from "next/server";
import { getHermesStatus } from "@/lib/hermes-ctl";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

export async function GET() {
  // Always 200: an unconfigured/unreachable/unauthorized Hermes is a valid
  // snapshot state the UI renders, not a transport failure — mirrors
  // /api/ha/states and /api/proxy-manager. Crucially this must never be a
  // real HTTP 401, even for the "unauthorized" case: src/lib/client.ts's
  // `fetcher` treats a 401 as THIS app's own session expiring and redirects
  // to /login, which would be wrong here — the dashboard session is fine,
  // Hermes' own token isn't.
  return NextResponse.json(await getHermesStatus());
}
