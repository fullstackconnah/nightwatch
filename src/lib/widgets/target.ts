import type { WidgetInstance } from "../config.ts";

/** The address the generic fetcher sends headers and the key to. */
export function widgetTarget(w: Pick<WidgetInstance, "url" | "endpoint">): string {
  return w.endpoint ? (w.endpoint.startsWith("http") ? w.endpoint : `${w.url}${w.endpoint}`) : w.url;
}

/** Own-key lookup: a label-supplied type like "toString" must not resolve to an inherited function. */
export function pickOwn<T>(table: Record<string, T>, key: string, fallback: T): T {
  return Object.hasOwn(table, key) ? table[key] : fallback;
}

export const LABEL_URL_ERROR = "Widget label needs a full http(s) URL";

/** A label-sourced widget (id "label:...") must carry an absolute URL; the server cannot fetch a relative one. */
export function labelUrlInvalid(w: { id: string; endpoint?: string }): boolean {
  return w.id.startsWith("label:") && !/^https?:\/\//i.test(w.endpoint || "");
}
