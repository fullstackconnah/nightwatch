import { NextResponse } from "next/server";
import { getAttentionReport } from "@/lib/attention";
import { bearerMatches } from "@/lib/bearer";
import { loadConfig, systemSetting } from "@/lib/config";
import { deskAccess } from "@/lib/desk-auth";
import { doorCameraEntity } from "@/lib/desk-camera";
import { buildGlance, glanceWeather, within } from "@/lib/desk-glance";
import { getDoorbellSnapshot } from "@/lib/ha-doorbell";
import { getHostVitals } from "@/lib/host-metrics";
import { kioskVitals } from "@/lib/kiosk-vitals-view";
import { getWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const EXTRA_MS = 1500;

async function cameraAvailable(): Promise<boolean> {
  return loadConfig().system?.deskCamera === true && doorCameraEntity(await getDoorbellSnapshot()) !== null;
}

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
  // Each extra degrades to null/false: a slow or down upstream must not slow or fail the poll.
  const weather = within(getWeather().then(glanceWeather), EXTRA_MS, null);
  const camera = within(cameraAvailable(), EXTRA_MS, false);
  const report = await getAttentionReport(null);
  let vitals = null;
  try {
    vitals = kioskVitals(await getHostVitals());
  } catch {
    // vitals stay null: the widget shows no vitals line rather than zeros
  }
  return NextResponse.json(buildGlance(report, vitals, { weather: await weather, camera: await camera }), { headers: NO_STORE });
}
