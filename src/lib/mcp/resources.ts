import { containerLogs, listContainers } from "@/lib/docker";
import { getHostVitals } from "@/lib/host-metrics";
import { getSmartSnapshot } from "@/lib/smart";
import { JSON_RPC_ERROR_CODES, McpError } from "./errors";

/**
 * Read-only MCP resources over nightwatch's existing server libs. Every
 * resource here reuses a function an existing API route already calls —
 * this module adds no new Docker/host access, it only reshapes the same
 * data as JSON or plain text for an MCP client.
 */

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

const CONTAINERS_URI = "nightwatch://containers";
const TELEMETRY_URI = "nightwatch://telemetry";
const SMART_URI = "nightwatch://smart";
const LOGS_PREFIX = "nightwatch://logs/";

export const LOG_RESOURCE_TEMPLATE: McpResourceTemplate = {
  uriTemplate: `${LOGS_PREFIX}{container}`,
  name: "container-logs",
  description: "Last ~200 log lines for one container, addressed by name (not ID). Plain text.",
  mimeType: "text/plain",
};

const STATIC_RESOURCES: McpResourceDescriptor[] = [
  {
    uri: CONTAINERS_URI,
    name: "containers",
    description: "Every container on the host: name, image, state, health, published ports.",
    mimeType: "application/json",
  },
  {
    uri: TELEMETRY_URI,
    name: "telemetry",
    description: "Current host vitals snapshot: CPU, memory, disk, network, temperature.",
    mimeType: "application/json",
  },
  {
    uri: SMART_URI,
    name: "smart",
    description: "Drive health summary: SMART status per drive plus RAID/LVM/ZFS/Btrfs integrity.",
    mimeType: "application/json",
  },
];

/**
 * Static resources plus one concrete logs resource per currently-running
 * container, so a client can discover log URIs without already knowing
 * container names. resources/templates/list still exposes the general
 * template for containers that aren't running right now.
 */
export async function listResources(): Promise<McpResourceDescriptor[]> {
  const containers = await listContainers().catch(() => []);
  const logResources: McpResourceDescriptor[] = containers
    .filter((c) => c.state === "running")
    .map((c) => ({
      uri: `${LOGS_PREFIX}${c.name}`,
      name: `logs: ${c.name}`,
      description: `Last ~200 log lines for "${c.name}".`,
      mimeType: "text/plain",
    }));
  return [...STATIC_RESOURCES, ...logResources];
}

export async function readResource(uri: string): Promise<McpResourceContent> {
  if (uri === CONTAINERS_URI) {
    const containers = await listContainers();
    const payload = containers.map((c) => ({
      name: c.name,
      image: c.image,
      state: c.state,
      health: c.health,
      ports: c.ports,
    }));
    return { uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) };
  }

  if (uri === TELEMETRY_URI) {
    const vitals = await getHostVitals();
    return { uri, mimeType: "application/json", text: JSON.stringify(vitals, null, 2) };
  }

  if (uri === SMART_URI) {
    const snapshot = await getSmartSnapshot();
    return { uri, mimeType: "application/json", text: JSON.stringify(snapshot, null, 2) };
  }

  if (uri.startsWith(LOGS_PREFIX)) {
    const name = decodeURIComponent(uri.slice(LOGS_PREFIX.length));
    if (!name) {
      throw new McpError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, `Malformed logs URI: "${uri}".`);
    }
    const containers = await listContainers();
    const container = containers.find((c) => c.name === name);
    if (!container) {
      throw new McpError(JSON_RPC_ERROR_CODES.RESOURCE_NOT_FOUND, `No container named "${name}".`);
    }
    const text = await containerLogs(container.id, 200);
    return { uri, mimeType: "text/plain", text };
  }

  throw new McpError(JSON_RPC_ERROR_CODES.RESOURCE_NOT_FOUND, `Unknown resource: "${uri}".`);
}
