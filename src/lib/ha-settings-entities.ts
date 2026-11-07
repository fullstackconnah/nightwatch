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

/** Only these lists are controls; sensors (HA marks battery levels diagnostic) must stay visible. */
const CONTROL_KEYS = ["switches", "lights"];

export function withoutSettingsEntities<T extends Record<string, { entityId: string }[]>>(
  entities: T,
  hidden: ReadonlySet<string>,
): T {
  if (hidden.size === 0) return entities;
  const out = { ...entities } as Record<string, { entityId: string }[]>;
  for (const k of CONTROL_KEYS) if (out[k]) out[k] = out[k].filter((x) => !hidden.has(x.entityId));
  return out as T;
}

/** The kiosk route body: locks emptied (physical-security boundary), settings switches and lights hidden. */
export function kioskEntities<T extends { locks: { entityId: string }[] }>(
  entities: T,
  hidden: ReadonlySet<string>,
): T {
  return withoutSettingsEntities({ ...entities, locks: [] } as T & Record<string, { entityId: string }[]>, hidden);
}

/** Any failure shows everything, as before this filter existed. */
export async function readHiddenFailOpen(read: () => Promise<Set<string>>): Promise<Set<string>> {
  try {
    return await read();
  } catch {
    return new Set();
  }
}

/** Write-side twin of the filter above: only lights and switches can be hidden. A null set (read failed) fails closed for those two. */
export function kioskActionRefusal(entityId: string, hidden: ReadonlySet<string> | null): null | "hidden" | "unknown" {
  if (!/^(light|switch)\./.test(entityId)) return null;
  if (!hidden) return "unknown";
  return hidden.has(entityId.toLowerCase()) ? "hidden" : null; // HA lowercases ids
}

/** Entities the voice route may match: the kiosk view, and with no hidden set (read failed) no lights or switches. */
export function kioskVoiceEntities<T extends { locks: { entityId: string }[] }>(
  entities: T,
  hidden: ReadonlySet<string> | null,
): T {
  if (hidden) return kioskEntities(entities, hidden);
  return { ...kioskEntities(entities, new Set()), lights: [], switches: [] };
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

/** Cached, single-flight registry read. A failure is cached for failTtlMs and the getter rejects until it expires, so a down websocket costs one wait per window, not one per poll. */
export function createHiddenIdsCache(opts: {
  read: () => Promise<Set<string>>;
  ttlMs: number;
  failTtlMs: number;
  now?: () => number;
  onFail?: () => void;
}): () => Promise<Set<string>> {
  const now = opts.now ?? Date.now;
  let cached: { until: number; ids: Set<string> | null } | null = null;
  let inflight: Promise<Set<string>> | null = null;
  return () => {
    if (cached && now() < cached.until) return cached.ids ? Promise.resolve(cached.ids) : Promise.reject(new Error("registry unavailable"));
    inflight ??= opts.read().then(
      (ids) => { cached = { until: now() + opts.ttlMs, ids }; return ids; },
      (err) => { opts.onFail?.(); cached = { until: now() + opts.failTtlMs, ids: null }; throw err; },
    ).finally(() => { inflight = null; });
    return inflight;
  };
}
