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
  jellyfin?: {
    url?: string;
    key?: string;
    /** Display username (Jellyfin's own `UserName`, not an email) whose
     *  sessions the kiosk's now-playing pill may surface. The filter runs
     *  SERVER-side, here and nowhere else: the kiosk surface is unauthenticated
     *  on the LAN, so anyone standing at the wall tablet could read the
     *  response, and another household member's viewing activity — what they
     *  watched, when, how far in — must never reach that response in the
     *  first place. Unset means "no Jellyfin source for the pill", not "show
     *  everyone" — see getJellyfinNowPlaying()'s own comment. */
    kioskUser?: string;
  };
  /** Home Assistant connection for the /smarthome entity panel. Token is a
   *  long-lived access token minted in HA (Profile → Security). Same
   *  deliberate not-a-widgets[]-entry reasoning as jellyfin above.
   *  `updatedAt` (ISO) is stamped by POST /api/settings/integrations on every
   *  save, purely so the settings UI can show "last saved <relative>" —
   *  nothing else reads it. */
  homeassistant?: {
    url?: string;
    token?: string;
    updatedAt?: string;
    /** Optional overrides for the kiosk's front-door camera surface. Every
     *  field is optional because src/lib/ha-doorbell.ts auto-detects all of
     *  it from HA's own entity registry (door-ish camera entities, plus the
     *  ding/person/motion entities that share each camera's device slug) —
     *  this block exists for the cases where that heuristic picks wrong: a
     *  camera named nothing like a door, or a doorbell whose trigger lives
     *  on a separate device. `cameras` also doubles as the allowlist the
     *  public proxy route enforces, so naming one here means NO other camera
     *  in the house is reachable from the unauthenticated kiosk surface. */
    doorbell?: {
      /** Camera entity_ids, most important first — the first is the default view. */
      cameras?: string[];
      /** Always open THIS camera, whatever fired — overriding the device
       *  pairing that would otherwise show the ringing device's own view.
       *  Needed because "which camera rang" and "which camera to look at" are
       *  not the same question: measured on this house's Ring doorbell, its
       *  `camera.*` entity serves the last RECORDED EVENT (byte-identical
       *  snapshots over 36s; MJPEG frames all arriving within 0.3s; an IR night
       *  picture at 11am), while the Reolink beside it is genuinely live. A bell
       *  press should still say "Doorbell rang" — the trigger decides the words,
       *  this decides the picture. Ignored unless it names a camera the resolver
       *  already allows, so it can never widen the allowlist or blank the view. */
      viewCamera?: string;
      /** Entity_ids whose firing opens the modal (event.*, binary_sensor.*, or a
       *  timestamp sensor.*). Overrides auto-detection entirely when present. */
      triggers?: string[];
      /** Set false to keep the modal from opening itself; the manual button stays. */
      autoOpen?: boolean;
    };
  };
  /** Nginx Proxy Manager admin API (port 81) for the /proxy route map.
   *  NPM only exposes its API to an authenticated admin, so this is the
   *  admin login; a bearer token is requested server-side per session. */
  npm?: { url?: string; email?: string; password?: string; updatedAt?: string };
  /** Forgejo API for the /git commit stream (token: user settings →
   *  Applications → access token, read scopes only). */
  forgejo?: { url?: string; token?: string; updatedAt?: string };
  /** GitHub PAT (read-only) for the local→cloud mirror sync visualizer. */
  github?: { token?: string; updatedAt?: string };
  /** Hermes model routing, set from the settings page's "Hermes · model"
   *  panel. This copy is the settings UI's own read model (so GET
   *  /api/settings has something to show); it is NOT what the hermes daemon
   *  reads. Every save also mirrors the same values into a sibling
   *  data/hermes-model.json (see HermesModelFile / writeHermesModelFile
   *  below), which the daemon hot-reads on its own schedule — no restart
   *  required. Keep the two in sync; POST /api/hermes/model is the only
   *  writer of either. */
  hermes?: {
    tier?: "local" | "openrouter" | "anthropic";
    model?: string;
    openrouterApiKey?: string;
    anthropicApiKey?: string;
  };
  /** Smart-display config for the public /kiosk weather + morning-briefing
   *  cards. Coordinates are server-only config, never echoed to the client —
   *  /kiosk/api/weather returns `place` alone (see weather.ts). Same
   *  not-a-widgets[]-entry reasoning as jellyfin/homeassistant above: this
   *  feeds two dedicated lib modules (weather.ts, briefing.ts), not the
   *  generic widget fetcher. Optional as a whole — installs that haven't set
   *  it get the "unconfigured" status vocabulary from those modules rather
   *  than a crash. */
  display?: {
    lat?: number;
    lon?: number;
    place?: string;
    timezone?: string;
    newsFeeds?: string[];
  };
  /** Absolute host paths (e.g. "/mnt/docker/downloads") pinned from the
   *  Resources page's CONTENTS drill-down for always-visible size tracking on
   *  the DISK tab's PINNED panel — media folders and the like the owner wants
   *  watched without re-drilling into them every time. Persisted here rather
   *  than derived, so a pin survives even if its folder is later denied by du
   *  or moved; the panel degrades that one row honestly instead of dropping
   *  it. Mutated via POST /api/resources/pins, not the settings PUT route. */
  pinnedFolders?: string[];
  /** Config-over-env overrides for nightwatch's own operational settings —
   *  the MCP bearer token, kiosk PIN, Hermes/voice sibling-daemon
   *  credentials, OIDC SSO config and the admin password hash. Every field
   *  is optional: an absent or empty-string field means "use the matching
   *  env var" (see systemSetting() below). Written by POST /api/settings/system
   *  (all fields except adminPasswordHash) and POST /api/settings/password
   *  (adminPasswordHash only). NOT env-only: NODE_EXTRA_CA_CERTS and
   *  SESSION_SECRET stay env-only by design (process-start semantics — a
   *  live config write can't retroactively change the Node TLS trust store
   *  or re-sign already-issued session JWTs), so they have no field here. */
  system?: {
    mcpToken?: string;
    kioskPin?: string;
    hermesApiUrl?: string;
    hermesApiToken?: string;
    voiceServerUrl?: string;
    voiceTtsUrl?: string;
    voiceSttModel?: string;
    voiceTtsModel?: string;
    voiceTtsVoice?: string;
    oidcIssuer?: string;
    oidcClientId?: string;
    oidcClientSecret?: string;
    /** bcrypt hash, same shape as env ADMIN_PASSWORD_HASH. Only ever written
     *  by POST /api/settings/password after verifying the CURRENT password
     *  against the effective hash — never editable as a raw field. */
    adminPasswordHash?: string;
    updatedAt?: string;
  };
}

export type SystemSettings = NonNullable<AppConfig["system"]>;

const DEFAULT_CONFIG: AppConfig = {
  groups: [],
  urls: {},
  icons: {},
  hidden: [],
  widgets: [],
};

export function dataDir(): string {
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
  writeJsonAtomic(configPath(), config);
  cache = null;
}

/** Shared atomic tmp+rename writer: write to a sibling `.tmp` file, then
 *  rename over the target. The rename is what makes this safe for a
 *  concurrently-hot-reading process (the daemon's readers below, and this
 *  module's own loadConfig()) — a reader never observes a half-written
 *  file, only the old version or the fully-written new one. */
function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

/** Best-effort JSON read, shared by every hermes/*.json reader below — a
 *  missing or unparsable file (never written yet, or a hand-edited slip)
 *  just means "nothing to report", not an error. */
function readJsonBestEffort<T>(filePath: string): T | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as T;
    return null;
  } catch {
    return null;
  }
}

// A dedicated SUBDIRECTORY, not files at the data-dir root: the hermes
// daemon bind-mounts this directory read-only. Mounting a single file
// doesn't work — our atomic tmp+rename replaces the inode, and a Docker
// file bind-mount pins the old inode, so the daemon would never see another
// update (observed live 2026-08-02). Mounting all of data/ would hand
// hermes every secret in config.json; the subdir carries only these two
// contract files (hermes-model.json, hermes-settings.json).
function hermesDir(): string {
  return path.join(dataDir(), "hermes");
}

/**
 * Shape written verbatim to data/hermes/hermes-model.json by POST /api/hermes/model.
 * This is a hot-read contract with the separate hermes daemon process — keep
 * every field name and optionality EXACT, since the daemon parses this file
 * directly rather than going through this module.
 */
export interface HermesModelFile {
  tier: "local" | "openrouter" | "anthropic";
  model: string;
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  updatedAt: string;
}

function hermesModelPath(): string {
  return path.join(hermesDir(), "hermes-model.json");
}

/** Best-effort read for the settings UI's "last saved" display. */
export function readHermesModelFile(): HermesModelFile | null {
  return readJsonBestEffort<HermesModelFile>(hermesModelPath());
}

/** Same atomic tmp+rename pattern as saveConfig, so the daemon's hot-read
 *  never observes a half-written file. */
export function writeHermesModelFile(data: HermesModelFile): void {
  writeJsonAtomic(hermesModelPath(), data);
}

/**
 * Shape written verbatim to data/hermes/hermes-settings.json by
 * POST /api/settings/hermes-daemon — the hermes ops daemon's second hot-read
 * file, living in the SAME bind-mounted subdirectory as hermes-model.json
 * (see hermesDir() above for why it must be a directory mount). Keys present
 * override the daemon's own env var; keys absent fall back to the daemon's
 * env, same config-over-env precedence as systemSetting() below — but this
 * file is a contract with a SEPARATE process, so that precedence is the
 * daemon's own responsibility to implement, not this module's. Field names
 * and optionality are EXACT per that contract; do not deviate.
 */
export interface HermesSettingsFile {
  discordWebhookUrl?: string;
  discordBotToken?: string;
  discordChannelId?: string;
  discordAllowedUserIds?: string[];
  dryRun?: boolean;
  digestHour?: number;
  digestMinute?: number;
  pipelineEnabled?: boolean;
  pipelineDailyBudgetUsd?: number;
  pipelineModel?: string;
  pipelineModelHard?: string;
  /** Kept in lockstep with config.json's system.mcpToken by
   *  syncHermesMcpToken() below whenever the settings page sets or
   *  regenerates the MCP token — hermes uses this to call back into
   *  nightwatch's own MCP server, so the two must never desync. */
  nightwatchMcpToken?: string;
  updatedAt: string;
}

function hermesSettingsPath(): string {
  return path.join(hermesDir(), "hermes-settings.json");
}

/** Best-effort read for the settings UI's Hermes · Daemon card. */
export function readHermesSettingsFile(): HermesSettingsFile | null {
  return readJsonBestEffort<HermesSettingsFile>(hermesSettingsPath());
}

/** Same atomic tmp+rename pattern as writeHermesModelFile. */
export function writeHermesSettingsFile(data: HermesSettingsFile): void {
  writeJsonAtomic(hermesSettingsPath(), data);
}

/**
 * CRITICAL SYNC RULE: whenever POST /api/settings/system sets or regenerates
 * system.mcpToken, it must call this in the SAME request so hermes-settings.json's
 * nightwatchMcpToken never drifts from the token nightwatch's own MCP server
 * actually expects. Preserves every other key already in hermes-settings.json —
 * a best-effort read (missing/corrupt file just means "start fresh") so a
 * slip in that file can never block the mcpToken save that triggered this. */
export function syncHermesMcpToken(token: string): void {
  const existing = readHermesSettingsFile() ?? { updatedAt: new Date().toISOString() };
  writeHermesSettingsFile({ ...existing, nightwatchMcpToken: token, updatedAt: new Date().toISOString() });
}

/**
 * The one precedence rule for every nightwatch-consumed operational setting:
 * a non-empty config.json value under `system` WINS over the matching env
 * var, which stays as the fallback for installs that haven't moved a
 * setting into the UI yet (or for the two env-only exceptions documented on
 * AppConfig.system above, which never call this at all). Every hot-read
 * consumer (mcp/auth.ts, the kiosk PIN check, hermes-ctl.ts, voice.ts,
 * oidc.ts, auth.ts's password check) routes through this one function
 * rather than reading process.env directly, so the precedence rule lives in
 * exactly one place. Cheap by construction: loadConfig() is already an
 * mtime-cached read, so this costs nothing extra on the hot per-request path.
 */
export function systemSetting(key: keyof SystemSettings, envName: string): string | undefined {
  const fromConfig = loadConfig().system?.[key];
  if (typeof fromConfig === "string" && fromConfig.trim()) return fromConfig.trim();
  const fromEnv = process.env[envName];
  return fromEnv?.trim() ? fromEnv.trim() : undefined;
}

export function publicHost(): string {
  return process.env.PUBLIC_HOST || "192.168.1.70";
}

export function dockgeUrl(): string {
  return process.env.DOCKGE_URL || `http://${publicHost()}:5001`;
}
