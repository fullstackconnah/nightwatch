/**
 * Shared TTL memo with in-flight deduplication.
 *
 * Generalises two working implementations that were already in this codebase:
 * disk-usage.ts's keyed `cache` + `inFlight` Map pair, and briefing.ts's
 * single-value `cached` + `inflight` guard. Everything else that caches on the
 * server (docker.ts, forgejo.ts, attention.ts, processes.ts, host-metrics.ts,
 * …) had the TTL half of that pattern but not the in-flight half, so two
 * requests arriving on a cold TTL — routine when a desk browser and a wall
 * tablet poll the same collector 50ms apart — each paid for the full
 * collection. That is the specific waste this module exists to remove.
 *
 * STATE LIVES ON globalThis, NOT ON THE INSTANCE. Next's dev server
 * re-evaluates a module on every hot reload, which would construct a fresh
 * `new Memo(...)` and silently drop whatever the previous one had cached —
 * exactly the bug that makes plain module-level `let` caches behave
 * differently in dev than in prod. A Memo is therefore a thin *handle*: the
 * `key` names a slot in a process-wide store, and two handles built from the
 * same key (before and after a reload) address the same state.
 *
 * `key` must be unique per cache. Collisions are silent and would hand one
 * collector another's data, so prefix with the owning module: "docker.stats",
 * "host.vitals", "forgejo.snapshot".
 */

/** One cached value plus the timestamp it was stored at. */
interface Entry<T> {
  data: T;
  ts: number;
}

/**
 * The mutable half of a memo. `inflight` is the dedup: while it is non-null
 * every caller receives that same promise rather than starting a second load.
 */
interface MemoState<T> {
  entry: Entry<T> | null;
  inflight: Promise<T> | null;
}

const globalForCache = globalThis as unknown as {
  __memoStore?: Map<string, unknown>;
};

const store: Map<string, unknown> = globalForCache.__memoStore ?? new Map<string, unknown>();
globalForCache.__memoStore = store;

function slot<T>(key: string): MemoState<T> {
  let state = store.get(key) as MemoState<T> | undefined;
  if (!state) {
    state = { entry: null, inflight: null };
    store.set(key, state);
  }
  return state;
}

export interface MemoOptions<T> {
  /**
   * Process-wide slot name. Must be unique — see the module comment on
   * collisions. Prefix with the owning module.
   */
  key: string;
  ttlMs: number;
  /**
   * Extra validity test applied to a still-fresh cached value. Return false to
   * force a reload despite the TTL not having expired.
   *
   * Exists because age is not the only staleness signal in this codebase:
   * docker.ts's container-runtime cache is invalidated by *membership* as well
   * as age (a container created since the last pass would otherwise show no
   * uptime until the TTL expired — precisely the moment someone is watching
   * it), and forgejo.ts's snapshot is only valid while the configured Forgejo
   * URL is unchanged.
   */
  isValid?: (cached: T) => boolean;
  /**
   * When `load` rejects and a previous value exists, resolve with that value
   * instead of rethrowing. Off by default.
   *
   * Exists for processes.ts, which resolves container ids to names and would
   * rather show the names it knew a moment ago than blank every row because
   * one docker call failed. Do NOT enable it where a stale value would be
   * read as current truth.
   */
  serveStaleOnError?: boolean;
  /** Injectable clock. Tests pass a fake; production never sets it. */
  now?: () => number;
}

/**
 * Single-value TTL memo.
 *
 * ```ts
 * const hostVitals = new Memo({
 *   key: "host.vitals",
 *   ttlMs: 2_000,
 *   load: () => collectHostVitals(),
 * });
 * // every route handler:
 * const vitals = await hostVitals.get();
 * ```
 */
export class Memo<T> {
  private readonly key: string;
  private readonly ttlMs: number;
  private readonly load: () => Promise<T>;
  private readonly isValid?: (cached: T) => boolean;
  private readonly serveStaleOnError: boolean;
  private readonly now: () => number;

  constructor(opts: MemoOptions<T> & { load: () => Promise<T> }) {
    this.key = opts.key;
    this.ttlMs = opts.ttlMs;
    this.load = opts.load;
    this.isValid = opts.isValid;
    this.serveStaleOnError = opts.serveStaleOnError ?? false;
    this.now = opts.now ?? Date.now;
  }

  /**
   * The cached value if it is fresh (and passes `isValid`), otherwise a load.
   *
   * `force: true` skips the cache READ but still joins an in-flight load —
   * a collection that started microseconds ago is already as fresh as a new
   * one, and starting a second parallel fan-out against the Docker socket is
   * strictly worse than waiting for the first. (This is a deliberate
   * improvement on the hand-rolled version in docker.ts, where two concurrent
   * `force` callers did fan out twice.)
   */
  get(opts?: { force?: boolean }): Promise<T> {
    const state = slot<T>(this.key);

    if (!opts?.force) {
      const cached = this.fresh(state);
      if (cached) return Promise.resolve(cached.data);
    }

    if (state.inflight) return state.inflight;

    const promise = this.load().then(
      (data) => {
        state.entry = { data, ts: this.now() };
        state.inflight = null;
        return data;
      },
      (err) => {
        // Clearing inflight BEFORE deciding what to return matters: a
        // rejected load that left this set would wedge every future caller
        // behind a promise that already settled. briefing.ts's guard learned
        // this the same way.
        state.inflight = null;
        if (this.serveStaleOnError && state.entry) return state.entry.data;
        throw err;
      },
    );

    state.inflight = promise;
    return promise;
  }

  /** The cached value regardless of age, or null if nothing is stored. */
  peek(): T | null {
    return slot<T>(this.key).entry?.data ?? null;
  }

  /**
   * Drop the cached value. Does NOT cancel an in-flight load — that load will
   * still populate the cache when it settles, which is correct: it was started
   * against the same upstream this invalidation is trying to re-read.
   */
  invalidate(): void {
    slot<T>(this.key).entry = null;
  }

  private fresh(state: MemoState<T>): Entry<T> | null {
    const entry = state.entry;
    if (!entry) return null;
    if (this.now() - entry.ts >= this.ttlMs) return null;
    if (this.isValid && !this.isValid(entry.data)) return null;
    return entry;
  }
}

export interface KeyedMemoOptions<T> extends Omit<MemoOptions<T>, "key"> {
  /** Slot-name prefix; each entry is stored as `${key}:${entryKey}`. */
  key: string;
  load: (entryKey: string) => Promise<T>;
}

/**
 * One TTL memo per key, sharing a single configuration.
 *
 * This is the shape disk-usage.ts already hand-rolls twice (scans keyed by disk
 * label, and directory scans keyed by normalised absolute path), and that oidc.ts
 * needs keyed by issuer. Each key gets its own entry, its own TTL clock and its
 * own in-flight promise, so a scan of /mnt/media never blocks or invalidates a
 * scan of /mnt/backup.
 */
export class KeyedMemo<T> {
  private readonly prefix: string;
  private readonly opts: KeyedMemoOptions<T>;
  /** Entry keys this instance has handed out, so `invalidate()` can clear all. */
  private readonly seen: Set<string>;

  constructor(opts: KeyedMemoOptions<T>) {
    this.prefix = opts.key;
    this.opts = opts;

    // The seen-set rides on globalThis for the same reason the entries do:
    // after a hot reload a fresh KeyedMemo must still be able to clear the
    // keys its predecessor populated.
    const seenKey = `${this.prefix}::keys`;
    let seen = store.get(seenKey) as Set<string> | undefined;
    if (!seen) {
      seen = new Set<string>();
      store.set(seenKey, seen);
    }
    this.seen = seen;
  }

  get(entryKey: string, opts?: { force?: boolean }): Promise<T> {
    return this.memo(entryKey).get(opts);
  }

  peek(entryKey: string): T | null {
    return this.memo(entryKey).peek();
  }

  /** Clear one entry, or every entry this memo has created when called bare. */
  invalidate(entryKey?: string): void {
    if (entryKey !== undefined) {
      this.memo(entryKey).invalidate();
      return;
    }
    for (const k of this.seen) this.memo(k).invalidate();
  }

  private memo(entryKey: string): Memo<T> {
    this.seen.add(entryKey);
    // Constructing a Memo per call is deliberate and cheap: it holds no state
    // of its own (see the module comment), so this is just a typed pointer at
    // the globalThis slot named below.
    return new Memo<T>({
      ...this.opts,
      key: `${this.prefix}:${entryKey}`,
      load: () => this.opts.load(entryKey),
    });
  }
}
