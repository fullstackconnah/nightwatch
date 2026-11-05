// Tells Jellyfin a file changed (PLAN B7, D11). The key comes from env only and is never logged or returned.
export interface JellyfinEnv {
  JELLYFIN_URL?: string;
  JELLYFIN_API_KEY?: string;
  JELLYFIN_ROOTS?: string;
}

export type JellyfinResult = "told" | "failed" | "off";

/** `movies=/media/movies,tv=/media/tv` to a map; a path under `movies/` becomes `/media/movies/...`. */
export function mapPath(rel: string, roots: string | undefined): string | null {
  const map = new Map((roots ?? "").split(",").map((p) => p.split("=") as [string, string]).filter((p) => p[0] && p[1]));
  const [top, ...rest] = rel.split("/");
  const base = map.get(top);
  return base ? [base.replace(/\/$/, ""), ...rest].join("/") : null;
}

export function createJellyfin(env: JellyfinEnv, log: (line: string) => void, fetchImpl: typeof fetch = fetch) {
  const url = env.JELLYFIN_URL?.replace(/\/$/, "");
  const key = env.JELLYFIN_API_KEY;
  let warnedOff = false;
  return {
    enabled: Boolean(url && key),
    async refresh(rel: string): Promise<JellyfinResult> {
      if (!url || !key) {
        if (!warnedOff) log("Jellyfin refresh is off (no JELLYFIN_URL or JELLYFIN_API_KEY); the library refreshes on its own schedule");
        warnedOff = true;
        return "off";
      }
      const path = mapPath(rel, env.JELLYFIN_ROOTS);
      if (!path) return "failed";
      try {
        const res = await fetchImpl(`${url}/Library/Media/Updated`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `MediaBrowser Token="${key}"` },
          body: JSON.stringify({ Updates: [{ Path: path, UpdateType: "Modified" }] }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return "told";
        log(`Jellyfin refresh failed: HTTP ${res.status}`);
      } catch (e) {
        log(`Jellyfin refresh failed: ${(e as Error).name}`);
      }
      return "failed";
    },
  };
}
