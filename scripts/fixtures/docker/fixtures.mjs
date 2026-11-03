/* Synthetic Docker state for scripts/docker-shots.mjs. Plain data builders; nothing here touches a real daemon. */

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
export const NOW_S = Math.floor(Date.parse("2026-11-04T10:00:00Z") / 1000);
const hex = (n) => n.toString(16).padStart(12, "0") + "0".repeat(52);

const ctr = (n, name, state, o = {}) => ({
  id: hex(n), name, image: o.image ?? "nginx:1.27", state, status: state === "running" ? "Up 3 days" : "Exited (0) 2 days ago",
  health: null, composeProject: o.stack ?? null, composeService: null, ports: [], labels: {}, created: NOW_S - 86400 * (o.age ?? 5),
  startedAt: null, finishedAt: null, exitCode: 0, restartCount: 0, tile: { url: null }, ...o.extra,
});

export function containersFor(kind = "full") {
  const running = Array.from({ length: 6 }, (_, i) => ctr(i + 1, `web-${i + 1}`, "running", { stack: i % 2 ? "media" : "apps" }));
  const stopped = Array.from({ length: kind === "ten" ? 10 : 8 }, (_, i) => ctr(100 + i, `old-${i + 1}`, "exited", { stack: i % 3 ? "apps" : null, age: 10 + i }));
  const runners = kind === "long" ? Array.from({ length: 321 }, (_, i) => ctr(1000 + i, `odiptest-run${i}`, "exited", { age: 3 })) : [];
  const all = kind === "empty" ? running : [...running, ...stopped, ...runners];
  const stoppedN = all.filter((c) => c.state !== "running").length;
  return {
    containers: all, groups: [],
    counts: { total: all.length, running: 6, paused: 0, stopped: stoppedN, restarting: 0, unhealthy: 0 },
  };
}

export function imagesFor(kind = "full") {
  const img = (n, tags, size, inUse, stack = null) => ({
    id: `sha256:${hex(n)}`, tags, size, created: NOW_S - 86400 * n, inUse, usedBy: inUse ? ["web-1"] : [], stack,
  });
  if (kind === "empty") return { images: [img(1, ["nginx:1.27"], 190 * MiB, true, "apps")] };
  return {
    images: [
      img(1, ["nginx:1.27"], 190 * MiB, true, "apps"),
      img(2, ["postgres:16"], 430 * MiB, true, "media"),
      img(3, ["redis:7"], 110 * MiB, true, "apps"),
      img(4, ["grafana:11"], 520 * MiB, false, "media"),
      img(5, ["node:20"], 1.1 * GiB, false),
      img(6, ["alpine:3.19"], 8 * MiB, false),
      img(7, ["busybox:1"], 4 * MiB, false),
      img(8, [], 6.2 * GiB, false), img(9, [], 3.1 * GiB, false), img(10, [], 400 * MiB, false),
    ],
  };
}

export function volumesFor(kind = "full") {
  const v = (name, usedBy) => ({ name, driver: "local", mountpoint: `/var/lib/docker/volumes/${name}/_data`, created: "2026-10-01T00:00:00Z", usedBy });
  if (kind === "empty") return { volumes: [] };
  return { volumes: [v("pgdata", ["web-2"]), v("grafana-data", ["web-4"]), v("redis-data", ["web-3"]), v("stale-cache", []), v("old-uploads", [])] };
}

/** `partial`: orphan sizes still pending. `empty`: nothing to clear. */
export function diskFor(kind = "full") {
  const dangling = kind === "empty" ? [] : imagesFor().images.filter((i) => !i.tags.length).map(({ id, tags, size, created }) => ({ id, tags, size, created }));
  const danglingBytes = dangling.reduce((a, i) => a + i.size, 0);
  const pending = kind === "partial";
  const orphans = kind === "empty" ? [] : [
    { name: "stale-cache", size: pending ? null : 22 * GiB, created: "2026-09-01T00:00:00Z" },
    { name: "old-uploads", size: pending ? null : 4 * GiB, created: "2026-08-01T00:00:00Z" },
  ];
  const orphanBytes = pending ? 0 : orphans.reduce((a, o) => a + (o.size ?? 0), 0);
  return {
    images: { dangling, danglingBytes, unusedBytes: danglingBytes + 1.6 * GiB },
    volumes: { orphans, orphanBytes },
    buildCacheBytes: kind === "empty" ? 0 : 18 * GiB,
    totals: { reclaimableBytes: danglingBytes + orphanBytes },
  };
}
