import { NextResponse } from "next/server";
import { getProxyManagerSnapshot } from "@/lib/npm";

export const dynamic = "force-dynamic";

export async function GET() {
  // Always 200: an unconfigured/unreachable/unauthorized NPM is a valid snapshot
  // state the UI renders, not a transport failure — mirrors /api/transcodes. The
  // dashboard's own session auth already runs in middleware.ts ahead of this route;
  // NPM's own credentials never reach the client (see ProxyManagerSnapshot).
  return NextResponse.json(await getProxyManagerSnapshot());
}
