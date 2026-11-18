import { NextRequest, NextResponse } from "next/server";
import { contentLengthError } from "@/lib/upload-limit";
import { loadConfig, configProblem, CONFIG_UNREADABLE, DATA_DIR_UNWRITABLE, loadConfigForSave, saveConfig, type AppConfig } from "@/lib/config";
import { allowAutoOffSave, autoOffUnchanged, DEFAULT_AUTO_OFF_TIME, parseClimateAutoOffPatch } from "@/lib/climate-auto-off";

export const dynamic = "force-dynamic";

/* Public (unauthenticated LAN) read/write for the AC auto-off schedule —
 * same exposure class as /kiosk/api/ha/action, which already lets any LAN
 * device flip these same ACs directly. parseClimateAutoOffPatch (lib) is
 * the whole write surface: four shape-checked fields, unknown keys
 * rejected, nothing else in config.json reachable from here. Saves are
 * capped at 10 a minute (allowAutoOffSave) so a caller can't churn config.json. */

function responseShape(cfg: ReturnType<typeof loadConfig>["climateAutoOff"]) {
  return {
    enabled: cfg?.enabled ?? false,
    time: cfg?.time ?? DEFAULT_AUTO_OFF_TIME,
    skipDate: cfg?.skipDate ?? null,
    lastRunDate: cfg?.lastRunDate ?? null,
  };
}

export async function GET() {
  const cfg = loadConfig();
  // Defaults would otherwise read as "off"; the tablet says the saved schedule can't be read (configProblem is valid right after loadConfig).
  return NextResponse.json({ ...responseShape(cfg.climateAutoOff), unreadable: configProblem() !== null });
}

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const tooBig = contentLengthError(req.headers.get("content-length"), MAX_BODY_BYTES, "The request");
  if (tooBig) return NextResponse.json({ error: tooBig.detail }, { status: tooBig.status });
  const parsed = parseClimateAutoOffPatch(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let config: AppConfig;
  try {
    config = loadConfigForSave();
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json({ error: message }, { status: message === CONFIG_UNREADABLE ? 503 : 500 });
  }
  const prev = config.climateAutoOff;
  const next = {
    enabled: parsed.enabled ?? prev?.enabled ?? false,
    time: parsed.time ?? prev?.time ?? DEFAULT_AUTO_OFF_TIME,
    // Explicit null = "resume tonight"; absent = keep the stored value.
    skipDate: parsed.skipDate === null ? undefined : (parsed.skipDate ?? prev?.skipDate),
    lastRunDate: parsed.lastRunDate ?? prev?.lastRunDate,
    updatedAt: new Date().toISOString(),
  };
  if (!autoOffUnchanged(prev, next)) {
    if (!allowAutoOffSave()) {
      return NextResponse.json(
        { error: "Too many changes. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    try {
      saveConfig({ ...config, climateAutoOff: next });
    } catch (e) {
      // Only the unwritable-folder sentence is useful on the tablet; the bare "save failed" would replace its own message.
      const unwritable = e instanceof Error && e.message === DATA_DIR_UNWRITABLE;
      return NextResponse.json(unwritable ? { error: DATA_DIR_UNWRITABLE } : {}, { status: 500 });
    }
  }
  return NextResponse.json(responseShape(next));
}
