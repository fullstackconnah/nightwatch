import type { AppConfig, WidgetInstance } from "../config.ts";
import { widgetTarget } from "../widgets/target.ts";

/** O1/J1: widget secrets are write-only. The browser gets keySet/passwordSet instead of the values, and header names with blank values. */
export function publicWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
  return widgets.map(({ key, password, ...w }) => ({
    ...w,
    ...(w.headers && { headers: Object.fromEntries(Object.keys(w.headers).map((n) => [n, ""])) }),
    keySet: Boolean(key), passwordSet: Boolean(password),
    headersSet: Object.values(w.headers ?? {}).some(Boolean),
  }));
}

export const origin = (u: unknown) => {
  try { return new URL(String(u)).origin; } catch { return String(u); }
};

/** A stored secret survives a URL change only while the origin stays the same; a new origin (or a removed URL) drops it so it can't be sent to a new host. */
export function secretForUrl(stored: string | undefined, oldUrl: string | undefined, newUrl: string | undefined): string | undefined {
  return origin(oldUrl ?? "") === origin(newUrl ?? "") ? stored : undefined;
}

/** Per widget id: an empty or missing secret keeps the stored one, a value replaces it, clearKey/clearPassword removes it. */
function mergeWidgetSecrets(stored: WidgetInstance[], incoming: unknown[]): unknown[] {
  return incoming.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const { keySet: _k, passwordSet: _p, headersSet: _h, clearKey, clearPassword, ...w } = raw as WidgetInstance;
    // A stored secret follows only an unambiguous id, and only while the type, the url and the fetched address keep their origin.
    const unique = typeof w.id === "string" && w.id !== "" && incoming.filter((r) => (r as WidgetInstance | null)?.id === w.id).length === 1;
    const found = unique ? stored.find((x) => x.id === w.id) : undefined;
    const old = found && found.type === w.type && origin(found.url) === origin(w.url) && origin(widgetTarget(found)) === origin(widgetTarget(w)) ? found : undefined;
    for (const [f, clear] of [["key", clearKey], ["password", clearPassword]] as const) {
      const v = w[f];
      if (clear) delete w[f];
      else if (typeof v !== "string" || v === "") {
        if (old?.[f]) w[f] = old[f];
        else delete w[f];
      }
    }
    // J1: header values follow the same rule; with no `old` none is ever copied, so a changed url or endpoint can't carry a token to a new host.
    const sent = w.headers && typeof w.headers === "object" && !Array.isArray(w.headers) ? w.headers : undefined;
    const headers: Record<string, string> = sent ? {} : { ...old?.headers };
    for (const [n, v] of Object.entries(sent ?? {})) {
      const val = typeof v === "string" && v !== "" ? v : old?.headers && Object.hasOwn(old.headers, n) ? old.headers[n] : undefined;
      if (val) headers[n] = val; // empty stored headers are not kept
    }
    if (Object.keys(headers).length) w.headers = headers;
    else delete w.headers;
    return w;
  });
}

type Kind = "array" | "object";
const FIELDS: Record<"groups" | "urls" | "icons" | "hidden" | "widgets", Kind> = {
  groups: "array", urls: "object", icons: "object", hidden: "array", widgets: "array",
};

/**
 * K12: PUT /api/settings carries only the fields one save edits (`{ widgets }` or `{ groups, urls, icons, hidden }`).
 * Fields the body lacks keep the stored value, and every other block (hermes, jellyfin, ...) is never touched.
 * A body with none of the five fields, or one of the wrong shape, is refused so a bad client can't blank the config.
 */
export function mergeDashPut(current: AppConfig, body: unknown): { next: AppConfig } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const present = (Object.keys(FIELDS) as (keyof typeof FIELDS)[]).filter((k) => b[k] !== undefined);
  if (!present.length) return { error: "nothing to save" };
  for (const k of present) {
    const v = b[k];
    const good = FIELDS[k] === "array" ? Array.isArray(v) : v !== null && typeof v === "object" && !Array.isArray(v);
    if (!good) return { error: `${k} must be ${FIELDS[k] === "array" ? "an array" : "an object"}` };
  }
  for (const [k, label] of [["widgets", "widget"], ["groups", "group"]] as const) {
    if (present.includes(k) && (b[k] as unknown[]).some((x) => !x || typeof x !== "object" || Array.isArray(x))) return { error: `Each ${label} must be an object` };
  }
  if (present.includes("widgets")) {
    const w = b.widgets as { id?: unknown }[];
    if (w.length > 500) return { error: "Too many widgets (the most is 500)" };
    // label: ids are built from container labels at read time; a saved one would shadow them.
    if (w.some((x) => typeof x.id === "string" && x.id.startsWith("label:"))) return { error: `Widget ids can't start with "label:"` };
  }
  if (present.includes("groups") && (b.groups as unknown[]).length > 200) return { error: "Too many groups (the most is 200)" };
  const fields = Object.fromEntries(present.map((k) => [k, b[k]]));
  if (present.includes("widgets")) fields.widgets = mergeWidgetSecrets(current.widgets ?? [], b.widgets as unknown[]);
  return { next: { ...current, ...fields } as AppConfig };
}
