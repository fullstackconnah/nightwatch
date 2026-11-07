import test from "node:test";
import assert from "node:assert/strict";
import type { ProxyCertificate, ProxyManagerSnapshot, ProxyRoute } from "../types/npm.ts";
import { certVariant, daysSinceExpiry, proxyModel, type Model, type ModelInput } from "./page-model.ts";

const NOW = Date.parse("2026-11-06T10:00:00Z");
const NPM = "http://npm.test:81";
const route = (id: number, o: Partial<ProxyRoute> = {}): ProxyRoute => ({
  id, kind: "proxy", domains: [`r${id}.example.test`], target: "http://upstream.test:8080", enabled: true, health: "up", cert: null, ...o,
});
const cert = (id: number, daysLeft: number | null, domain = `c${id}.example.test`): ProxyCertificate => ({
  id, domains: [domain], provider: "letsencrypt", expiresOn: null, daysLeft,
});
function ok(o: Partial<ProxyManagerSnapshot> = {}): ProxyManagerSnapshot {
  return {
    status: "ok", npmUrl: NPM,
    routes: Array.from({ length: 12 }, (_, i) => route(i + 1)),
    certificates: [cert(1, 41), cert(2, 60)],
    ...o,
  };
}
function input(o: Partial<ModelInput> = {}): ModelInput {
  return { data: ok(), loadError: false, lastOkAt: NOW - 4000, now: NOW, ...o };
}
const strip = (m: Model, id: string) => m.strips.find((s) => s.id === id)!;
const withRoutes = (n: number, over: Record<number, Partial<ProxyRoute>>) =>
  Array.from({ length: n }, (_, i) => route(i + 1, over[i + 1]));

test("loading, load error, and the three connection states: connection head, no strips, nothing opens", () => {
  assert.deepEqual(proxyModel(input({ data: undefined, lastOkAt: null })).chip, { tone: "neutral", label: "Checking" });
  assert.equal(proxyModel(input({ data: undefined, loadError: true, lastOkAt: null })).chip.label, "No answer");
  const cases: [ProxyManagerSnapshot["status"], string, string][] = [
    ["unconfigured", "Not connected", "Nginx Proxy Manager isn’t connected yet."],
    ["unauthorized", "Token rejected", "Nginx Proxy Manager rejected the token. Check it in Settings → NPM."],
    ["unreachable", "Not answering", "Nginx Proxy Manager isn’t answering. Routes and certificates are paused until it’s back."],
  ];
  for (const [status, chip, answer] of cases) {
    const m = proxyModel(input({ data: { status, detail: "connect ECONNREFUSED 10.1.2.3:81", routes: [], certificates: [], npmUrl: NPM } }));
    assert.equal(m.chip.label, chip);
    assert.equal(m.answer, answer);
    assert.deepEqual(m.strips, []);
    assert.equal(m.autoTarget, "keep");
    assert.doesNotMatch(JSON.stringify(m), /10\.1\.2\.3|ECONNREFUSED|npm\.test/);
  }
  const u = proxyModel(input({ data: { status: "unconfigured", routes: [], certificates: [], npmUrl: null } }));
  assert.deepEqual(u.link, { href: "/settings#npm", label: "Open Settings" });
});

test("calm: All up, next certificate in the answer, two strips, nothing opens, Open NPM admin", () => {
  const m = proxyModel(input());
  assert.deepEqual(m.chip, { tone: "ok", label: "All up" });
  assert.equal(m.answer, "All 12 routes are up. The next certificate to expire is c1.example.test, in 41 days.");
  assert.deepEqual(m.strips.map((s) => s.id), ["routes", "certs"]);
  assert.equal(strip(m, "routes").state, "12 up");
  assert.equal(strip(m, "certs").state, "Next: c1.example.test in 41 days");
  assert.ok(m.strips.every((s) => s.tone === null));
  assert.equal(m.autoTarget, null);
  assert.equal(m.stale, false);
  assert.equal(m.evidence, "Updated 4 s ago · checks every 30 s");
  assert.deepEqual(m.link, { href: NPM, label: "Open NPM admin" });
  assert.doesNotMatch(m.answer + m.evidence + JSON.stringify(m.strips), /npm\.test/);
});

test("calm: one route, no certificates, certificates without an expiry", () => {
  assert.equal(proxyModel(input({ data: ok({ routes: [route(1)], certificates: [] }) })).answer, "The route is up.");
  assert.equal(strip(proxyModel(input({ data: ok({ certificates: [] }) })), "certs").state, "None");
  const m = proxyModel(input({ data: ok({ certificates: [cert(1, null)] }) }));
  assert.equal(m.answer, "All 12 routes are up.");
  assert.equal(strip(m, "certs").state, "No expiry dates");
});

test("routes down: bad chip, domains named (first two, then and N more), Routes opens with the answer", () => {
  const one = proxyModel(input({ data: ok({ routes: withRoutes(12, { 3: { health: "down" } }) }) }));
  assert.deepEqual(one.chip, { tone: "bad", label: "1 down" });
  assert.equal(one.answer, "1 route is down: r3.example.test.");
  const two = proxyModel(input({ data: ok({ routes: withRoutes(12, { 3: { health: "down" }, 5: { health: "down" } }) }) }));
  assert.equal(two.chip.label, "2 down");
  assert.equal(two.answer, "2 routes are down: r3.example.test, r5.example.test.");
  assert.equal(strip(two, "routes").state, "2 down · 10 up");
  assert.equal(strip(two, "routes").tone, "bad");
  assert.equal(two.autoTarget, "routes");
  assert.equal(two.detailLead, two.answer);
  const three = proxyModel(input({ data: ok({ routes: withRoutes(12, { 1: { health: "down" }, 2: { health: "down" }, 3: { health: "down" } }) }) }));
  assert.equal(three.answer, "3 routes are down: r1.example.test, r2.example.test and 1 more.");
});

test("C23: down outranks a bad cert, a bad cert outranks a warn cert, the soonest cert is picked, null days never count", () => {
  const down = withRoutes(12, { 2: { health: "down" } });
  assert.equal(proxyModel(input({ data: ok({ routes: down, certificates: [cert(1, 2)] }) })).chip.label, "1 down");
  const bad = proxyModel(input({ data: ok({ certificates: [cert(1, 21, "warn.example.test"), cert(2, 3, "bad.example.test")] }) }));
  assert.deepEqual(bad.chip, { tone: "bad", label: "Cert expiring" });
  assert.equal(bad.answer, "The certificate for bad.example.test expires in 3 days.");
  assert.equal(strip(bad, "certs").state, "bad.example.test expires in 3 days");
  assert.equal(strip(bad, "certs").tone, "bad");
  assert.equal(bad.autoTarget, "certs");
  const warn = proxyModel(input({ data: ok({ certificates: [cert(1, null, "none.example.test"), cert(2, 21, "warn.example.test"), cert(3, 41)] }) }));
  assert.deepEqual(warn.chip, { tone: "warn", label: "Cert soon" });
  assert.equal(warn.answer, "The certificate for warn.example.test expires in 21 days.");
  assert.equal(strip(warn, "certs").tone, "warn");
  assert.equal(warn.autoTarget, "certs");
  const nullOnly = proxyModel(input({ data: ok({ certificates: [cert(1, null)] }) }));
  assert.equal(nullOnly.chip.label, "All up");
  assert.equal(proxyModel(input({ data: ok({ certificates: [cert(1, 3), cert(2, 1)] }) })).answer, "The certificate for c2.example.test expires in 1 day.");
});

test("expired and same-day certificates", () => {
  const gone = proxyModel(input({ data: ok({ certificates: [cert(1, -8, "old.example.test")] }) }));
  assert.equal(gone.chip.label, "Cert expiring");
  assert.equal(gone.answer, "The certificate for old.example.test expired 7 days ago.");
  assert.equal(strip(gone, "certs").state, "old.example.test expired 7 days ago");
  assert.equal(proxyModel(input({ data: ok({ certificates: [cert(1, 0)] }) })).answer, "The certificate for c1.example.test expires today.");
  // B3: daysLeft is floored, so -1 is "expired less than 24 h ago".
  assert.equal(proxyModel(input({ data: ok({ certificates: [cert(1, -1)] }) })).answer, "The certificate for c1.example.test expired today.");
  // 25 h ago floors to -2: one whole day since expiry.
  assert.equal(proxyModel(input({ data: ok({ certificates: [cert(1, -2)] }) })).answer, "The certificate for c1.example.test expired 1 day ago.");
  assert.equal(daysSinceExpiry(-1), 0);
  assert.equal(daysSinceExpiry(-2), 1);
  assert.equal(daysSinceExpiry(-8), 7);
  assert.equal(certVariant(null), "neutral");
  assert.equal(certVariant(6), "bad");
  assert.equal(certVariant(7), "warn");
  assert.equal(certVariant(29), "warn");
  assert.equal(certVariant(30), "neutral");
});

test("health unknown on some: Up, not All up; all unknown claims nothing", () => {
  const m = proxyModel(input({ data: ok({ routes: withRoutes(12, { 3: { health: "unknown" }, 4: { health: "unknown", kind: "redirection" } }) }) }));
  assert.deepEqual(m.chip, { tone: "ok", label: "Up" });
  assert.equal(m.answer, "10 routes are up; 2 have no health result yet.");
  assert.equal(strip(m, "routes").state, "10 up · 2 unknown");
  assert.equal(m.autoTarget, null);
  const one = proxyModel(input({ data: ok({ routes: [route(1), route(2, { health: "unknown" })] }) }));
  assert.equal(one.answer, "1 route is up; 1 has no health result yet.");
  const none = proxyModel(input({ data: ok({ routes: withRoutes(2, { 1: { health: "unknown" }, 2: { health: "unknown" } }) }) }));
  assert.deepEqual(none.chip, { tone: "neutral", label: "No health" });
  assert.equal(none.answer, "None of the 2 routes has a health result yet.");
});

test("a down route with unknown ones: the routes line counts all three", () => {
  const m = proxyModel(input({ data: ok({ routes: withRoutes(5, { 1: { health: "down" }, 2: { health: "unknown" } }) }) }));
  assert.equal(strip(m, "routes").state, "1 down · 3 up · 1 unknown");
});

test("no routes: neutral, no strips", () => {
  const m = proxyModel(input({ data: ok({ routes: [], certificates: [] }) }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "No routes" });
  assert.equal(m.answer, "Nginx Proxy Manager has no proxy or redirection hosts yet.");
  assert.deepEqual(m.strips, []);
  assert.equal(m.link?.label, "Open NPM admin");
});

test("C22 stale: Stale chip, old answer, never All up", () => {
  for (const o of [{ loadError: true }, { lastOkAt: NOW - 100_000 }]) {
    const m = proxyModel(input(o));
    assert.deepEqual(m.chip, { tone: "neutral", label: "Stale" });
    assert.match(m.answer, /^Showing what was true .+ ago: All 12 routes are up\./);
    assert.equal(m.notice, "Controls are paused while the page shows old data.");
    assert.equal(m.autoTarget, "keep");
    assert.equal(m.stale, true);
    assert.equal(m.strips.length, 2);
  }
  assert.equal(proxyModel(input({ lastOkAt: NOW - 85_000 })).stale, false);
});
