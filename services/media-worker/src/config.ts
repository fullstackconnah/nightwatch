import { DEFAULT_MEDIA_ROOT } from "./paths.ts";

export const VERSION = "0.1.0";

export interface WorkerConfig {
  token: string;
  port: number;
  host: string;
  mediaRoot: string;
  stateDir: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  return {
    token: env.MEDIA_WORKER_TOKEN ?? "",
    port: Number(env.PORT ?? 8091),
    // Inside the container; the compose file decides which host address is published.
    host: env.HOST ?? "0.0.0.0",
    mediaRoot: env.MEDIA_ROOT ?? DEFAULT_MEDIA_ROOT,
    stateDir: env.STATE_DIR ?? "/state",
  };
}
