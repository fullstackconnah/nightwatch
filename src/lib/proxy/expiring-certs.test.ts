import test from "node:test";
import assert from "node:assert/strict";
import { expiringCerts, expiringCertsFrom, WARN_DAYS } from "./expiring-certs.ts";
import { certificateExpiring } from "../attention-copy.ts";
import { certVariant } from "./page-model.ts";
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

test("a fetch that throws gives 0", async () => {
  assert.deepEqual(await expiringCertsFrom(async () => { throw new Error("boom"); }), { count: 0, soonest: null });
  assert.deepEqual(await expiringCertsFrom(async () => snap([2])), { count: 1, soonest: 2 });
});

const NB = " ";

test("copy: one certificate", () => {
  assert.equal(certificateExpiring(1, 9).headline, `A certificate expires in 9${NB}days`);
  assert.equal(certificateExpiring(1, 1).headline, `A certificate expires in 1${NB}day`);
  assert.equal(certificateExpiring(1, 0).headline, "A certificate expires today");
  assert.equal(certificateExpiring(1, -1).headline, "A certificate has expired");
  assert.equal(certificateExpiring(1, 9).detail, "It has not renewed on its own.");
  assert.equal(certificateExpiring(1, 9).action, "Open Proxy to see which one.");
});

test("copy: several certificates", () => {
  const c = certificateExpiring(3, 2);
  assert.equal(c.headline, "3 certificates need renewing");
  assert.equal(c.detail, "They have not renewed on their own.");
  assert.equal(c.action, "Open Proxy to see which ones.");
});

test("copy stays inside the kiosk budgets (48 / 100 / 70)", () => {
  for (const c of [certificateExpiring(1, 13), certificateExpiring(12, 2), certificateExpiring(1, -5)]) {
    assert.ok(c.headline.length <= 48 && (c.detail ?? "").length <= 100 && (c.action ?? "").length <= 70);
  }
});

test("severity follows certVariant: warn at 13 and 7, bad at 6 and -1", () => {
  assert.deepEqual([13, 7, 6, -1].map((d) => certVariant(d) === "bad" ? "bad" : "warn"), ["warn", "warn", "bad", "bad"]);
});

test("the owner of a cert hit is the Proxy page", () => {
  assert.deepEqual(ownerFor("certs", "cert-expiring"), { href: "/proxy", label: "Open Proxy" });
});
