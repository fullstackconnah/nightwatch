import { NextResponse } from "next/server";
import { getAttentionReport } from "@/lib/attention";
import { loadConfig, systemSetting } from "@/lib/config";
import { collectCounts } from "@/lib/container-counts";
import { doorCameraEntity } from "@/lib/desk-camera";
import { deskGlanceResponse } from "@/lib/desk-glance-response";
import { buildGlance, glanceHomeExtras, glanceMediaExtras, glanceWeatherExtras, within } from "@/lib/desk-glance";
import { listContainers } from "@/lib/docker";
import { getHaStates, getHiddenSettingsIds } from "@/lib/ha";
import { getDoorbellSnapshot } from "@/lib/ha-doorbell";
import { getHostVitals } from "@/lib/host-metrics";
import { getJellyfinNowPlaying } from "@/lib/jellyfin";
import { kioskVitals } from "@/lib/kiosk-vitals-view";
import { pickNowPlaying } from "@/lib/now-playing";
import type { HaStatesResponse } from "@/lib/types/ha";
import { getWeather } from "@/lib/weather";
import { getKioskDownloads } from "@/lib/widgets/builtins";

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
  const wx = glanceWeatherExtras(getWeather, EXTRA_MS);
  const camera = within(cameraAvailable(), EXTRA_MS, false);
  // One HA states call per request, shared by now playing and HOME; lazy, and never kept across requests.
  let haP: Promise<HaStatesResponse> | undefined;
  const ha = () => (haP ??= getHaStates());
  const media = glanceMediaExtras(() => pickNowPlaying(ha, getJellyfinNowPlaying), getKioskDownloads, EXTRA_MS);
  const home = glanceHomeExtras(ha, getHiddenSettingsIds, () => collectCounts(listContainers), EXTRA_MS);
  const report = await getAttentionReport(null);
  let vitals = null;
  try {
    vitals = kioskVitals(await getHostVitals());
  } catch {
    // vitals stay null: the widget shows no vitals line rather than zeros
  }
  const { weather, forecast } = await wx;
  const { nowPlaying, downloads } = await media;
  const h = await home;
  return buildGlance(report, vitals, { weather, forecast, camera: await camera, nowPlaying, downloads, home: h.home, containers: h.containers });
}
