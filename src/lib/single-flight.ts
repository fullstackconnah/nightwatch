// Import-free leaf (node:test cannot resolve "@/"). Single-flight + stale-while-revalidate cache,
// and a bounded wait that leaves the slow promise running.

export interface Swr<T> {
  /** Fresh cache: return it. Stale: return it and refresh in the background. Empty: await the one fetch. */
  get(): Promise<T>;
  /** Whatever is cached, fresh or stale. */
  peek(): T | undefined;
  /** Drop the cache and forget any in-flight fetch's result. */
  clear(): void;
}

export function createSwr<T>(fetch: () => Promise<T>, ttlMs: number, now: () => number = Date.now): Swr<T> {
  let cached: { data: T; ts: number } | undefined;
  let inflight: Promise<T> | undefined;
  let gen = 0;

  const refresh = (): Promise<T> => {
    if (inflight) return inflight;
    const myGen = gen;
    const p = fetch().then(
      (data) => {
        if (myGen === gen) {
          cached = { data, ts: now() };
          inflight = undefined;
        }
        return data;
      },
      (err) => {
        if (myGen === gen) inflight = undefined;
        throw err;
      },
    );
    inflight = p;
    return p;
  };

  return {
    get() {
      if (cached && now() - cached.ts < ttlMs) return Promise.resolve(cached.data);
      if (cached) {
        refresh().catch(() => {}); // keep the old data on failure
        return Promise.resolve(cached.data);
      }
      return refresh();
    },
    peek: () => cached?.data,
    clear() {
      cached = undefined;
      inflight = undefined;
      gen++;
    },
  };
}

/** Resolves with `p`, or with `fallback()` after `ms`. `p` is not cancelled and never rejects unhandled. */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: () => F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms);
  });
  p.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
