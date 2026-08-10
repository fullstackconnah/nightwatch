import { loadConfig, type WidgetInstance } from "@/lib/config";
import { parseDashboardLabels } from "@/lib/labels";
import type { ContainerSummary } from "@/lib/docker";
import { BUILTIN_WIDGETS } from "./builtins";
import { WidgetError, type WidgetData } from "./types";
import { KeyedMemo } from "@/lib/cache";

export { BUILTIN_WIDGETS, WIDGET_TYPE_NAMES } from "./builtins";

/**
 * Widget instances come from two places, config file first:
 *  1. data/config.json (Settings page) — supports secrets;
 *  2. dashboard.widget.* container labels — zero-config generic widgets.
 */
export function resolveWidgetInstances(containers: ContainerSummary[]): WidgetInstance[] {
  const cfg = loadConfig();
  const configured = new Set(cfg.widgets.map((w) => w.container));
  const fromLabels: WidgetInstance[] = [];

  for (const c of containers) {
    if (configured.has(c.name)) continue;
    const dl = parseDashboardLabels(c.labels);
    if (!dl.widget?.type) continue;
    // "Label:dot.path,Label2:other.path" → field specs
    const fields = (dl.widget.path || "")
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf(":");
        return idx === -1
          ? { label: pair, path: pair }
          : { label: pair.slice(0, idx), path: pair.slice(idx + 1) };
      });
    fromLabels.push({
      id: `label:${c.name}`,
      container: c.name,
      type: dl.widget.type,
      url: dl.widget.endpoint || "",
      endpoint: dl.widget.endpoint,
      key: dl.widget.key,
      fields,
    });
  }
  return [...cfg.widgets, ...fromLabels];
}

const TTL_MS = 15_000;

/** The instance each pending widget load applies to — keyed by instance.id,
 *  which is what the memo keys on too. */
const pendingInstances = new Map<string, WidgetInstance>();

/**
 * Per-widget-instance cache. The in-flight dedup matters more here than the
 * TTL: /api/widgets fans out to every configured instance at once, so two
 * overlapping polls used to mean two round-trips per *arr/Pi-hole/qBittorrent
 * endpoint rather than one.
 *
 * A failed fetch is cached deliberately (see the catch below): a widget whose
 * app is down should render "error" steadily for the TTL rather than
 * hammering a dead endpoint on every poll. That is why the loader never
 * rejects — it resolves with an error-carrying WidgetData instead.
 */
const widgetMemo = new KeyedMemo<WidgetData>({
  key: "widgets.instance",
  ttlMs: TTL_MS,
  load: async (id) => {
    const instance = pendingInstances.get(id)!;
    const fetcher = BUILTIN_WIDGETS[instance.type] || BUILTIN_WIDGETS.generic;
    try {
      const fields = await fetcher(instance);
      return { type: instance.type, fields, fetchedAt: Date.now() };
    } catch (e) {
      return {
        type: instance.type,
        fields: [],
        error: e instanceof WidgetError ? e.message : "error",
        fetchedAt: Date.now(),
      };
    }
  },
});

export function fetchWidgetData(instance: WidgetInstance): Promise<WidgetData> {
  pendingInstances.set(instance.id, instance);
  return widgetMemo.get(instance.id);
}

/** container name -> widget data, fetched concurrently with per-instance caching */
export async function fetchAllWidgets(
  containers: ContainerSummary[],
): Promise<Record<string, WidgetData>> {
  const instances = resolveWidgetInstances(containers);
  const results = await Promise.all(
    instances.map(async (i) => {
      const data = await fetchWidgetData(i);
      // Tag per-response rather than on the cached object: the cache is keyed by
      // instance id and shared, but "configured" is a fact about the instance's
      // origin (config.json vs. a label), not about the fetched data itself.
      return [i.container, { ...data, configured: !i.id.startsWith("label:") }] as const;
    }),
  );
  return Object.fromEntries(results);
}
