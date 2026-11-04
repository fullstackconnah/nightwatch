/* Mocked API bodies for scripts/motion-shots.mjs, in the real response shapes. Placeholder names and hosts only; nothing
 * here names a real host, PIN or secret. read(pathname) returns the GET body for a path, or undefined for "not mocked".
 *
 * Shapes taken from: ContainersResponse (src/lib/client.ts) and TiledContainer (src/lib/tiles.ts); WidgetData
 * (src/lib/widgets/types.ts); AttentionReport (src/lib/attention-report.ts); HostVitals (src/lib/host-metrics.ts);
 * SettingsFullResponse (src/components/settings/settings-integrations.tsx). Docker and Minecraft bodies reuse the
 * fixtures of docker-shots.mjs and minecraft-shots.mjs.
 */
import { containersFor, imagesFor, volumesFor, diskFor, NOW_S } from "../docker/fixtures.mjs";
import { FIXTURES as MC, BACKUPS, LOG_CALM, SEARCH } from "../minecraft/fixtures.mjs";

const hex = (n) => n.toString(16).padStart(12, "0") + "0".repeat(52);
const iso = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString();
const pretty = (p) => (p ? p[0].toUpperCase() + p.slice(1) : "Ungrouped");

/** Docker's fixture rows get a full Tile (group, hidden) so Home's launcher can group them; plus one widget app and minecraft. */
function containers() {
  const base = containersFor("full").containers;
  const extra = [
    { ...base[0], id: hex(900), name: "pihole", image: "pihole/pihole:2024.07", composeProject: "apps" },
    { ...base[0], id: hex(901), name: "minecraft", image: "itzg/minecraft-server:java21", composeProject: "games", ...MC.calm.container },
  ];
  const list = [...base, ...extra].map((c) => ({
    ...c,
    created: c.created ?? NOW_S - 86400,
    tile: { url: null, icon: null, group: pretty(c.composeProject), hidden: false, hasWidget: c.name === "pihole" },
  }));
  const running = list.filter((c) => c.state === "running").length;
  return {
    containers: list,
    groups: [...new Set(list.map((c) => c.tile.group))],
    counts: { total: list.length, running, paused: 0, stopped: list.length - running, restarting: 0, unhealthy: 0 },
  };
}

const PROBES = ["crashes", "restarts", "smart", "mounts", "backup", "disks", "health", "orchestra"];

/** One warn hit and one handled event, so "Needs you" and the change feed both have a row. */
function attention() {
  const hit = {
    id: "disks:/mnt/media", probe: "disks", subject: "disk:/mnt/media", severity: "warn",
    headline: "Media disk is 90% full", detail: "Fixture only.", firstSeen: iso(90), owner: { href: "/resources", label: "Open Resources" },
  };
  return {
    checkedAt: iso(0),
    probes: PROBES.map((id) => ({ id, label: id, state: "answered", hits: id === "disks" ? 1 : 0 })),
    hits: [hit],
    changes: {
      since: iso(8 * 60), status: "answered",
      events: [{ id: "ev:1", kind: "handled", at: iso(30), subjects: ["container:web-1"], text: "web-1 restarted and is healthy", owner: { href: "/logs", label: "Open Logs" } }],
    },
  };
}

const host = () => ({
  hostname: "nightwatch-fixture", os: "Linux", uptimeSeconds: 12 * 86400 + 3600,
  cpu: { percent: 42, cores: 8, model: "Fixture CPU", loadAvg: [0.4, 0.5, 0.6] },
  memory: { total: 16 * 1024 ** 3, used: 8 * 1024 ** 3, available: 8 * 1024 ** 3, percent: 50 },
  disk: [{ mount: "/", total: 500 * 1024 ** 3, used: 200 * 1024 ** 3, percent: 40 }],
  network: { rxPerSec: 120_000, txPerSec: 45_000 }, tempC: 48, ts: Date.now(),
});

const off = { configured: false };
const settings = () => ({
  config: { groups: [], urls: {}, icons: {}, hidden: [], widgets: [] },
  meta: {
    widgetTypes: ["generic", "pihole"], publicHost: "nightwatch.example.invalid", dockgeUrl: "http://dockge.example.invalid:5001",
    authConfigured: true, dataDir: "/app/data", hermesModelUpdatedAt: null, mcpEnabled: false, mcpEndpoint: "/api/mcp",
    kioskPinConfigured: false, hermesApiConfigured: false, orchestraConfigured: false, orchestraTokenSet: false, ssoConfigured: false, ssoIssuerHost: null,
  },
  integrations: { homeassistant: off, npm: off, forgejo: off, github: off, minecraft: off, hermes: { openrouterConfigured: false, anthropicConfigured: false } },
  system: { mcpTokenConfigured: false, kioskPinConfigured: false, hermesApiConfigured: false, voiceConfigured: false, oidcClientSecretConfigured: false },
  hermesDaemon: { discordWebhookConfigured: false, discordBotTokenConfigured: false, discordAllowedUserIds: [], updatedAt: null },
});

/** GET body for a path, or undefined when the path is not mocked (the script answers 503, which each page shows as its error state). */
export function read(pathname) {
  switch (pathname) {
    case "/api/docker/containers": return containers();
    case "/api/docker/images": return imagesFor("full");
    case "/api/docker/volumes": return volumesFor("full");
    case "/api/docker/disk-usage": return diskFor("full");
    case "/api/widgets":
      return { widgets: { pihole: { type: "pihole", fields: [{ label: "Blocked", value: "14%" }, { label: "Queries", value: "9,812" }], fetchedAt: Date.now(), configured: true } } };
    case "/api/attention": return attention();
    case "/api/host": return host();
    case "/api/settings": return settings();
    case "/api/minecraft/status": return MC.calm.status;
    case "/api/minecraft/backups": return { backups: BACKUPS };
    case "/api/minecraft/packs/search": return SEARCH;
    default:
      return /^\/api\/docker\/containers\/[^/]+\/logs$/.test(pathname) ? { logs: LOG_CALM } : undefined;
  }
}

/** The body every mocked write answers with: covers prune, widget action, settings PUT, minecraft actions. */
export const WRITE_OK = { ok: true, message: "Done (fixture)", count: 0, bytes: 0, reclaimedBytes: 0 };
