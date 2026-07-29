import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig, dockgeUrl, publicHost, type AppConfig } from "@/lib/config";
import { WIDGET_TYPE_NAMES } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    config: loadConfig(),
    meta: {
      widgetTypes: WIDGET_TYPE_NAMES,
      publicHost: publicHost(),
      dockgeUrl: dockgeUrl(),
      authConfigured: Boolean(process.env.ADMIN_PASSWORD_HASH),
      dataDir: process.env.DATA_DIR || "./data",
    },
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<AppConfig>;
    const current = loadConfig();
    const next: AppConfig = {
      groups: body.groups ?? current.groups,
      urls: body.urls ?? current.urls,
      icons: body.icons ?? current.icons,
      hidden: body.hidden ?? current.hidden,
      widgets: body.widgets ?? current.widgets,
    };
    saveConfig(next);
    return NextResponse.json({ ok: true, config: next });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }
}
