import { NextResponse } from "next/server";
import { getAttentionReport } from "@/lib/attention";
import { loadConfig, systemSetting } from "@/lib/config";
import { doorCameraEntity } from "@/lib/desk-camera";
import { deskGlanceResponse } from "@/lib/desk-glance-response";
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
  const r = await deskGlanceResponse({
    deskToken: systemSetting("deskToken", "DESK_TOKEN"),
    mcpToken: systemSetting("mcpToken", "MCP_TOKEN"),
    authorization: req.headers.get("authorization"),
    build: buildReport,
  });
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

async function buildReport() {
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
  return buildGlance(report, vitals, { weather: await weather, camera: await camera });
}
