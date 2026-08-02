import { NextResponse } from "next/server";
import { getAttention } from "@/lib/attention";

export const dynamic = "force-dynamic";

/**
 * Public read for the kiosk's "One Thing Needs You" card. Sits under /kiosk,
 * which middleware.ts exempts from the session gate (same as /kiosk/api/health
 * and /kiosk/api/vitals), so a wall tablet can poll it without an admin
 * session. Container and drive NAMES are acceptable on this surface — the
 * kiosk's whole health/vitals family already takes that posture deliberately
 * — but getAttention() never surfaces logs, env vars, images, ports or
 * anything else. getAttention() itself never throws (every probe is
 * independently guarded), so this route has no error branch of its own to
 * write: a genuinely unreachable Docker/host layer just resolves to "quiet"
 * rather than a card that says "attention: something is wrong with the
 * thing that tells you what's wrong".
 */
export async function GET() {
  const result = await getAttention();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
