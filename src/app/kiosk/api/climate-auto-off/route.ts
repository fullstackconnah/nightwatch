import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { DEFAULT_AUTO_OFF_TIME, parseClimateAutoOffPatch } from "@/lib/climate-auto-off";

export const dynamic = "force-dynamic";

/* Public (unauthenticated LAN) read/write for the AC auto-off schedule —
 * same exposure class as /kiosk/api/ha/action, which already lets any LAN
 * device flip these same ACs directly. parseClimateAutoOffPatch (lib) is
 * the whole write surface: four shape-checked fields, unknown keys
 * rejected, nothing else in config.json reachable from here. */

function responseShape(cfg: ReturnType<typeof loadConfig>["climateAutoOff"]) {
  return {
    enabled: cfg?.enabled ?? false,
    time: cfg?.time ?? DEFAULT_AUTO_OFF_TIME,
    skipDate: cfg?.skipDate ?? null,
    lastRunDate: cfg?.lastRunDate ?? null,
  };
}

export async function GET() {
  return NextResponse.json(responseShape(loadConfig().climateAutoOff));
}

export async function POST(req: NextRequest) {
  const parsed = parseClimateAutoOffPatch(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const config = loadConfig();
  const prev = config.climateAutoOff;
  const next = {
    enabled: parsed.enabled ?? prev?.enabled ?? false,
    time: parsed.time ?? prev?.time ?? DEFAULT_AUTO_OFF_TIME,
    // Explicit null = "resume tonight"; absent = keep the stored value.
    skipDate: parsed.skipDate === null ? undefined : (parsed.skipDate ?? prev?.skipDate),
    lastRunDate: parsed.lastRunDate ?? prev?.lastRunDate,
    updatedAt: new Date().toISOString(),
  };
  saveConfig({ ...config, climateAutoOff: next });
  return NextResponse.json(responseShape(next));
}
