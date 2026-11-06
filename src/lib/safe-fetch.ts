const MAX_HOPS = 3;

/**
 * fetch that never follows a redirect to another origin: fetch keeps custom
 * headers (X-Api-Key) and a 307/308 body across hosts, so a stored key would
 * leak. Same-origin redirects (up to 3) are followed; anything else throws.
 */
export async function fetchNoCrossOriginRedirect(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  let req: RequestInit = { ...init, redirect: "manual" };
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, req);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    const next = new URL(location, current);
    const cur = new URL(current);
    // a force-SSL proxy in front of the same service upgrades http to https on the same host
    const upgrade = next.hostname === cur.hostname && cur.protocol === "http:" && next.protocol === "https:";
    if ((next.origin !== cur.origin && !upgrade) || hop >= MAX_HOPS) throw new Error("redirected to another host");
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && req.method?.toUpperCase() === "POST")) {
      req = { ...req, method: "GET", body: undefined };
    }
    current = next.href;
  }
}
