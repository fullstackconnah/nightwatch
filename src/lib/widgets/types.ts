import type { WidgetInstance } from "@/lib/config";

export interface WidgetField {
  label: string;
  value: string;
  /** visual intent for the value */
  intent?: "ok" | "warn" | "bad";
}

export interface WidgetData {
  type: string;
  fields: WidgetField[];
  error?: string;
  fetchedAt: number;
  /** True when this instance came from data/config.json (Settings page), as opposed
   *  to a zero-config dashboard.widget.* label. App-API actions (G3) are scoped to
   *  config.json instances only — that is where credentials are curated and where
   *  the owner made a deliberate "this app is here" decision. */
  configured?: boolean;
}

export type WidgetFetcher = (instance: WidgetInstance) => Promise<WidgetField[]>;

export class WidgetError extends Error {}

/** fetch JSON with a hard timeout; throws WidgetError with a short reason */
export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 5000, ...rest } = init || {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new WidgetError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable");
  }
  if (!res.ok) throw new WidgetError(`HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new WidgetError("invalid JSON");
  }
}

/**
 * POST for app-API actions (G3 widget actions) whose success is just "the app
 * accepted it" — most of these endpoints reply with an empty body or plain
 * text, not JSON. Failure carries the app's own response text as the reason
 * (truncated), so a caller sees Sonarr's or Pi-hole's real complaint rather
 * than a bare status code.
 */
export async function postAction(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<void> {
  const { timeoutMs = 5000, ...rest } = init || {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new WidgetError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable");
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).trim();
    throw new WidgetError(body ? `HTTP ${res.status}: ${body.slice(0, 200)}` : `HTTP ${res.status}`);
  }
}
