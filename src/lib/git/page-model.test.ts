import test from "node:test";
import assert from "node:assert/strict";
import type { GitMirror, GitSnapshot, GitSnapshotOk } from "../types/forgejo.ts";
import { gitModel, safeLine, type Model, type ModelInput } from "./page-model.ts";

const NOW = Date.parse("2026-11-06T10:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const H = 3_600_000;
const D = 24 * H;
const URL_ = "http://forge.test:3010";
const mirror = (repo: string, o: Partial<GitMirror> = {}): GitMirror => ({
  repo, target: `https://github.com/example/${repo.split("/")[1]}`, lastSync: iso(-H), lastError: null, interval: "8h0m0s", defaultBranch: { state: "synced" }, ...o,
});
const repo = (name: string) => ({ id: 1, owner: "lab", name, fullName: `lab/${name}`, private: false, htmlUrl: `${URL_}/lab/${name}`, defaultBranch: "main", updatedAt: iso(-H) });
function ok(o: Partial<GitSnapshotOk> = {}): GitSnapshotOk {
  return {
    status: "ok", forgejoUrl: URL_,
    repos: [repo("a"), repo("b"), repo("c"), repo("d")],
    stream: [{ repo: "lab/a", sha: "1", shortSha: "1", message: "Fix the thing", authorName: "x", date: iso(-3 * H), htmlUrl: `${URL_}/c/1` }],
    pulls: [
      { repo: "lab/a", number: 1, title: "One", author: null, createdAt: iso(-1 * D), htmlUrl: `${URL_}/p/1` },
      { repo: "lab/b", number: 2, title: "Two", author: null, createdAt: iso(-5 * D), htmlUrl: `${URL_}/p/2` },
    ],
    branches: [
      { repo: "lab/a", name: "main", commitDate: iso(-H), isDefault: true },
      { repo: "lab/a", name: "feat/x", commitDate: iso(-2 * H), isDefault: false },
      { repo: "lab/b", name: "fix/y", commitDate: iso(-3 * H), isDefault: false },
      { repo: "lab/c", name: "feat/z", commitDate: iso(-4 * H), isDefault: false },
    ],
    mirrors: ["lab/a", "lab/b", "lab/c", "lab/d"].map((r) => mirror(r)),
    ...o,
  };
}
function input(o: Partial<ModelInput> = {}): ModelInput {
  return { data: ok(), loadError: false, lastOkAt: NOW - 4000, now: NOW, ...o };
}
const strip = (m: Model, id: string) => m.strips.find((s) => s.id === id)!;
const PAUSED = "Controls are paused while the page shows old data.";

test("loading: Checking, no strips, Sync off, nothing opens", () => {
  const m = gitModel(input({ data: undefined, lastOkAt: null }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Checking" });
  assert.equal(m.answer, "Connecting to Forgejo…");
  assert.deepEqual(m.strips, []);
  assert.equal(m.writes[0].enabled, false);
  assert.equal(m.autoTarget, "keep");
});

test("load error with no data: No answer, no strips", () => {
  const m = gitModel(input({ data: undefined, loadError: true, lastOkAt: null }));
  assert.equal(m.chip.label, "No answer");
  assert.deepEqual(m.strips, []);
  assert.equal(m.writes[0].enabled, false);
});

test("unconfigured, unauthorized, unreachable: connection head, no strips, no host or detail on screen", () => {
  const none: [] = [];
  const base = { repos: none, stream: none, pulls: none, branches: none, mirrors: none };
  const cases: [GitSnapshot, string, string][] = [
    [{ status: "unconfigured", forgejoUrl: null, detail: "Create the admin account at http://10.1.2.3:3010", ...base }, "Not connected", "Forgejo isn’t connected yet."],
    [{ status: "unauthorized", forgejoUrl: URL_, detail: "401 from 10.1.2.3", ...base }, "Token rejected", "Forgejo rejected the token. Check it in Settings → Forgejo."],
    [{ status: "unreachable", forgejoUrl: URL_, detail: "connect ECONNREFUSED 10.1.2.3:3010", ...base }, "Not answering", "Forgejo isn’t answering. Commits, pull requests and mirrors are paused until it’s back."],
  ];
  for (const [data, chip, answer] of cases) {
    const m = gitModel(input({ data }));
    assert.equal(m.chip.label, chip);
    assert.equal(m.answer, answer);
    assert.deepEqual(m.strips, []);
    assert.equal(m.writes[0].enabled, false);
    assert.equal(m.autoTarget, "keep");
    assert.doesNotMatch(JSON.stringify(m), /10\.1\.2\.3|ECONNREFUSED|401 from|forge\.test/);
  }
  assert.equal(gitModel(input({ data: { status: "unconfigured", forgejoUrl: null, detail: "", ...base } })).link?.href, "/settings#forgejo");
});

test("calm: In sync, the counts in the answer, four strips in order, Sync on, nothing opens", () => {
  const m = gitModel(input());
  assert.deepEqual(m.chip, { tone: "ok", label: "In sync" });
  assert.equal(m.answer, "All 4 mirrors are in sync with GitHub. 2 open pull requests; last commit 3 h ago in lab/a.");
  assert.deepEqual(m.strips.map((s) => s.id), ["mirrors", "pulls", "branches", "commits"]);
  assert.equal(strip(m, "mirrors").state, "4 in sync");
  assert.equal(strip(m, "pulls").state, "2 open · newest 24 h ago");
  assert.equal(strip(m, "branches").state, "3 off the default branch");
  assert.equal(strip(m, "commits").state, "3 h ago · lab/a: Fix the thing");
  assert.ok(m.strips.every((s) => s.tone === null));
  assert.deepEqual(m.writes, [{ id: "sync", enabled: true, reason: null }]);
  assert.equal(m.autoTarget, null);
  assert.equal(m.notice, null);
  assert.equal(m.stale, false);
  assert.match(m.evidence, /^Updated 4 s ago · checks every 60 s$/);
  assert.deepEqual(m.link, { href: URL_, label: "Open Forgejo" });
  assert.doesNotMatch(m.answer + m.evidence + JSON.stringify(m.strips), /forge\.test/);
});

test("calm: singular mirror and pull request, no pull requests, no commits, empty branch states", () => {
  const m = gitModel(input({ data: ok({ mirrors: [mirror("lab/a")], pulls: [], stream: [] }) }));
  assert.equal(m.answer, "The mirror is in sync with GitHub. No open pull requests; no commits yet.");
  assert.equal(strip(m, "pulls").state, "None open");
  assert.equal(strip(m, "commits").state, "No commits yet");
  assert.equal(gitModel(input({ data: ok({ pulls: [ok().pulls[0]] }) })).answer, "All 4 mirrors are in sync with GitHub. 1 open pull request; last commit 3 h ago in lab/a.");
  assert.equal(strip(gitModel(input({ data: ok({ branches: [ok().branches[0]] }) })), "branches").state, "Everything is on its default branch");
  assert.equal(strip(gitModel(input({ data: ok({ branches: [] }) })), "branches").state, "No branches reported yet");
});

test("the last commit is the newest, whatever the order", () => {
  const s = ok();
  s.stream = [{ ...s.stream[0], repo: "lab/old", date: iso(-9 * D) }, { ...s.stream[0], repo: "lab/new", date: iso(-2 * H) }];
  const m = gitModel(input({ data: s }));
  assert.match(m.answer, /last commit 2 h ago in lab\/new\.$/);
  assert.equal(strip(m, "commits").state, "2 h ago · lab/new: Fix the thing");
});

test("no mirrors: neutral chip, calm otherwise, Mirrors says none set up", () => {
  const m = gitModel(input({ data: ok({ mirrors: [] }) }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "No mirrors" });
  assert.equal(m.answer, "No mirrors to GitHub are set up. 2 open pull requests; last commit 3 h ago in lab/a.");
  assert.equal(strip(m, "mirrors").state, "None set up");
  assert.equal(m.autoTarget, null);
  assert.equal(m.writes[0].enabled, true);
});

test("mirror error: bad chip, the repo and the first error line, Mirrors opens with the answer", () => {
  const s = ok();
  s.mirrors[1] = mirror("lab/b", { lastError: "remote rejected: no access\nmore detail" });
  const m = gitModel(input({ data: s }));
  assert.deepEqual(m.chip, { tone: "bad", label: "Mirror failing" });
  assert.equal(m.answer, "The lab/b mirror to GitHub failed: remote rejected: no access.");
  assert.equal(strip(m, "mirrors").state, "1 failing · 3 in sync");
  assert.equal(strip(m, "mirrors").tone, "bad");
  assert.equal(m.autoTarget, "mirrors");
  assert.equal(m.detailLead, null); // the mirror rows show the failure in full; no third copy
  assert.equal(m.writes[0].enabled, true);
});

test("two mirrors failing are listed; an address, a URL and the Forgejo host in the error are redacted", () => {
  const s = ok();
  s.mirrors[0] = mirror("lab/a", { lastError: "x" });
  s.mirrors[2] = mirror("lab/c", { lastError: "y" });
  assert.equal(gitModel(input({ data: s })).answer, "2 mirrors to GitHub are failing: lab/a, lab/c.");
  const t = ok();
  t.mirrors[0] = mirror("lab/a", { lastError: "dial tcp 10.9.8.7:3010: refused via https://example.org/x.git and forge.test:3010" });
  const a = gitModel(input({ data: t })).answer;
  assert.doesNotMatch(a, /10\.9\.8\.7|example\.org|forge\.test/);
  assert.equal(safeLine("see forge.test now", URL_), "see the server now");
});

test("diverged without an error: warn chip, ahead and behind, Mirrors opens", () => {
  const s = ok();
  s.mirrors[2] = mirror("lab/c", { defaultBranch: { state: "diverged", aheadBy: 2, behindBy: 1 } });
  const m = gitModel(input({ data: s }));
  assert.deepEqual(m.chip, { tone: "warn", label: "Diverged" });
  assert.equal(m.answer, "lab/c has diverged from GitHub: +2 ahead, -1 behind.");
  assert.equal(strip(m, "mirrors").state, "1 diverged · 3 in sync");
  assert.equal(strip(m, "mirrors").tone, "warn");
  assert.equal(m.autoTarget, "mirrors");
  assert.equal(m.detailLead, null);
  s.mirrors[2] = mirror("lab/c", { defaultBranch: { state: "diverged" } });
  assert.equal(gitModel(input({ data: s })).answer, "lab/c has diverged from GitHub.");
  s.mirrors[3] = mirror("lab/d", { defaultBranch: { state: "diverged", aheadBy: 1, behindBy: 0 } });
  assert.equal(gitModel(input({ data: s })).answer, "2 repos have diverged from GitHub: lab/c, lab/d.");
});

test("an error outranks divergence; an unknown mirror state counts as in sync", () => {
  const s = ok();
  s.mirrors[0] = mirror("lab/a", { lastError: "boom" });
  s.mirrors[1] = mirror("lab/b", { defaultBranch: { state: "diverged", aheadBy: 1, behindBy: 1 } });
  s.mirrors[2] = mirror("lab/c", { defaultBranch: { state: "unknown" } });
  const m = gitModel(input({ data: s }));
  assert.equal(m.chip.label, "Mirror failing");
  assert.equal(strip(m, "mirrors").state, "1 failing · 1 diverged · 2 in sync");
  assert.equal(strip(m, "mirrors").tone, "bad");
});

test("no repos: Empty, no strips, nothing opens", () => {
  const m = gitModel(input({ data: ok({ repos: [], stream: [], pulls: [], branches: [], mirrors: [] }) }));
  assert.deepEqual(m.chip, { tone: "neutral", label: "Empty" });
  assert.equal(m.answer, "Forgejo has no repos yet.");
  assert.deepEqual(m.strips, []);
  assert.equal(m.link?.label, "Open Forgejo");
});

test("stale (poll failing, or older than three polls): Stale chip, old answer, Sync off, never In sync (C22)", () => {
  for (const o of [{ loadError: true }, { lastOkAt: NOW - 200_000 }]) {
    const m = gitModel(input(o));
    assert.deepEqual(m.chip, { tone: "neutral", label: "Stale" });
    assert.match(m.answer, /^Showing what was true .+ ago: All 4 mirrors are in sync with GitHub\./);
    assert.equal(m.notice, PAUSED);
    assert.deepEqual(m.writes, [{ id: "sync", enabled: false, reason: PAUSED }]);
    assert.equal(m.autoTarget, "keep");
    assert.equal(m.stale, true);
    assert.equal(m.strips.length, 4);
    assert.notEqual(m.chip.label, "In sync");
  }
  assert.equal(gitModel(input({ lastOkAt: NOW - 170_000 })).stale, false);
});
