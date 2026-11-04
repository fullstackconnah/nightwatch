export type OrchestraState = "ok" | "unconfigured" | "unreachable" | "unauthorized";

export type OrchestratorRunState = "running" | "stopped" | "stalled" | "unknown";

export interface OrchestratorSummary {
  name: string;
  title: string | null;
  state: OrchestratorRunState;
  lastActivityAt: string | null;
  model: string | null;
  home: string | null;
  inFlightCount: number;
  stalledCount: number;
  /** Slack watcher: online | busy | offline, or null when the service could not tell. */
  watcher: string | null;
  /** Every agent in flight, from the list call (no path). Empty when the service sends none. */
  inFlight: OrchestratorInFlight[];
}

export interface OrchestratorInFlight {
  name: string;
  quietMin: number | null;
  /** A tool call with no result for 5+ minutes (usually a permission prompt), or null. */
  waiting: { tool: string; sinceMin: number } | null;
}

export interface OrchestratorDetail extends OrchestratorSummary {
  addDirs: string[];
  plugins: string[];
  checkpoint: string | null;
  sessionId?: string | null;
}

export interface OrchestraSnapshot {
  status: OrchestraState;
  detail: string;
  fetchedAt: string;
  orchestrators: OrchestratorSummary[];
}

export interface OrchestraDetailResponse {
  status: OrchestraState;
  detail: string;
  fetchedAt: string;
  /** null with status "ok" means the service has no such orchestrator (the route answers 404). */
  orchestrator: OrchestratorDetail | null;
}
