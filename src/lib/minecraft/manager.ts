// Relative import with explicit .ts extension, not "@/lib/...": manager.test.ts
// imports this module directly and `node --test` has no tsconfig-paths
// resolver registered (unlike Next's build), so an "@/" import would resolve
// fine under tsc but throw ERR_MODULE_NOT_FOUND at test time. Same constraint
// packs.ts documents for its own config import.
import { loadConfig } from "../config.ts";
import { IntegrationClient, type Probe, type ProbeFail } from "../integration-client.ts";

/**
 * Thin IntegrationClient subclass for the mc-manager HTTP API (see Tasks 3-5
 * for the manager's own contract). Every method here is a one-liner over
 * `request<T>` — the base class already owns the unconfigured/unreachable/
 * unauthorized/ok classification and the "never forward an upstream 401"
 * invariant; this file's only job is naming mc-manager's endpoints and shapes.
 */

export interface McInstance {
  slug: string;
  name: string;
  source: "curseforge" | "modrinth";
  packRef: string;
  mcVersion: string;
  memoryGb: number;
  createdAt: string;
}

export interface McBackup {
  instance: string;
  file: string;
  sizeBytes: number;
  modifiedAt: string;
}

interface McManagerCredentials {
  url: string;
  token: string;
}

const TIMEOUT_MS = 6000;

const UNCONFIGURED_DETAIL =
  "Minecraft manager is not configured — add managerUrl and managerToken in Settings → Integrations.";

/**
 * Takes the `minecraft` config block as an argument (defaulting to
 * `loadConfig().minecraft`) rather than reading it internally, purely so
 * tests can exercise the real normalization logic (trim + strip trailing
 * slashes) with an in-memory block instead of going through `loadConfig()` /
 * `DATA_DIR`.
 */
export function mcManagerCredentials(
  block: { managerUrl?: string; managerToken?: string } | undefined = loadConfig().minecraft,
): McManagerCredentials | null {
  const url = block?.managerUrl?.trim().replace(/\/+$/, "");
  const token = block?.managerToken?.trim();
  if (!url || !token) return null;
  return { url, token };
}

export class McManagerClient extends IntegrationClient<McManagerCredentials> {
  protected readonly displayName = "mc-manager";
  protected readonly timeoutMs = TIMEOUT_MS;
  protected readonly unconfiguredDetail = UNCONFIGURED_DETAIL;

  protected credentials(): McManagerCredentials | null {
    return mcManagerCredentials();
  }
  protected baseUrl(creds: McManagerCredentials): string {
    return creds.url;
  }
  protected authHeaders(creds: McManagerCredentials): Record<string, string> {
    return { Authorization: `Bearer ${creds.token}` };
  }

  instances(): Promise<Probe<{ instances: McInstance[]; active: string | null }>> {
    return this.request("/instances");
  }

  createInstance(body: {
    slug: string;
    name: string;
    source: string;
    packRef: string;
    mcVersion: string;
    memoryGb?: number;
    cfApiKey?: string;
  }): Promise<Probe<McInstance>> {
    return this.request("/instances", { method: "POST", body });
  }

  activate(slug: string): Promise<Probe<{ ok: true; active: string }>> {
    return this.request(`/instances/${encodeURIComponent(slug)}/activate`, { method: "POST" });
  }

  deleteInstance(slug: string): Promise<Probe<{ ok: true }>> {
    return this.request(`/instances/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }

  backups(): Promise<Probe<{ backups: McBackup[] }>> {
    return this.request("/backups");
  }

  runBackup(): Promise<Probe<{ ok: true }>> {
    return this.request("/backups/run", { method: "POST" });
  }

  restoreBackup(instance: string, file: string): Promise<Probe<{ ok: true }>> {
    return this.request("/backups/restore", { method: "POST", body: { instance, file } });
  }
}

export const mcManager = new McManagerClient();

/**
 * Maps a failed Probe onto the HTTP status Task 12's routes should respond
 * with. "unconfigured" is a client-side setup problem local to this app, so
 * it's a 409 (conflict with current state) rather than a 5xx; "unreachable"
 * and "unauthorized" both mean mc-manager itself couldn't be used to satisfy
 * the request, so both become 502 (bad gateway) — deliberately never the
 * upstream's own 401/403, per integration-client.ts's invariant.
 */
export function probeHttpStatus(p: ProbeFail): number {
  return p.status === "unconfigured" ? 409 : 502;
}
