import test from "node:test";
import assert from "node:assert/strict";
import { backupVerdict, cachedBackupVerdict, BACKUP_WARN_DAYS, BACKUP_TTL_MS, BACKUP_RETRY_MS, BACKUP_GRACE_MS, type BackupRead } from "./backup-age.ts";
import { minecraftBackupStale } from "../attention-copy.ts";
import { ownerFor } from "../attention-report.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-23T12:00:00Z");
const inst = (slug: string, createdAt = "2026-01-01T00:00:00Z") => ({ slug, createdAt });
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const bk = (instance: string, daysAgo: number) => ({ instance, file: `${instance}-${daysAgo}.tgz`, sizeBytes: 1, modifiedAt: new Date(NOW - daysAgo * DAY).toISOString() });

test("14 days is the line: 13 is fine, 14 and 20 are stale", () => {
  assert.equal(BACKUP_WARN_DAYS, 14);
  assert.deepEqual(backupVerdict([inst("a")], [bk("a", 13)], NOW), { kind: "ok" });
  assert.deepEqual(backupVerdict([inst("a")], [bk("a", 14)], NOW), { kind: "stale", days: 14 });
  assert.deepEqual(backupVerdict([inst("a")], [bk("a", 20.5)], NOW), { kind: "stale", days: 20 });
});

test("the newest backup of an instance decides, not the oldest", () => {
  assert.deepEqual(backupVerdict([inst("a")], [bk("a", 40), bk("a", 2), bk("a", 90)], NOW), { kind: "ok" });
});

test("an instance with no backups has never been backed up", () => {
  assert.deepEqual(backupVerdict([inst("a")], [], NOW), { kind: "never" });
  assert.deepEqual(backupVerdict([inst("a")], [bk("other", 1)], NOW), { kind: "never" });
});

test("no instances gives no verdict, even with stray backups", () => {
  assert.deepEqual(backupVerdict([], [], NOW), { kind: "ok" });
  assert.deepEqual(backupVerdict([], [bk("a", 99)], NOW), { kind: "ok" });
});

test("several instances: the one with the oldest newest backup wins; never beats stale", () => {
  assert.deepEqual(backupVerdict([inst("a"), inst("b")], [bk("a", 1), bk("b", 30), bk("b", 45)], NOW), { kind: "stale", days: 30 });
  assert.deepEqual(backupVerdict([inst("a"), inst("b"), inst("c")], [bk("a", 1), bk("b", 30)], NOW), { kind: "never" });
});

test("a backup whose modifiedAt does not parse is ignored, so an old valid one still reads stale", () => {
  const junk = { ...bk("a", 1), modifiedAt: "not a date" };
  assert.deepEqual(backupVerdict([inst("a")], [junk, bk("a", 20)], NOW), { kind: "stale", days: 20 });
});

test("an instance whose only backups are unparsable has none", () => {
  const junk = { ...bk("a", 1), modifiedAt: "" };
  assert.deepEqual(backupVerdict([inst("a")], [junk], NOW), { kind: "never" });
});

test("a world made inside the 2-day grace is not 'never' yet; past it, it is", () => {
  assert.equal(BACKUP_GRACE_MS, 2 * DAY);
  assert.deepEqual(backupVerdict([inst("a", ago(1))], [], NOW), { kind: "ok" });
  assert.deepEqual(backupVerdict([inst("a", ago(3))], [], NOW), { kind: "never" });
});

test("a missing or unparsable createdAt with no backup is 'never'", () => {
  assert.deepEqual(backupVerdict([inst("a", "garbage")], [], NOW), { kind: "never" });
  assert.deepEqual(backupVerdict([{ slug: "a" } as never], [], NOW), { kind: "never" });
});

test("a new world skipped in grace does not hide another instance's stale backup", () => {
  assert.deepEqual(backupVerdict([inst("a", ago(1)), inst("b")], [bk("b", 30)], NOW), { kind: "stale", days: 30 });
});

let keyN = 0;
function reader(fetch: () => Promise<BackupRead | null>) {
  const t = { ms: NOW, calls: 0 };
  const read = cachedBackupVerdict(async () => { t.calls++; return fetch(); }, { key: `test.mcbackup.${keyN++}`, now: () => t.ms });
  return { t, read };
}
const stale: BackupRead = { instances: [inst("a")], backups: [bk("a", 20)] };

test("two reads inside the TTL call the manager once", async () => {
  const { t, read } = reader(async () => stale);
  await read();
  t.ms += BACKUP_TTL_MS - 1;
  assert.deepEqual(await read(), { kind: "stale", days: 20 });
  assert.equal(t.calls, 1);
});

test("a read that throws or answers null gives no hit when nothing was known", async () => {
  assert.deepEqual(await reader(async () => { throw new Error("boom"); }).read(), { kind: "ok" });
  assert.deepEqual(await reader(async () => null).read(), { kind: "ok" });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test("a changed answer shows once the TTL has passed (the refresh lands on the next read)", async () => {
  let current: BackupRead = stale;
  const { t, read } = reader(async () => current);
  assert.deepEqual(await read(), { kind: "stale", days: 20 });
  current = { instances: [inst("a")], backups: [bk("a", 0)] };
  t.ms += BACKUP_TTL_MS;
  await read(); // returns the old verdict at once and starts the refresh
  await tick();
  assert.deepEqual(await read(), { kind: "ok" });
  assert.equal(t.calls, 2);
});

test("a failed refresh holds the last verdict, and is retried only after the retry window", async () => {
  let fail = false;
  const { t, read } = reader(async () => (fail ? null : stale));
  await read();
  fail = true;
  t.ms += BACKUP_TTL_MS;
  await read(); // old verdict returned, refresh runs and fails
  await tick();
  assert.equal(t.calls, 2);
  assert.deepEqual(await read(), { kind: "stale", days: 20 });
  await tick();
  assert.equal(t.calls, 2, "no retry inside the window");
  t.ms += BACKUP_RETRY_MS;
  fail = false;
  await read(); // retry fires
  await tick();
  assert.equal(t.calls, 3, "retry after the window");
});

test("copy: stale names the days, never says never; no file or instance names", () => {
  const NB = " ";
  assert.equal(minecraftBackupStale(20).headline, `The Minecraft world has no backup for 20${NB}days`);
  assert.equal(minecraftBackupStale(1).headline, `The Minecraft world has no backup for 1${NB}day`);
  assert.equal(minecraftBackupStale(null).headline, "The Minecraft world has never been backed up");
  for (const c of [minecraftBackupStale(20), minecraftBackupStale(null)]) {
    assert.ok(c.detail && c.action);
    assert.doesNotMatch(`${c.headline} ${c.detail} ${c.action}`, /\.tgz|\.zip|slug/i);
  }
});

test("the owner link goes to the Minecraft page", () => {
  assert.deepEqual(ownerFor("minecraft", "backup-stale"), { href: "/minecraft", label: "Open Minecraft" });
});

test("the probe is registered only when the manager is configured, so an unconfigured one makes no call", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../attention.ts", import.meta.url), "utf8");
  assert.match(src, /mcManagerCredentials\(\)\s*\?\s*\[\{ id: "minecraft"/);
});
