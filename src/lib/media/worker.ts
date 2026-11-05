// Relative imports with explicit .ts: node --test has no "@/" resolver (same constraint as minecraft/manager.ts).
import { loadConfig } from "../config.ts";
import { IntegrationClient, type Probe } from "../integration-client.ts";
import type { BatchResponse, Job, JobsResponse, LibraryResponse, ScanState, TitleDetail } from "../../../services/media-worker/src/types.ts";

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
  jobs(): Promise<Probe<JobsResponse>> {
    return this.request("/jobs");
  }
  /** One file, or a batch (the worker takes at most 200 and queues all or none). The worker's own reason is kept for the page. */
  enqueue(target: string | string[]): Promise<Probe<Job | BatchResponse>> {
    const body = typeof target === "string" ? { path: target } : { paths: target };
    return this.request("/jobs", { method: "POST", body, includeErrorBody: true });
  }
  cancel(id: string): Promise<Probe<Job>> {
    return this.request(`/jobs/${id}/cancel`, { method: "POST", body: {}, includeErrorBody: true });
  }
  cancelBatch(id: string): Promise<Probe<{ jobs: Job[] }>> {
    return this.request(`/jobs/batch/${id}/cancel`, { method: "POST", body: {}, includeErrorBody: true });
  }
  undo(id: string): Promise<Probe<Job>> {
    return this.request(`/jobs/${id}/undo`, { method: "POST", body: {}, includeErrorBody: true });
  }
}

export const mediaWorker = new MediaWorkerClient();
