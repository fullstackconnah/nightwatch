// Relative imports with explicit .ts: node --test has no "@/" resolver (same constraint as minecraft/manager.ts).
import { loadConfig } from "../config.ts";
import { IntegrationClient, type Probe } from "../integration-client.ts";
import type { LibraryResponse, ScanState, TitleDetail } from "../../../services/media-worker/src/types.ts";

/** The media worker's HTTP API (services/media-worker). Server-side only: the URL and token never reach the browser. */
interface Creds {
  url: string;
  token: string;
}

const UNCONFIGURED_DETAIL = "Media worker isn’t connected. Add its address and token in Settings → Integrations.";

export function mediaWorkerCredentials(block: { workerUrl?: string; workerToken?: string } | undefined = loadConfig().media): Creds | null {
  const url = block?.workerUrl?.trim().replace(/\/+$/, "");
  const token = block?.workerToken?.trim();
  return url && token ? { url, token } : null;
}

export class MediaWorkerClient extends IntegrationClient<Creds> {
  protected readonly displayName = "Media worker";
  protected readonly timeoutMs = 8000;
  protected readonly unconfiguredDetail = UNCONFIGURED_DETAIL;

  protected credentials(): Creds | null {
    return mediaWorkerCredentials();
  }
  protected baseUrl(creds: Creds): string {
    return creds.url;
  }
  protected authHeaders(creds: Creds): Record<string, string> {
    return { Authorization: `Bearer ${creds.token}` };
  }
  // The base class names the host in this sentence; the media page never shows one.
  protected unreachableDetail(): string {
    return "The media worker didn’t answer.";
  }

  library(): Promise<Probe<LibraryResponse>> {
    return this.request("/library");
  }
  title(id: string): Promise<Probe<TitleDetail>> {
    return this.request(`/title?id=${encodeURIComponent(id)}`);
  }
  scan(): Promise<Probe<ScanState>> {
    return this.request("/scan", { method: "POST", body: {} });
  }
}

export const mediaWorker = new MediaWorkerClient();
