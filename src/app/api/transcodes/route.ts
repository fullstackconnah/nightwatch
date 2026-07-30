import { NextResponse } from "next/server";
import { getTranscodeSnapshot } from "@/lib/jellyfin";

export const dynamic = "force-dynamic";

export async function GET() {
  // Always 200: an unconfigured/unreachable Jellyfin is a valid snapshot state
  // (ok: false) that the UI renders, not a transport failure — don't turn this
  // into a 502/503, the client hook expects JSON body on every response.
  return NextResponse.json(await getTranscodeSnapshot());
}
