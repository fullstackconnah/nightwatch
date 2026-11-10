import { NextResponse } from "next/server";
import { getAttentionReport } from "@/lib/attention";
import { bearerMatches } from "@/lib/bearer";
import { systemSetting } from "@/lib/config";
import { deskAccess } from "@/lib/desk-auth";
import { buildGlance } from "@/lib/desk-glance";
import { getHostVitals } from "@/lib/host-metrics";
import { kioskVitals } from "@/lib/kiosk-vitals-view";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The desktop widget's read-only glance. Bearer-token auth (system.deskToken),
 * exempted from the session gate by one exact-path check in middleware.ts. Both
 * settings are read per request so a rotation needs no restart. One generic 503
 * body for every "off" reason; a probe failure is a `failed` status, never a 500.
 */
export async function GET(req: Request) {
  const deskToken = systemSetting("deskToken", "DESK_TOKEN");
  const mcpToken = systemSetting("mcpToken", "MCP_TOKEN");
  if (deskAccess(deskToken, mcpToken) === "off") {
    return NextResponse.json({ error: "Desk access is not turned on." }, { status: 503, headers: NO_STORE });
  }
  if (!bearerMatches(req.headers.get("authorization"), deskToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const report = await getAttentionReport(null);
  let vitals = null;
  try {
    vitals = kioskVitals(await getHostVitals());
  } catch {
    // vitals stay null: the widget shows no vitals line rather than zeros
  }
  return NextResponse.json(buildGlance(report, vitals), { headers: NO_STORE });
}
