import fs from "node:fs";
import path from "node:path";

/**
 * User-editable dashboard config, persisted as JSON under DATA_DIR (a volume
 * in production). Holds everything that is per-install and often secret
 * (widget API keys), so it is never committed to git.
 */
export interface WidgetFieldSpec {
  label: string;
  /** Dot path into the JSON response, e.g. "queries.total" or "torrents[0].name" */
  path: string;
  format?: "number" | "bytes" | "rate" | "percent" | "text";
}

export interface WidgetInstance {
  id: string;
  /** Container name this widget attaches to. */
  container: string;
  /** Builtin type (sonarr, radarr, qbittorrent, pihole, seerr, prowlarr, bazarr, glances) or "generic". */
  type: string;
  url: string;
  key?: string;
  username?: string;
  password?: string;
  /** generic only: path appended to url */
  endpoint?: string;
  /** generic only */
  fields?: WidgetFieldSpec[];
  headers?: Record<string, string>;
}

export interface AppConfig {
  /** Ordered overview sections; containers not listed fall back to their compose project. */
  groups: { name: string; containers: string[] }[];
  /** container name -> app URL override (open-app link) */
  urls: Record<string, string>;
  /** container name -> icon URL or selfh.st slug */
  icons: Record<string, string>;
  /** container names hidden from the overview grid */
  hidden: string[];
  widgets: WidgetInstance[];
  /** Jellyfin connection used for transcode telemetry in the GPU resource view.
   *  Deliberately NOT a widgets[] entry: widgets[] feeds the widget fetcher, and an
   *  entry whose type has no builtin falls through to the generic fetcher, which
   *  would GET Jellyfin's web root, fail to parse HTML as JSON, and render an error
   *  tile on the Overview. */
  jellyfin?: { url?: string; key?: string };
  /** Home Assistant connection for the /smarthome entity panel. Token is a
   *  long-lived access token minted in HA (Profile → Security). Same
   *  deliberate not-a-widgets[]-entry reasoning as jellyfin above. */
  homeassistant?: { url?: string; token?: string };
  /** Nginx Proxy Manager admin API (port 81) for the /proxy route map.
   *  NPM only exposes its API to an authenticated admin, so this is the
   *  admin login; a bearer token is requested server-side per session. */
  npm?: { url?: string; email?: string; password?: string };
  /** Forgejo API for the /git commit stream (token: user settings →
   *  Applications → access token, read scopes only). */
  forgejo?: { url?: string; token?: string };
  /** GitHub PAT (read-only) for the local→cloud mirror sync visualizer. */
  github?: { token?: string };
  /** Absolute host paths (e.g. "/mnt/docker/downloads") pinned from the
   *  Resources page's CONTENTS drill-down for always-visible size tracking on
   *  the DISK tab's PINNED panel — media folders and the like the owner wants
   *  watched without re-drilling into them every time. Persisted here rather
   *  than derived, so a pin survives even if its folder is later denied by du
   *  or moved; the panel degrades that one row honestly instead of dropping
   *  it. Mutated via POST /api/resources/pins, not the settings PUT route. */
  pinnedFolders?: string[];
}

const DEFAULT_CONFIG: AppConfig = {
  groups: [],
  urls: {},
  icons: {},
  hidden: [],
  widgets: [],
};

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

let cache: { mtimeMs: number; config: AppConfig } | null = null;

export function loadConfig(): AppConfig {
  try {
    const stat = fs.statSync(configPath());
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.config;
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const config: AppConfig = { ...DEFAULT_CONFIG, ...parsed };
    cache = { mtimeMs: stat.mtimeMs, config };
    return config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AppConfig): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = configPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
  fs.renameSync(tmp, configPath());
  cache = null;
}

export function publicHost(): string {
  return process.env.PUBLIC_HOST || "192.168.1.70";
}

export function dockgeUrl(): string {
  return process.env.DOCKGE_URL || `http://${publicHost()}:5001`;
}
