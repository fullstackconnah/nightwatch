/**
 * Label convention for opt-in dashboard behaviour, namespaced `dashboard.*`
 * so it can coexist with Homepage's `homepage.*` labels during migration.
 *
 *   dashboard.enable=false          hide this container's tile (default: shown)
 *   dashboard.url=http://...        app URL opened by the tile's external link
 *   dashboard.icon=<url|slug>       icon URL, or a selfh.st icon slug (e.g. "jellyfin")
 *   dashboard.group=Media           overview section for this tile
 *   dashboard.widget.type=<type>    builtin widget type, or "generic"
 *   dashboard.widget.endpoint=      URL fetched for widget data (generic)
 *   dashboard.widget.path=          comma-separated "Label:json.dot.path" pairs (generic)
 *   dashboard.widget.key=           API key / token if the endpoint needs one
 */
export interface DashboardLabels {
  enable: boolean;
  url?: string;
  icon?: string;
  group?: string;
  widget?: {
    type: string;
    endpoint?: string;
    path?: string;
    key?: string;
  };
}

export function parseDashboardLabels(labels: Record<string, string>): DashboardLabels {
  const out: DashboardLabels = { enable: labels["dashboard.enable"] !== "false" };
  if (labels["dashboard.url"]) out.url = labels["dashboard.url"];
  if (labels["dashboard.icon"]) out.icon = labels["dashboard.icon"];
  if (labels["dashboard.group"]) out.group = labels["dashboard.group"];
  const type = labels["dashboard.widget.type"];
  if (type) {
    out.widget = {
      type,
      endpoint: labels["dashboard.widget.endpoint"],
      path: labels["dashboard.widget.path"],
      key: labels["dashboard.widget.key"],
    };
  }
  return out;
}

/** Resolve an icon label/config value to an image URL. Bare slugs map to selfh.st icons. */
export function resolveIconUrl(icon: string | undefined): string | null {
  if (!icon) return null;
  if (icon.startsWith("http://") || icon.startsWith("https://") || icon.startsWith("/")) {
    return icon;
  }
  const slug = icon.replace(/\.(png|svg|webp)$/i, "");
  return `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`;
}
