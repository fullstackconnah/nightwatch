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
