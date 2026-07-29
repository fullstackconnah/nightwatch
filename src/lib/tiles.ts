import { loadConfig, publicHost } from "@/lib/config";
import { parseDashboardLabels, resolveIconUrl } from "@/lib/labels";
import type { ContainerSummary } from "@/lib/docker";

/** Zero-config icons for images we recognise (selfh.st slugs). */
const IMAGE_ICONS: [RegExp, string][] = [
  [/jellyfin/i, "jellyfin"],
  [/jellystat/i, "jellystat"],
  [/immich-server|immich-app/i, "immich"],
  [/pihole/i, "pi-hole"],
  [/sonarr/i, "sonarr"],
  [/radarr/i, "radarr"],
  [/prowlarr/i, "prowlarr"],
  [/bazarr/i, "bazarr"],
  [/qbittorrent/i, "qbittorrent"],
  [/gluetun/i, "gluetun"],
  [/seerr/i, "jellyseerr"],
  [/homepage/i, "homepage"],
  [/nginx-proxy-manager/i, "nginx-proxy-manager"],
  [/authentik/i, "authentik"],
  [/home-assistant/i, "home-assistant"],
  [/glances/i, "glances"],
  [/dockge/i, "dockge"],
  [/watchtower/i, "watchtower"],
  [/cloudflared|cloudflare/i, "cloudflare"],
  [/organizr/i, "organizr"],
  [/postgres/i, "postgresql"],
  [/redis|valkey/i, "redis"],
  [/clamav/i, "clamav"],
  [/pigallery/i, "pigallery2"],
  [/flaresolverr/i, "flaresolverr"],
  [/homarr/i, "homarr"],
];

export interface Tile {
  url: string | null;
  icon: string | null;
  group: string;
  hidden: boolean;
  hasWidget: boolean;
}

export type TiledContainer = ContainerSummary & { tile: Tile };

function prettify(project: string | null): string {
  if (!project) return "Ungrouped";
  return project.charAt(0).toUpperCase() + project.slice(1);
}

function inferUrl(c: ContainerSummary): string | null {
  // Prefer the lowest published TCP port that plausibly serves HTTP.
  const candidates = c.ports
    .filter((p) => p.type === "tcp" && p.public != null && p.public >= 1000)
    .map((p) => p.public as number);
  if (!candidates.length) return null;
  return `http://${publicHost()}:${Math.min(...candidates)}`;
}

export function buildTiles(
  containers: ContainerSummary[],
  widgetContainers: Set<string>,
): TiledContainer[] {
  const cfg = loadConfig();
  const groupByContainer = new Map<string, string>();
  for (const g of cfg.groups) for (const name of g.containers) groupByContainer.set(name, g.name);

  return containers.map((c) => {
    const dl = parseDashboardLabels(c.labels);
    const url = cfg.urls[c.name] ?? dl.url ?? inferUrl(c);
    const iconRaw =
      cfg.icons[c.name] ??
      dl.icon ??
      IMAGE_ICONS.find(([re]) => re.test(c.image) || re.test(c.name))?.[1] ??
      null;
    const group =
      groupByContainer.get(c.name) ?? dl.group ?? prettify(c.composeProject);
    return {
      ...c,
      tile: {
        url,
        icon: resolveIconUrl(iconRaw ?? undefined),
        group,
        hidden: cfg.hidden.includes(c.name) || !dl.enable,
        hasWidget: widgetContainers.has(c.name),
      },
    };
  });
}

/** Ordered group names: configured order first, then discovered groups alphabetically. */
export function orderedGroups(tiles: TiledContainer[]): string[] {
  const cfg = loadConfig();
  const configured = cfg.groups.map((g) => g.name);
  const discovered = [...new Set(tiles.map((t) => t.tile.group))]
    .filter((g) => !configured.includes(g))
    .sort();
  return [...configured, ...discovered].filter((g) =>
    tiles.some((t) => t.tile.group === g),
  );
}
