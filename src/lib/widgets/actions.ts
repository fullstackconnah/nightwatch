/**
 * The curated, code-defined widget app-API actions (G3). Deliberately not
 * data-driven from config.json: these are the four apps this box actually
 * runs day to day, and each verb below is a real, idempotent, low-risk call
 * against that app's own API — not a generic "run any endpoint" escape hatch.
 *
 * Shared between the client (which button to draw) and the server route
 * (which action ids are valid for which widget type) — plain data only, no
 * fs/secrets, safe to import from "use client" components.
 */

export type ActionableWidgetType = "pihole" | "sonarr" | "radarr" | "qbittorrent";

export interface WidgetActionDef {
  id: string;
  /** Button label. */
  label: string;
  /** Inline two-step confirm prompt — names exactly what is about to happen. */
  confirm: string;
}

const ACTIONS: Record<ActionableWidgetType, WidgetActionDef[]> = {
  pihole: [
    { id: "pihole-disable-5m", label: "Disable blocking 5 min", confirm: "Disable Pi-hole blocking for 5 minutes?" },
    { id: "pihole-enable", label: "Enable blocking", confirm: "Re-enable Pi-hole blocking now?" },
  ],
  sonarr: [
    { id: "rss-sync", label: "RSS sync", confirm: "Trigger an RSS sync now?" },
    { id: "search-missing", label: "Search missing", confirm: "Search for all missing episodes now?" },
  ],
  radarr: [
    { id: "rss-sync", label: "RSS sync", confirm: "Trigger an RSS sync now?" },
    { id: "search-missing", label: "Search missing", confirm: "Search for all missing movies now?" },
  ],
  qbittorrent: [
    { id: "pause-all", label: "Pause all", confirm: "Pause all torrents?" },
    { id: "resume-all", label: "Resume all", confirm: "Resume all torrents?" },
  ],
};

function isActionableType(type: string): type is ActionableWidgetType {
  return Object.prototype.hasOwnProperty.call(ACTIONS, type);
}

/** The actions available for a widget type, or an empty list for anything not curated. */
export function actionsForWidgetType(type: string): WidgetActionDef[] {
  return isActionableType(type) ? ACTIONS[type] : [];
}

export function isValidWidgetAction(type: string, actionId: string): boolean {
  return actionsForWidgetType(type).some((a) => a.id === actionId);
}
