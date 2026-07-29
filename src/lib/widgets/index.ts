import { loadConfig, type WidgetInstance } from "@/lib/config";
import { parseDashboardLabels } from "@/lib/labels";
import type { ContainerSummary } from "@/lib/docker";
import { BUILTIN_WIDGETS } from "./builtins";
import { WidgetError, type WidgetData } from "./types";

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

const cache = new Map<string, WidgetData>();
const TTL_MS = 15_000;

export async function fetchWidgetData(instance: WidgetInstance): Promise<WidgetData> {
  const cached = cache.get(instance.id);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  const fetcher = BUILTIN_WIDGETS[instance.type] || BUILTIN_WIDGETS.generic;
  let data: WidgetData;
  try {
    const fields = await fetcher(instance);
    data = { type: instance.type, fields, fetchedAt: Date.now() };
  } catch (e) {
    data = {
      type: instance.type,
      fields: [],
      error: e instanceof WidgetError ? e.message : "error",
      fetchedAt: Date.now(),
    };
  }
  cache.set(instance.id, data);
  return data;
}

/** container name -> widget data, fetched concurrently with per-instance caching */
export async function fetchAllWidgets(
  containers: ContainerSummary[],
): Promise<Record<string, WidgetData>> {
  const instances = resolveWidgetInstances(containers);
  const results = await Promise.all(
    instances.map(async (i) => [i.container, await fetchWidgetData(i)] as const),
  );
  return Object.fromEntries(results);
}
