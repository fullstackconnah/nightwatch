import { createHash } from "node:crypto";
import type { WidgetInstance } from "../config.ts";

/** Memo key: the id plus a sha256 of everything the fetch reads, so an edited token, url or filter never serves the old (or errored) answer. Only the hash is kept, never the key material. */
export function widgetMemoKey(w: WidgetInstance): string {
  const cfg = JSON.stringify([w.type, w.url, w.endpoint, w.key, w.username, w.password, w.headers, w.fields]);
  return `${w.id}|${createHash("sha256").update(cfg).digest("hex").slice(0, 16)}`;
}

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
