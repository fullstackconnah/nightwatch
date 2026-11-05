import type { AppConfig, WidgetInstance } from "../config.ts";

/** O1: widget secrets are write-only. The browser gets keySet/passwordSet instead of the values. */
export function publicWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
  return widgets.map(({ key, password, ...w }) => ({ ...w, keySet: Boolean(key), passwordSet: Boolean(password) }));
}

/** Per widget id: an empty or missing secret keeps the stored one, a value replaces it, clearKey/clearPassword removes it. */
function mergeWidgetSecrets(stored: WidgetInstance[], incoming: unknown[]): unknown[] {
  return incoming.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const { keySet: _k, passwordSet: _p, clearKey, clearPassword, ...w } = raw as WidgetInstance;
    const old = stored.find((x) => x.id === w.id);
    for (const [f, clear] of [["key", clearKey], ["password", clearPassword]] as const) {
      const v = w[f];
      if (clear) delete w[f];
      else if (typeof v !== "string" || v === "") {
        if (old?.[f]) w[f] = old[f];
        else delete w[f];
      }
    }
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
  const fields = Object.fromEntries(present.map((k) => [k, b[k]]));
  if (present.includes("widgets")) fields.widgets = mergeWidgetSecrets(current.widgets ?? [], b.widgets as unknown[]);
  return { next: { ...current, ...fields } as AppConfig };
}
