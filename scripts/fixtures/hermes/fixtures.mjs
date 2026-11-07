/* Fixtures for scripts/hermes-shots.mjs: the /api/hermes-ctl/status and /activity answers and the job a run returns, one
 * per capture state of the strips pattern 4 spec. Placeholders only (the repo is public): hosts are example names, no
 * address appears anywhere. The browser clock is pinned to NOW, so every age and "in 3 h" is exact. */

export const NOW = Date.parse("2026-11-06T10:00:00Z");
const at = (ms) => new Date(NOW + ms).toISOString();
const H = 3_600_000;

export const status = (over = {}) => ({
  status: "ok",
  ok: true,
  startedAt: at(-3 * 24 * H),
  tier: { tier: "local", model: "qwen-test", source: "env" },
  dryRun: false,
  loops: {
    collect: { lastRunAt: at(-5 * 60_000), lastOk: true, lastError: null },
    digest: { lastRunAt: at(-2 * H), lastOk: true, lastError: null, nextRunAt: at(3 * H) },
    alert: { lastTriggeredAt: at(-H) },
  },
  discord: { webhookConfigured: true, commandsEnabled: true },
  counts: { snapshots24h: 120, alerts24h: 2 },
  ...over,
});

const LONG = "The overnight digest covered 14 containers and 3 volumes. Two alerts fired for the media drive; both cleared by 04:10. Nothing needs attention this morning.";
export const ACTIVITY = {
  status: "ok",
  items: [
    { at: at(-2 * H), kind: "digest", title: "Morning digest", body: LONG },
    { at: at(-H), kind: "alert", title: "Media drive slow", body: "Read latency above threshold." },
    { at: at(-30 * 60_000), kind: "recovery", title: "Media drive recovered", body: "Latency back under threshold." },
    { at: at(-10 * 60_000), kind: "ask", title: "Question", body: "Is the backup recent?" },
  ],
};

const job = (over) => ({ ok: true, job: { state: "running", kind: "digest", startedAt: at(-42_000), finishedAt: null, result: null, error: null, ...over } });
export const JOBS = {
  running: job({}),
  done: job({ state: "done", finishedAt: at(-1000), result: { title: "Digest", body: "Everything is steady. No action needed." } }),
  failed: job({ state: "error", finishedAt: at(-1000), error: "alert test failed: POST https://hooks.example/x?token=abc123secret\npassword=hunter2\nThe model did not answer in time." }),
};

// status/activity: the body, "hang" (never answers) or "fail" (HTTP 500). job: the GET /jobs/job-1 body (the run is
// started from the page for the states that need one).
export const FIXTURES = {
  loading: { status: "hang", activity: ACTIVITY },
  loadError: { status: "fail", activity: ACTIVITY },
  unconfigured: { status: { status: "unconfigured", detail: "not set" }, activity: ACTIVITY },
  unauthorized: { status: { status: "unauthorized", detail: "token rejected by upstream.example" }, activity: ACTIVITY },
  unreachable: { status: { status: "unreachable", detail: "connect ECONNREFUSED upstream.example:1234" }, activity: ACTIVITY },
  calm: { status: status(), activity: ACTIVITY },
  dryRun: { status: status({ dryRun: true }), activity: ACTIVITY },
  loopFailed: {
    status: (() => {
      const s = status();
      s.loops.digest = { ...s.loops.digest, lastOk: false, lastError: "The model did not answer in time.\ntraceback line" };
      return s;
    })(),
    activity: ACTIVITY,
  },
  unhealthy: { status: status({ ok: false }), activity: ACTIVITY },
  jobRunning: { status: status(), activity: ACTIVITY, job: JOBS.running },
  runDone: { status: status(), activity: ACTIVITY, job: JOBS.done },
  runFailed: { status: status(), activity: ACTIVITY, job: JOBS.failed },
  askDone: { status: status(), activity: ACTIVITY, job: { ok: true, job: { ...JOBS.done.job, kind: "ask", result: { title: "Answer", body: "The last backup finished two hours ago." } } } },
  noActivity: { status: status(), activity: { status: "ok", items: [] } },
};
