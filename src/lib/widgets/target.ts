import type { WidgetInstance } from "../config.ts";

/** The address the generic fetcher sends headers and the key to. */
export function widgetTarget(w: Pick<WidgetInstance, "url" | "endpoint">): string {
  return w.endpoint ? (w.endpoint.startsWith("http") ? w.endpoint : `${w.url}${w.endpoint}`) : w.url;
}
