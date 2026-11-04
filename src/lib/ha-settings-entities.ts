/** Pure helpers for hiding HA "settings" entities (entity_category config/diagnostic) from the kiosk. */

const HIDDEN_CATEGORIES = new Set(["config", "diagnostic"]);

/** Entity ids from a `config/entity_registry/list` result whose category marks a setting. */
export function hiddenIdsFromRegistry(entries: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const { entity_id, entity_category } = e as { entity_id?: unknown; entity_category?: unknown };
    if (typeof entity_id === "string" && typeof entity_category === "string" && HIDDEN_CATEGORIES.has(entity_category)) {
      out.add(entity_id);
    }
  }
  return out;
}

export function withoutSettingsEntities<T extends Record<string, { entityId: string }[]>>(
  entities: T,
  hidden: ReadonlySet<string>,
): T {
  if (hidden.size === 0) return entities;
  const out = {} as Record<string, { entityId: string }[]>;
  for (const [k, list] of Object.entries(entities)) out[k] = list.filter((x) => !hidden.has(x.entityId));
  return out as T;
}

/** Any failure shows everything, as before this filter existed. */
export async function readHiddenFailOpen(read: () => Promise<Set<string>>): Promise<Set<string>> {
  try {
    return await read();
  } catch {
    return new Set();
  }
}

/** Opens the HA websocket once and lists the registry. Rejects on any failure; callers fail open. */
export function fetchRegistryHiddenIds(creds: { url: string; token: string }, timeoutMs: number): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(creds.url.replace(/\/+$/, "").replace(/^http/, "ws") + "/api/websocket");
    const timer = setTimeout(() => done(new Error("timeout")), timeoutMs);
    function done(err: Error | null, ids?: Set<string>) {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      if (err) reject(err); else resolve(ids!);
    }
    ws.onerror = () => done(new Error("websocket error"));
    ws.onclose = () => done(new Error("websocket closed"));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: creds.token }));
        else if (msg.type === "auth_ok") ws.send(JSON.stringify({ id: 1, type: "config/entity_registry/list" }));
        else if (msg.type === "auth_invalid") done(new Error("auth rejected"));
        else if (msg.type === "result" && msg.id === 1) {
          if (msg.success) done(null, hiddenIdsFromRegistry(msg.result));
          else done(new Error("registry list refused"));
        }
      } catch (e) {
        done(e instanceof Error ? e : new Error("bad message"));
      }
    };
  });
}

/** Cached, single-flight registry read. A failure caches an empty set for failTtlMs so a down websocket costs one wait per window, not one per poll. */
export function createHiddenIdsCache(opts: {
  read: () => Promise<Set<string>>;
  ttlMs: number;
  failTtlMs: number;
  now?: () => number;
  onFail?: () => void;
}): () => Promise<Set<string>> {
  const now = opts.now ?? Date.now;
  let cached: { until: number; ids: Set<string> } | null = null;
  let inflight: Promise<Set<string>> | null = null;
  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.ids);
    inflight ??= opts.read().then(
      (ids) => { cached = { until: now() + opts.ttlMs, ids }; return ids; },
      () => { opts.onFail?.(); const ids = new Set<string>(); cached = { until: now() + opts.failTtlMs, ids }; return ids; },
    ).finally(() => { inflight = null; });
    return inflight;
  };
}
