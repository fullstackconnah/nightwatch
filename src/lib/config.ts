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
