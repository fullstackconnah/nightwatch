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
}

export interface OrchestratorInFlight {
  name: string;
  quietMin: number | null;
}

export interface OrchestratorDetail extends OrchestratorSummary {
  addDirs: string[];
  plugins: string[];
  checkpoint: string | null;
  sessionId?: string | null;
  inFlight: OrchestratorInFlight[];
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
