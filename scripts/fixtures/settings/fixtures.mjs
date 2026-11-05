// Fixtures for scripts/settings-shots.mjs: GET /api/settings bodies, one per capture state. Placeholders only (the repo is
// public): hosts are homelab.local, secrets are the word "set". NOW pins the page clock; the stamps are offsets from it.
export const NOW = Date.parse("2026-11-05T01:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

const config = () => ({
  homeassistant: { url: "http://homelab.local:8123" },
  npm: { url: "http://homelab.local:81", email: "admin@example.com" },
  forgejo: { url: "http://homelab.local:3010" },
  minecraft: { managerUrl: "http://homelab.local:8090", rconHost: "homelab.local", rconPort: 25575 },
  hermes: { tier: "local", model: "local-model" },
  system: { voiceServerUrl: "http://homelab.local:8970", oidcIssuer: "http://homelab.local:9091", oidcClientId: "nightwatch", orchestraUrl: "http://homelab.local:7420" },
  urls: {}, icons: {}, hidden: [], groups: [],
  widgets: [{ id: "w1", type: "generic", container: "sonarr", url: "http://homelab.local:8989", paths: "Queued:queue.total" }],
});

const calm = () => ({
  config: config(),
  meta: {
    widgetTypes: ["generic"], publicHost: "homelab.local", dockgeUrl: "http://homelab.local:5001", authConfigured: true,
    dataDir: "/data", hermesModelUpdatedAt: ago(3), mcpEnabled: true, mcpEndpoint: "http://homelab.local:3005/api/mcp",
    kioskPinConfigured: true, hermesApiConfigured: true, orchestraConfigured: true, orchestraTokenSet: true, ssoConfigured: true, ssoIssuerHost: "homelab.local",
  },
  integrations: {
    homeassistant: { configured: true, updatedAt: ago(9) },
    npm: { configured: true, updatedAt: ago(9) },
    forgejo: { configured: true, updatedAt: ago(9) },
    github: { configured: true, updatedAt: ago(9) },
    minecraft: { configured: true, updatedAt: ago(5), curseforgeKeySet: true, rconPasswordSet: true },
    hermes: { openrouterConfigured: true, anthropicConfigured: true },
  },
  system: { mcpTokenConfigured: true, kioskPinConfigured: true, hermesApiConfigured: true, voiceConfigured: true, oidcClientSecretConfigured: true, updatedAt: ago(7) },
  hermesDaemon: { discordWebhookConfigured: true, discordBotTokenConfigured: true, discordChannelId: "100", discordAllowedUserIds: ["200"], dryRun: false, digestHour: 7, digestMinute: 30, pipelineEnabled: true, pipelineDailyBudgetUsd: 2, updatedAt: ago(30) },
});

const none = () => {
  const f = calm();
  for (const k of ["homeassistant", "npm", "forgejo", "github", "minecraft"]) f.integrations[k] = { configured: false };
  f.integrations.minecraft = { configured: false };
  f.system = { ...f.system, voiceConfigured: false, mcpTokenConfigured: false, kioskPinConfigured: false, oidcClientSecretConfigured: false };
  f.hermesDaemon.updatedAt = null;
  return f;
};

const partial = () => {
  const f = calm();
  f.integrations.npm = { configured: false };
  f.integrations.github = { configured: false };
  f.system.voiceConfigured = false;
  return f;
};

const noPassword = () => {
  const f = calm();
  f.meta.authConfigured = false;
  return f;
};

const hermesKeyMissing = () => {
  const f = calm();
  f.config.hermes = { tier: "openrouter", model: "vendor/model" };
  f.integrations.hermes = { openrouterConfigured: false, anthropicConfigured: true };
  return f;
};

// key: fixture name. `get` is what GET /api/settings answers; "hang" never answers (loading); "fail" answers 500.
export const FIXTURES = {
  calm: { get: calm() },
  partial: { get: partial() },
  none: { get: none() },
  loading: { get: "hang" },
  loadError: { get: "fail" },
  noPassword: { get: noPassword() },
  hermesKeyMissing: { get: hermesKeyMissing() },
  // Opens fine, then every later GET fails: the refresh-failed look.
  refreshFailed: { get: calm(), failAfter: 1 },
  // Same body as calm; the save routes answer 500, so a typed draft meets a failed save.
  saveFailed: { get: calm(), saveStatus: 500 },
  // Local tier, OpenRouter tier, Anthropic tier for the Hermes inventory kinds.
  tierOpenrouter: { get: (() => { const f = calm(); f.config.hermes = { tier: "openrouter", model: "vendor/model" }; return f; })() },
  tierAnthropic: { get: (() => { const f = calm(); f.config.hermes = { tier: "anthropic", model: "vendor/model" }; return f; })() },
  // MCP off and no Dockge link: the Access rows that only show in that condition.
  mcpOff: { get: (() => { const f = calm(); f.meta.mcpEnabled = false; f.system.mcpTokenConfigured = false; f.meta.dockgeUrl = ""; return f; })() },
};

// A plain-words list of the containers the Dashboard strip counts (names only).
export const CONTAINERS = { containers: ["sonarr", "radarr", "jellyfin"].map((name) => ({ id: name, name, state: "running", status: "Up 2 days", image: "example/" + name, ports: [], labels: {} })), groups: [], counts: { total: 3, running: 3, paused: 0, stopped: 0, restarting: 0, unhealthy: 0 } };
