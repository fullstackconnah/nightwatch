import { hostname } from "node:os";
import { isProtectedContainer, MCP_ALLOWED_ON_PROTECTED } from "@/lib/protected-containers";
import { busyMessage, guardsMinecraftStart, tryBegin } from "@/lib/minecraft-busy";
import { listContainers, performContainerAction, type ContainerAction } from "@/lib/docker";

/**
 * MCP tools. Each one is a thin wrapper over performContainerAction() — the
 * exact function the existing lifecycle route (src/app/api/docker/containers/
 * [id]/action/route.ts) calls — so this layer opens no new Docker capability.
 *
 * Tool failures (container not found, Docker/proxy error) are reported as
 * `isError: true` tool results, never as JSON-RPC protocol errors: per MCP,
 * protocol errors are for malformed requests, tool-execution failures are
 * data the model should see and can reason about.
 */

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

const CONTAINER_NAME_SCHEMA: McpToolDescriptor["inputSchema"] = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: 'Container name as shown in `docker ps` / the Containers page (not the container ID).',
    },
  },
  required: ["name"],
};

export const TOOLS: McpToolDescriptor[] = [
  {
    name: "container_start",
    description: "Start a stopped container by name.",
    inputSchema: CONTAINER_NAME_SCHEMA,
  },
  {
    name: "container_stop",
    description: "Stop a running container by name (15s graceful timeout).",
    inputSchema: CONTAINER_NAME_SCHEMA,
  },
  {
    name: "container_restart",
    description: "Restart a container by name (15s graceful timeout).",
    inputSchema: CONTAINER_NAME_SCHEMA,
  },
];

const ACTION_BY_TOOL: Record<string, ContainerAction> = {
  container_start: "start",
  container_stop: "stop",
  container_restart: "restart",
};

function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: "text", text }], isError };
}

function extractContainerName(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const name = (args as Record<string, unknown>).name;
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}

export async function callTool(name: string, args: unknown): Promise<McpToolResult> {
  const action = Object.hasOwn(ACTION_BY_TOOL, name) ? ACTION_BY_TOOL[name] : undefined;
  if (!action) {
    return textResult(`Unknown tool "${name}". Known tools: ${Object.keys(ACTION_BY_TOOL).join(", ")}.`, true);
  }

  const containerName = extractContainerName(args);
  if (!containerName) {
    return textResult('Tool call is missing required string argument "name".', true);
  }

  try {
    const containers = await listContainers();
    const container = containers.find((c) => c.name === containerName);
    if (!container) {
      return textResult(`No container named "${containerName}" found.`, true);
    }
    if (!MCP_ALLOWED_ON_PROTECTED.includes(action) && isProtectedContainer(container, hostname())) {
      return textResult(`Refused: "${containerName}" is part of nightwatch's own control plane (nightwatch, its socket proxy or Dockge), so only start is allowed on it.`, true);
    }
    // Same guard as the lifecycle route: no start or restart of minecraft mid-restore.
    const release = guardsMinecraftStart(action, container.name) ? tryBegin("start") : () => {};
    if (!release) return textResult(busyMessage(), true);
    try {
      await performContainerAction(container.id, action);
    } finally {
      release();
    }
    return textResult(`${action} succeeded for "${containerName}" (was ${container.state}).`);
  } catch (e) {
    // 304 is Docker's "already in that state" — mirrors the lifecycle route's
    // own handling, and is success from the caller's point of view.
    if ((e as { statusCode?: number }).statusCode === 304) {
      return textResult(`"${containerName}" was already in the target state.`);
    }
    console.error(`mcp tool ${action} failed`, e);
    return textResult(`Failed to ${action} "${containerName}"`, true);
  }
}
