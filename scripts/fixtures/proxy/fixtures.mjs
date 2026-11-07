/* Fixtures for scripts/git-proxy-shots.mjs: the /api/proxy-manager answer, one per capture state of the strips
 * pattern 4 spec. Placeholders only (the repo is public): hosts are example names, no address appears anywhere. "hang"
 * never answers (loading); "fail" answers HTTP 500 (load error). */

export const NOW = Date.parse("2026-11-06T10:00:00Z");
const NPM = "http://npm.example.test:81";

const route = (id, over = {}) => ({
  id, kind: "proxy", domains: [`app${id}.example.test`], target: `http://upstream${id}.example.test:8080`, enabled: true, health: "up",
  cert: { provider: "letsencrypt", expiresOn: null, daysLeft: 41 }, ...over,
});
const cert = (id, daysLeft, domain = `app${id}.example.test`) => ({ id, domains: [domain], provider: "letsencrypt", expiresOn: null, daysLeft });
const routes = (n, over = {}) => Array.from({ length: n }, (_, i) => route(i + 1, over[i + 1]));

export const ok = (over = {}) => ({ status: "ok", npmUrl: NPM, routes: routes(12), certificates: [cert(1, 41), cert(2, 60)], ...over });

const empty = (status, detail) => ({ status, detail, npmUrl: NPM, routes: [], certificates: [] });

export const FIXTURES = {
  loading: "hang",
  loadError: "fail",
  calm: ok(),
  routesDown: ok({ routes: routes(12, { 3: { health: "down" }, 5: { health: "down" } }) }),
  certUnder7: ok({ certificates: [cert(1, 3, "app1.example.test"), cert(2, 21, "app2.example.test"), cert(3, 60)] }),
  // H14U: expired 2 h ago; the server floors that to -1 day, and the page must say "expired today".
  expiredToday: ok({ certificates: [cert(1, -1, "app1.example.test"), cert(2, 60)] }),
  // H14U: expired 25 h ago floors to -2; the page must say "expired 1 day ago".
  expired1d: ok({ certificates: [cert(1, -2, "app1.example.test"), cert(2, 60)] }),
  certUnder30: ok({ certificates: [cert(1, 21, "app1.example.test"), cert(2, 60)] }),
  healthUnknown: ok({ routes: routes(12, { 3: { health: "unknown" }, 4: { health: "unknown", kind: "redirection" } }) }),
  noRoutes: ok({ routes: [], certificates: [] }),
  unconfigured: { status: "unconfigured", npmUrl: null, routes: [], certificates: [] },
  unauthorized: empty("unauthorized", "401 from the server"),
  unreachable: empty("unreachable", "connect ECONNREFUSED"),
};
