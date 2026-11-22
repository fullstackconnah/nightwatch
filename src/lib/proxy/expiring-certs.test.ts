import test from "node:test";
import assert from "node:assert/strict";
import { expiringCerts, cachedExpiringCerts, certSeverity, WARN_DAYS, CERTS_TTL_MS, CERTS_RETRY_MS } from "./expiring-certs.ts";
import { certificateExpiring } from "../attention-copy.ts";
import { ownerFor } from "../attention-report.ts";

const snap = (daysLeft: Array<number | null>, status = "ok" as string) =>
  ({ status, certificates: daysLeft.map((d) => ({ daysLeft: d })) }) as Parameters<typeof expiringCerts>[0];

test("14 days is the line: 13 counts, 14 does not", () => {
  assert.equal(WARN_DAYS, 14);
  assert.deepEqual(expiringCerts(snap([13])), { count: 1, soonest: 13 });
  assert.deepEqual(expiringCerts(snap([14, 30])), { count: 0, soonest: null });
});

test("an unknown expiry (null) is never counted", () => {
  assert.deepEqual(expiringCerts(snap([null, null])), { count: 0, soonest: null });
});

test("an expired certificate counts, and soonest is the lowest", () => {
  assert.deepEqual(expiringCerts(snap([-3, 5, 12, 40])), { count: 3, soonest: -3 });
});

test("a snapshot that is not ok gives 0, whatever it holds", () => {
  for (const status of ["unconfigured", "unreachable", "unauthorized"]) {
    assert.deepEqual(expiringCerts(snap([1], status)), { count: 0, soonest: null }, status);
  }
});

let keyN = 0;
/** A reader with its own memo slot, a counting fake snapshot and a fake clock. */
function reader(fetch: () => Promise<Parameters<typeof expiringCerts>[0]>) {
  const t = { ms: 0, calls: 0 };
  const read = cachedExpiringCerts(async () => { t.calls++; return fetch(); }, { key: `test.certs.${keyN++}`, now: () => t.ms });
  return { t, read };
}

test("a fetch that throws gives 0", async () => {
  assert.deepEqual(await reader(async () => { throw new Error("boom"); }).read(), { count: 0, soonest: null });
  assert.deepEqual(await reader(async () => snap([2])).read(), { count: 1, soonest: 2 });
});

test("two reads inside the hour call the snapshot once", async () => {
  const { t, read } = reader(async () => snap([2]));
  await read();
  t.ms = CERTS_TTL_MS - 1;
  assert.deepEqual(await read(), { count: 1, soonest: 2 });
  assert.equal(t.calls, 1);
});

test("after the hour the last result is returned at once while one refresh runs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let first = true;
  const { t, read } = reader(async () => { if (first) { first = false; return snap([2]); } await gate; return snap([]); });
  await read();
  t.ms = CERTS_TTL_MS;
  assert.deepEqual(await read(), { count: 1, soonest: 2 });
  assert.deepEqual(await read(), { count: 1, soonest: 2 });
  assert.equal(t.calls, 2, "one refresh in flight, not two");
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await read(), { count: 0, soonest: null });
  assert.equal(t.calls, 2);
});

test("a not-ok reading is retried after 5 minutes, not an hour", async () => {
  let status = "unreachable";
  const { t, read } = reader(async () => snap([1], status));
  assert.deepEqual(await read(), { count: 0, soonest: null });
  t.ms = CERTS_RETRY_MS - 1;
  await read();
  assert.equal(t.calls, 1);
  status = "ok";
  t.ms = CERTS_RETRY_MS;
  await read(); // returns the stale 0 and refreshes behind it
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await read(), { count: 1, soonest: 1 });
  assert.equal(t.calls, 2);
});

const NB = " ";

test("copy: one certificate", () => {
  assert.equal(certificateExpiring(1, 9).headline, `A certificate expires in 9${NB}days`);
  assert.equal(certificateExpiring(1, 1).headline, `A certificate expires in 1${NB}day`);
  assert.equal(certificateExpiring(1, 0).headline, "A certificate expires today");
  assert.equal(certificateExpiring(1, -1).headline, "A certificate has expired");
  assert.equal(certificateExpiring(1, 9).detail, "It has not been renewed.");
  assert.equal(certificateExpiring(1, 9).action, "Open Proxy to see which one.");
});

test("copy: several certificates", () => {
  const c = certificateExpiring(3, 2);
  assert.equal(c.headline, "3 certificates need renewing");
  assert.equal(c.detail, "They have not been renewed.");
  assert.equal(c.action, "Open Proxy to see which ones.");
});

test("copy stays inside the kiosk budgets (48 / 100 / 70)", () => {
  for (const c of [certificateExpiring(1, 13), certificateExpiring(12, 2), certificateExpiring(1, -5)]) {
    assert.ok(c.headline.length <= 48 && (c.detail ?? "").length <= 100 && (c.action ?? "").length <= 70);
  }
});

test("severity (certSeverity): warn at 13 and 7, bad at 6 and -1", () => {
  assert.deepEqual([13, 7, 6, -1].map(certSeverity), ["warn", "warn", "bad", "bad"]);
});

test("the owner of a cert hit is the Proxy page", () => {
  assert.deepEqual(ownerFor("certs", "cert-expiring"), { href: "/proxy", label: "Open Proxy" });
});
