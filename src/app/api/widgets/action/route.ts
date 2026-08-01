import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { isValidWidgetAction } from "@/lib/widgets/actions";
import { arrCommand, piholeSetBlocking, qbitSetPaused } from "@/lib/widgets/builtins";
import { WidgetError } from "@/lib/widgets/types";

export const dynamic = "force-dynamic";

/**
 * Executes one curated app-API action (G3) against a container's *configured*
 * widget (data/config.json only — never a dashboard.widget.* label instance,
 * so this only ever touches an app the owner deliberately wired up with
 * credentials). Auth is the same session middleware every other /api route
 * gets; nothing here re-checks it.
 *
 * Response is always `{ ok, message }`, 200 even on an app-side failure —
 * "Sonarr rejected the RSS sync" is not a request-shape error, it's the
 * answer, and the UI reads `ok` to decide how to render `message`. Only a
 * malformed request or an unknown container/action is a real HTTP error.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { container?: unknown; action?: unknown };
  const container = typeof body.container === "string" ? body.container : null;
  const action = typeof body.action === "string" ? body.action : null;
  if (!container || !action) {
    return NextResponse.json({ ok: false, message: "container and action are required" }, { status: 400 });
  }

  const widget = loadConfig().widgets.find((w) => w.container === container);
  if (!widget) {
    return NextResponse.json({ ok: false, message: `no configured widget for ${container}` }, { status: 404 });
  }
  if (!isValidWidgetAction(widget.type, action)) {
    return NextResponse.json(
      { ok: false, message: `"${action}" is not an available action for ${widget.type}` },
      { status: 400 },
    );
  }

  try {
    switch (`${widget.type}:${action}`) {
      case "pihole:pihole-disable-5m":
        await piholeSetBlocking(widget, false, 300);
        break;
      case "pihole:pihole-enable":
        await piholeSetBlocking(widget, true);
        break;
      case "sonarr:rss-sync":
      case "radarr:rss-sync":
        await arrCommand(widget, "RssSync");
        break;
      case "sonarr:search-missing":
        await arrCommand(widget, "MissingEpisodeSearch");
        break;
      case "radarr:search-missing":
        await arrCommand(widget, "MissingMoviesSearch");
        break;
      case "qbittorrent:pause-all":
        await qbitSetPaused(widget, true);
        break;
      case "qbittorrent:resume-all":
        await qbitSetPaused(widget, false);
        break;
      default:
        // Unreachable given isValidWidgetAction above, but keeps the switch honest.
        return NextResponse.json({ ok: false, message: "action not implemented" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: "done" });
  } catch (e) {
    const message = e instanceof WidgetError ? e.message : e instanceof Error ? e.message : "action failed";
    return NextResponse.json({ ok: false, message });
  }
}
