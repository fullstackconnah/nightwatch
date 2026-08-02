import type {
  HermesActivityItem,
  HermesActivityResponse,
  HermesJob,
  HermesJobKind,
  HermesJobResult,
  HermesStatusOk,
  HermesStatusResponse,
} from "@/lib/hermes-types";
import { systemSetting } from "@/lib/config";

/**
 * Server-only client for the Hermes ops daemon's HTTP control API.
 * Credentials are config-over-env via systemSetting() — a value saved on the
 * settings page's System card (config.json's system.hermesApiUrl/hermesApiToken)
 * wins over HERMES_API_URL/HERMES_API_TOKEN, which remain the fallback for
 * installs that provision them via compose only. Hermes is a sibling daemon
 * container on this same box, not a third-party integration with a UI-editable
 * admin login, so this never round-trips through the rest of data/config.json —
 * just the same fresh-read-every-request idiom as before (no restart-to-pick-up
 * caching, same as loadConfig()'s mtime-keyed reread underneath systemSetting()).
 *
 * Same distinguishable-failure vocabulary as ha.ts/npm.ts: unconfigured (no
 * config value or env var) / unreachable (transport failure or non-2xx) /
 * unauthorized (401/403) / ok. Every raw field from the daemon is read
 * defensively — it is being built in parallel against this same contract, so
 * a missing or malformed field degrades to a safe fallback rather than
 * throwing.
 */

const TIMEOUT_MS = 5000;

interface HermesCredentials {
  url: string;
  token: string;
}

function hermesCredentials(): HermesCredentials | null {
  const url = systemSetting("hermesApiUrl", "HERMES_API_URL");
  const token = systemSetting("hermesApiToken", "HERMES_API_TOKEN");
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export const HERMES_UNCONFIGURED_DETAIL =
  "Hermes is not connected. Set the Hermes API URL and token on the settings page's System " +
  "card (or HERMES_API_URL / HERMES_API_TOKEN in the server environment) — both are read " +
  "fresh on every request, so nothing else needs to change once they're set.";

function unreachableDetail(url: string, extra?: string): string {
  return extra ?? `Hermes at ${url} did not respond within ${TIMEOUT_MS / 1000}s.`;
}

function unauthorizedDetail(httpStatus: number): string {
  return `Hermes rejected the API token (HTTP ${httpStatus}).`;
}

// --- shared transport ---------------------------------------------------------

type FetchResult =
  | { kind: "ok"; res: Response }
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized"; detail: string };

async function hermesFetch(creds: HermesCredentials, path: string, init?: RequestInit): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(`${creds.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${creds.token}`, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { kind: "unreachable", detail: unreachableDetail(creds.url) };
  }
  if (res.status === 401 || res.status === 403) {
    return { kind: "unauthorized", detail: unauthorizedDetail(res.status) };
  }
  return { kind: "ok", res };
}

// --- defensive mapping helpers (daemon built in parallel — never trust shape) --

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function boolOrFallback(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function numOrFallback(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

interface RawObj {
  [key: string]: unknown;
}
function obj(v: unknown): RawObj {
  return v && typeof v === "object" ? (v as RawObj) : {};
}

function mapStatusBody(raw: unknown): HermesStatusOk {
  const r = obj(raw);
  const tier = obj(r.tier);
  const loops = obj(r.loops);
  const collect = obj(loops.collect);
  const digest = obj(loops.digest);
  const alert = obj(loops.alert);
  const discord = obj(r.discord);
  const counts = obj(r.counts);

  return {
    status: "ok",
    ok: boolOrFallback(r.ok, true),
    startedAt: str(r.startedAt),
    tier: {
      tier: str(tier.tier) ?? "unknown",
      model: str(tier.model) ?? "unknown",
      source: str(tier.source) ?? "unknown",
    },
    dryRun: boolOrFallback(r.dryRun, false),
    loops: {
      collect: {
        lastRunAt: str(collect.lastRunAt),
        lastOk: boolOrNull(collect.lastOk),
        lastError: str(collect.lastError),
      },
      digest: {
        lastRunAt: str(digest.lastRunAt),
        lastOk: boolOrNull(digest.lastOk),
        lastError: str(digest.lastError),
        nextRunAt: str(digest.nextRunAt),
      },
      alert: {
        lastTriggeredAt: str(alert.lastTriggeredAt),
      },
    },
    discord: {
      webhookConfigured: boolOrFallback(discord.webhookConfigured, false),
      commandsEnabled: boolOrFallback(discord.commandsEnabled, false),
    },
    counts: {
      snapshots24h: numOrFallback(counts.snapshots24h, 0),
      alerts24h: numOrFallback(counts.alerts24h, 0),
    },
  };
}

const JOB_STATES = new Set(["running", "done", "error"]);
const JOB_KINDS = new Set(["digest", "alert-test", "ask"]);

function mapJobResult(raw: unknown): HermesJobResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = obj(raw);
  const title = str(r.title);
  const body = str(r.body);
  if (title === null && body === null) return null;
  return { title: title ?? "", body: body ?? "" };
}

function mapJobBody(raw: unknown): HermesJob {
  const r = obj(raw);
  const state = typeof r.state === "string" && JOB_STATES.has(r.state) ? (r.state as HermesJob["state"]) : "error";
  const kind = typeof r.kind === "string" && JOB_KINDS.has(r.kind) ? (r.kind as HermesJob["kind"]) : "digest";
  return {
    state,
    kind,
    startedAt: str(r.startedAt),
    finishedAt: str(r.finishedAt),
    result: mapJobResult(r.result),
    error: str(r.error),
  };
}

function mapActivityItem(raw: unknown): HermesActivityItem | null {
  const r = obj(raw);
  const at = str(r.at);
  const kind = str(r.kind);
  if (!at || !kind) return null;
  const validKind = kind === "digest" || kind === "alert" || kind === "recovery" || kind === "ask";
  return {
    at,
    kind: validKind ? (kind as HermesActivityItem["kind"]) : "digest",
    title: str(r.title) ?? "",
    body: str(r.body) ?? "",
  };
}

// --- GET /status ----------------------------------------------------------

export async function getHermesStatus(): Promise<HermesStatusResponse> {
  const creds = hermesCredentials();
  if (!creds) return { status: "unconfigured", detail: HERMES_UNCONFIGURED_DETAIL };

  const r = await hermesFetch(creds, "/status");
  if (r.kind === "unreachable") return { status: "unreachable", detail: r.detail };
  if (r.kind === "unauthorized") return { status: "unauthorized", detail: r.detail };
  if (!r.res.ok) return { status: "unreachable", detail: `Hermes returned HTTP ${r.res.status}.` };

  let body: unknown;
  try {
    body = await r.res.json();
  } catch {
    return { status: "unreachable", detail: "Hermes returned a non-JSON response." };
  }
  return mapStatusBody(body);
}

// --- POST /run --------------------------------------------------------------

export type HermesRunResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      status: "unconfigured" | "unreachable" | "unauthorized" | "conflict" | "error";
      detail: string;
    };

export async function runHermesJob(kind: HermesJobKind, question?: string): Promise<HermesRunResult> {
  const creds = hermesCredentials();
  if (!creds) return { ok: false, status: "unconfigured", detail: HERMES_UNCONFIGURED_DETAIL };

  const r = await hermesFetch(creds, "/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(question !== undefined ? { kind, question } : { kind }),
  });
  if (r.kind === "unreachable") return { ok: false, status: "unreachable", detail: r.detail };
  if (r.kind === "unauthorized") return { ok: false, status: "unauthorized", detail: r.detail };

  const res = r.res;
  if (res.status === 409) {
    let detail = "Hermes already has a run in progress.";
    try {
      const body = obj(await res.json());
      const errMsg = str(body.error);
      if (errMsg) detail = errMsg;
    } catch {
      // keep the fallback detail
    }
    return { ok: false, status: "conflict", detail };
  }
  if (res.status !== 202) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: "error",
      detail: `Hermes returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : "."}`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: "error", detail: "Hermes accepted the run but returned a non-JSON response." };
  }
  const jobId = str(obj(body).jobId);
  if (!jobId) return { ok: false, status: "error", detail: "Hermes accepted the run but returned no jobId." };
  return { ok: true, jobId };
}

// --- GET /jobs/{id} ---------------------------------------------------------

export type HermesJobFetchResult =
  | { ok: true; job: HermesJob }
  | {
      ok: false;
      status: "unconfigured" | "unreachable" | "unauthorized" | "not-found" | "error";
      detail: string;
    };

export async function getHermesJob(id: string): Promise<HermesJobFetchResult> {
  const creds = hermesCredentials();
  if (!creds) return { ok: false, status: "unconfigured", detail: HERMES_UNCONFIGURED_DETAIL };

  const r = await hermesFetch(creds, `/jobs/${encodeURIComponent(id)}`);
  if (r.kind === "unreachable") return { ok: false, status: "unreachable", detail: r.detail };
  if (r.kind === "unauthorized") return { ok: false, status: "unauthorized", detail: r.detail };

  if (r.res.status === 404) return { ok: false, status: "not-found", detail: `Job ${id} was not found.` };
  if (!r.res.ok) return { ok: false, status: "error", detail: `Hermes returned HTTP ${r.res.status}.` };

  let body: unknown;
  try {
    body = await r.res.json();
  } catch {
    return { ok: false, status: "error", detail: "Hermes returned a non-JSON response." };
  }
  return { ok: true, job: mapJobBody(body) };
}

// --- GET /activity ------------------------------------------------------------

export async function getHermesActivity(limit = 20): Promise<HermesActivityResponse> {
  const creds = hermesCredentials();
  if (!creds) return { status: "unconfigured", detail: HERMES_UNCONFIGURED_DETAIL };

  const r = await hermesFetch(creds, `/activity?limit=${encodeURIComponent(String(limit))}`);
  if (r.kind === "unreachable") return { status: "unreachable", detail: r.detail };
  if (r.kind === "unauthorized") return { status: "unauthorized", detail: r.detail };
  if (!r.res.ok) return { status: "unreachable", detail: `Hermes returned HTTP ${r.res.status}.` };

  let body: unknown;
  try {
    body = await r.res.json();
  } catch {
    return { status: "unreachable", detail: "Hermes returned a non-JSON response." };
  }
  const rawItems = obj(body).items;
  const items = Array.isArray(rawItems)
    ? rawItems.map(mapActivityItem).filter((x): x is HermesActivityItem => x !== null)
    : [];
  return { status: "ok", items };
}
