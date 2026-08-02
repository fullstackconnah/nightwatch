/**
 * Wire contract for the Hermes ops daemon control page (/hermes). Import-free
 * leaf, same reason npm-types.ts and network-types.ts are: this file is
 * reachable from a "use client" hook (src/lib/use-hermes.ts), so anything
 * imported here lands in the browser bundle — the producer side
 * (src/lib/hermes-ctl.ts) is the one that reaches node fetch with the bearer
 * token, and that token never appears in a shape defined here.
 */

/**
 * `unconfigured` — HERMES_API_URL / HERMES_API_TOKEN not set in the server
 *                   environment.
 * `unreachable`  — the daemon did not answer (down, wrong URL, timeout).
 * `unauthorized` — the daemon rejected the bearer token.
 * `ok`           — the fields below are live data.
 */
export type HermesStatus = "unconfigured" | "unreachable" | "unauthorized" | "ok";

export interface HermesLoopInfo {
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
}

export interface HermesDigestLoopInfo extends HermesLoopInfo {
  nextRunAt: string | null;
}

export interface HermesAlertLoopInfo {
  lastTriggeredAt: string | null;
}

export interface HermesTierInfo {
  tier: string;
  model: string;
  source: string;
}

export interface HermesStatusOk {
  status: "ok";
  ok: boolean;
  startedAt: string | null;
  tier: HermesTierInfo;
  dryRun: boolean;
  loops: {
    collect: HermesLoopInfo;
    digest: HermesDigestLoopInfo;
    alert: HermesAlertLoopInfo;
  };
  discord: { webhookConfigured: boolean; commandsEnabled: boolean };
  counts: { snapshots24h: number; alerts24h: number };
}

/** Every non-"ok" status the /status, /activity and /jobs/{id} snapshots share —
 *  same one-shape-for-every-problem-state contract as ProxyManagerSnapshot. */
export interface HermesStatusProblem {
  status: Exclude<HermesStatus, "ok">;
  detail: string;
}

export type HermesStatusResponse = HermesStatusOk | HermesStatusProblem;

export type HermesJobKind = "digest" | "alert-test" | "ask" | "summarize";
export type HermesJobState = "running" | "done" | "error";

export interface HermesJobResult {
  title: string;
  body: string;
}

export interface HermesJob {
  state: HermesJobState;
  kind: HermesJobKind;
  startedAt: string | null;
  finishedAt: string | null;
  result: HermesJobResult | null;
  error: string | null;
}

export type HermesActivityKind = "digest" | "alert" | "recovery" | "ask";

export interface HermesActivityItem {
  at: string;
  kind: HermesActivityKind;
  title: string;
  body: string;
}

export interface HermesActivityOk {
  status: "ok";
  items: HermesActivityItem[];
}

export type HermesActivityResponse = HermesActivityOk | HermesStatusProblem;
