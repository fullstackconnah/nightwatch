import { systemSetting } from "./config.ts";
import type {
  OrchestraDetailResponse,
  OrchestraSnapshot,
  OrchestraState,
  OrchestratorDetail,
  OrchestratorRunState,
  OrchestratorSummary,
} from "./types/orchestra.ts";

/**
 * Server-only client for the orchestra service (Claude Code orchestrators on the owner's PC), read-only.
 * Same shape as hermes-ctl.ts: unconfigured / unreachable / unauthorized / ok, every upstream field read
 * defensively. The token is only ever put in the Authorization header; no result carries it.
 *
 * The service answers 400 to any Host header other than `<bind>:<port>`, so the configured URL must be
 * the literal IP:port, not a hostname.
 */

const TIMEOUT_MS = 5000;
export const ORCHESTRA_NAME = /^[a-z][a-z0-9-]{1,23}$/;

export interface OrchestraCredentials {
  url: string;
  token: string;
}

export function orchestraCredentials(): OrchestraCredentials | null {
  const url = systemSetting("orchestraUrl", "ORCHESTRA_URL");
  const token = systemSetting("orchestraToken", "ORCHESTRA_TOKEN");
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

const UNCONFIGURED =
  "The orchestra service is not connected. Set ORCHESTRA_URL (the service's literal IP:port) and ORCHESTRA_TOKEN in the server environment.";

type Fetched =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: Exclude<OrchestraState, "ok" | "unconfigured">; detail: string };

async function get(creds: OrchestraCredentials, path: string): Promise<Fetched> {
  try {
    const res = await fetch(`${creds.url}${path}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { kind: "unauthorized", detail: `The orchestra service rejected the API token (HTTP ${res.status}).` };
    }
    if (res.status === 404) return { kind: "ok", status: 404, body: null };
    if (!res.ok) return { kind: "unreachable", detail: `The orchestra service answered HTTP ${res.status}.` };
    return { kind: "ok", status: res.status, body: await res.json() };
  } catch {
    return { kind: "unreachable", detail: `The orchestra service did not answer within ${TIMEOUT_MS / 1000}s.` };
  }
}

// --- defensive mapping ---------------------------------------------------------

interface Raw {
  [key: string]: unknown;
}
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const RUN_STATES: readonly string[] = ["running", "stopped", "stalled", "unknown"];

function mapSummary(raw: unknown): OrchestratorSummary | null {
  const r = obj(raw);
  const name = str(r.name);
  if (!name || !ORCHESTRA_NAME.test(name)) return null;
  const state = str(r.state);
  return {
    name,
    title: str(r.title),
    state: (state && RUN_STATES.includes(state) ? state : "unknown") as OrchestratorRunState,
    lastActivityAt: str(r.lastActivityAt),
    model: str(r.model),
    home: str(r.home),
    inFlightCount: count(r.inFlightCount),
    stalledCount: count(r.stalledCount),
    watcher: str(r.watcher),
  };
}

function mapDetail(raw: unknown): OrchestratorDetail | null {
  const base = mapSummary(raw);
  if (!base) return null;
  const r = obj(raw);
  const inFlight = (Array.isArray(r.inFlight) ? r.inFlight : []).flatMap((e) => {
    const name = str(obj(e).name);
    const q = obj(e).quietMin;
    return name ? [{ name, quietMin: typeof q === "number" && Number.isFinite(q) ? q : null }] : [];
  });
  return { ...base, addDirs: strings(r.addDirs), plugins: strings(r.plugins), checkpoint: str(r.checkpoint), sessionId: str(r.sessionId), inFlight };
}

// --- snapshots -------------------------------------------------------------------

export async function getOrchestraSnapshot(creds: OrchestraCredentials | null = orchestraCredentials()): Promise<OrchestraSnapshot> {
  const fetchedAt = new Date().toISOString();
  if (!creds) return { status: "unconfigured", detail: UNCONFIGURED, fetchedAt, orchestrators: [] };
  const r = await get(creds, "/v1/orchestrators");
  if (r.kind !== "ok") return { status: r.kind, detail: r.detail, fetchedAt, orchestrators: [] };
  const list = obj(r.body).orchestrators;
  if (!Array.isArray(list)) {
    return { status: "unreachable", detail: "The orchestra service sent an unreadable answer.", fetchedAt, orchestrators: [] };
  }
  const orchestrators = list.map(mapSummary).filter((o): o is OrchestratorSummary => o !== null);
  return { status: "ok", detail: "", fetchedAt, orchestrators };
}

/** Invalid name: no upstream call. Unknown name (upstream 404): status "ok" with orchestrator null. */
export async function getOrchestraDetail(
  name: string,
  creds: OrchestraCredentials | null = orchestraCredentials(),
): Promise<OrchestraDetailResponse> {
  const fetchedAt = new Date().toISOString();
  if (!ORCHESTRA_NAME.test(name)) return { status: "ok", detail: "Invalid orchestrator name.", fetchedAt, orchestrator: null };
  if (!creds) return { status: "unconfigured", detail: UNCONFIGURED, fetchedAt, orchestrator: null };
  const r = await get(creds, `/v1/orchestrators/${name}`);
  if (r.kind !== "ok") return { status: r.kind, detail: r.detail, fetchedAt, orchestrator: null };
  const orchestrator = mapDetail(r.body);
  if (!orchestrator && r.status !== 404) {
    return { status: "unreachable", detail: "The orchestra service sent an unreadable answer.", fetchedAt, orchestrator: null };
  }
  return { status: "ok", detail: "", fetchedAt, orchestrator };
}
