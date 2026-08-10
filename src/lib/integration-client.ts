/**
 * Base HTTP client for the homelab services this app talks to server-side
 * (Home Assistant, Forgejo, Nginx Proxy Manager, Hermes, Jellyfin).
 *
 * Every one of those modules independently implemented the same four-step
 * shape — look up credentials, fetch with an AbortSignal timeout, classify the
 * response, produce a human `detail` string — and independently declared the
 * same `unconfigured | unreachable | unauthorized | ok` vocabulary, twice as a
 * named type and twice inline. ha.ts alone produced the string "Home Assistant
 * returned a non-JSON response." at two separate call sites and the
 * did-not-respond-within-Ns string at three.
 *
 * THE INVARIANT THIS EXISTS TO PROTECT:
 *
 *   An upstream 401 must NEVER surface to the browser as an HTTP 401.
 *
 * src/lib/client.ts's `fetcher` treats a 401 as THIS app's session expiring
 * and redirects to /login — so a route that forwarded Home Assistant's own 401
 * would bounce a perfectly valid dashboard session to the login page because
 * somebody's HA token expired. /api/ha/states/route.ts documents this at
 * length. Encoding it in the type system is the point of returning `Probe<T>`
 * and never a `Response`: a subclass cannot reintroduce the bug, because it
 * never holds the object that would let it.
 *
 * Reuses the timeout/abort idiom from src/lib/widgets/types.ts's fetchJson
 * rather than replacing it — the widget fetchers keep their own thin helper
 * because they signal failure by throwing WidgetError (their errors are
 * rendered per-widget, not per-integration), which is a different contract
 * from the Probe union below.
 */

/** Every integration reports one of these. "ok" carries data; the rest carry prose. */
export type ProbeStatus = "unconfigured" | "unreachable" | "unauthorized" | "ok";

export interface ProbeOk<T> {
  status: "ok";
  data: T;
}

export interface ProbeFail {
  status: Exclude<ProbeStatus, "ok">;
  detail: string;
  /**
   * The HTTP status, when the failure came from an actual response rather than
   * a transport error or missing config. Lets a subclass reclassify a specific
   * code into its own richer vocabulary — HA turns 404 into "invalid" — without
   * ever being handed the Response itself.
   */
  httpStatus?: number;
}

export type Probe<T> = ProbeOk<T> | ProbeFail;

export function isProbeOk<T>(p: Probe<T>): p is ProbeOk<T> {
  return p.status === "ok";
}

export interface RequestOptions {
  method?: string;
  /** Serialised as JSON with the matching Content-Type when present. */
  body?: unknown;
  /**
   * Capture the response body as text on a non-OK response and append it to
   * `detail` (truncated). For action endpoints where the upstream's own
   * complaint is the useful part — HA's "refused light.toggle (HTTP 400): …".
   */
  includeErrorBody?: boolean;
}

export abstract class IntegrationClient<C> {
  /** Human name used in every generated detail string: "Home Assistant". */
  protected abstract readonly displayName: string;
  protected abstract readonly timeoutMs: number;
  /** What to say when the service has not been configured at all. */
  protected abstract readonly unconfiguredDetail: string;
  /** null when unconfigured — the one branch that never touches the network. */
  protected abstract credentials(): C | null;
  /** Origin to resolve `path` against, e.g. creds.url. No trailing slash. */
  protected abstract baseUrl(creds: C): string;
  protected abstract authHeaders(creds: C): Record<string, string>;

  /**
   * Overridable because this is the one message that is genuinely
   * service-specific: HA names the exact HA settings path to mint a new
   * long-lived token, which is the single most useful thing to say when a
   * homelab token has aged out.
   */
  protected unauthorizedDetail(httpStatus: number): string {
    return `${this.displayName} rejected the access token (HTTP ${httpStatus}).`;
  }

  /** `base` is passed in rather than read from instance state: a client is a
   *  singleton shared by concurrent requests, so anything stashed on `this`
   *  for the duration of one request is a race waiting to name the wrong host. */
  protected unreachableDetail(base: string): string {
    return `${this.displayName} at ${base} did not respond within ${this.timeoutMs / 1000}s.`;
  }

  protected unconfigured(): ProbeFail {
    return { status: "unconfigured", detail: this.unconfiguredDetail };
  }

  /**
   * One request, fully classified. Resolves — never rejects — so callers are
   * exhaustive by construction rather than by remembering a try/catch.
   */
  protected async request<T>(path: string, opts: RequestOptions = {}): Promise<Probe<T>> {
    const creds = this.credentials();
    if (!creds) return this.unconfigured();

    const base = this.baseUrl(creds);
    const headers: Record<string, string> = { ...this.authHeaders(creds) };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch {
      return { status: "unreachable", detail: this.unreachableDetail(base) };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        status: "unauthorized",
        detail: this.unauthorizedDetail(res.status),
        httpStatus: res.status,
      };
    }

    if (!res.ok) {
      let detail = `${this.displayName} returned HTTP ${res.status}.`;
      if (opts.includeErrorBody) {
        const text = (await res.text().catch(() => "")).trim();
        if (text) detail = `${this.displayName} returned HTTP ${res.status}: ${text.slice(0, 200)}`;
      }
      return { status: "unreachable", detail, httpStatus: res.status };
    }

    // 204 and friends: an action endpoint that succeeded with no body. Callers
    // wanting Probe<void> get `undefined` as data, which is the honest answer.
    if (res.status === 204) return { status: "ok", data: undefined as T };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        status: "unreachable",
        detail: `${this.displayName} returned a non-JSON response.`,
        httpStatus: res.status,
      };
    }

    return { status: "ok", data: body as T };
  }

  /**
   * Like `request`, but the response body is discarded — for action endpoints
   * whose success means "the service accepted it" and whose bodies are empty
   * or non-JSON. A non-JSON 200 is a SUCCESS here, not a parse failure.
   */
  protected async requestVoid(path: string, opts: RequestOptions = {}): Promise<Probe<void>> {
    const probe = await this.request<unknown>(path, opts);
    if (probe.status !== "ok") {
      // A non-JSON body on an otherwise-OK response is only a failure for
      // callers that wanted the JSON. Distinguish it by the absence of a
      // transport/auth failure: httpStatus present and < 400 means the
      // request itself succeeded.
      if (probe.httpStatus !== undefined && probe.httpStatus < 400) {
        return { status: "ok", data: undefined };
      }
      return probe;
    }
    return { status: "ok", data: undefined };
  }
}
