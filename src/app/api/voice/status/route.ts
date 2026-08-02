import { NextResponse } from "next/server";
import { isVoiceConfigured } from "@/lib/voice";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts like every other /api/* route. Returns
// only a boolean — never the URL itself — so the client can decide whether
// to render any voice affordance at all (per the backend contract: unset
// VOICE_SERVER_URL means voice is hidden everywhere, not shown-and-broken).
export async function GET() {
  return NextResponse.json({ configured: isVoiceConfigured() });
}
