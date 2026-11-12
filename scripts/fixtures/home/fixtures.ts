/* Attention-report fixtures for scripts/home-shots.mjs. Built relative to `now`, so every age and every
 * hh:mm is the same whatever day the run happens. `satisfies AttentionReport` makes tsc check each one
 * against the real type; the shots script imports this file under node --experimental-strip-types.
 * Names are placeholders: no real host, address or token appears here. */
import type { BackupStatus } from "../../../src/lib/backup-status.ts";
import type { TiledContainer } from "../../../src/lib/tiles.ts";
import type {
  AttentionHit,
  AttentionReport,
  ChangeEvent,
  ProbeId,
  ProbeStatus,
} from "../../../src/lib/attention-report.ts";

const MIN = 60_000;
const iso = (now: number, minAgo: number) => new Date(now - minAgo * MIN).toISOString();

const PROBES: ReadonlyArray<readonly [ProbeId, string]> = [
  ["crashes", "Crashes"],
  ["restarts", "Restarts"],
  ["smart", "SMART"],
  ["mounts", "Mounts"],
  ["backup", "Backup"],
  ["disks", "Disks"],
  ["health", "Health"],
  ["doorbell", "Front door"],
  ["orchestra", "AI lanes"],
];

type Override = { state: "pending" } | { state: "failed"; error: string };

function probes(hits: AttentionHit[], over: Partial<Record<ProbeId, Override>> = {}): ProbeStatus[] {
  return PROBES.map(([id, label]): ProbeStatus => {
    const o = over[id];
    if (o?.state === "pending") return { id, label, state: "pending" };
    if (o?.state === "failed") return { id, label, state: "failed", error: o.error };
    return { id, label, state: "answered", hits: hits.filter((h) => h.probe === id).length };
  });
}

function hit(
  now: number,
  probe: ProbeId,
  subject: string,
  severity: "warn" | "bad",
  headline: string,
  minAgo: number,
  extra: Partial<AttentionHit> = {},
): AttentionHit {
  return {
    id: `${probe}:${subject}`,
    probe,
    subject,
    severity,
    headline,
    since: iso(now, minAgo),
    firstSeen: iso(now, minAgo),
    owner: { href: "/containers", label: "Open Containers" },
    ...extra,
  };
}

function ev(
  now: number,
  id: string,
  kind: "handled" | "routine",
  minAgo: number,
  subjects: string[],
  text: string,
): ChangeEvent {
  return { id, kind, at: iso(now, minAgo), subjects, text, owner: { href: "/logs", label: "Open Logs" } };
}

function report(
  now: number,
  hits: AttentionHit[],
  events: ChangeEvent[],
  over: Partial<Record<ProbeId, Override>> = {},
  changes: Partial<AttentionReport["changes"]> = {},
): AttentionReport {
  return {
    checkedAt: iso(now, 0),
    probes: probes(hits, over),
    hits,
    changes: { since: iso(now, 8 * 60), status: "answered", events, ...changes },
  };
}

// Four routine events, so the S = 4 box is full and "Show N more" has something to count.
const baseEvents = (now: number) => [
  ev(now, "ev:backup", "handled", 95, ["backup"], "Nightly backup finished: 41 GB in 12 min"),
  ev(now, "ev:sonarr", "handled", 200, ["container:sonarr"], "sonarr restarted after an update and is healthy"),
  ev(now, "ev:grafana", "routine", 260, ["container:grafana"], "grafana was recreated from a new image"),
  ev(now, "ev:loki", "routine", 300, ["container:loki"], "loki restarted once, no errors since"),
  ev(now, "ev:prom", "routine", 360, ["container:prometheus"], "prometheus recreated from a new image"),
  ev(now, "ev:lidarr", "routine", 420, ["container:lidarr"], "lidarr restarted once"),
];

const crash = (now: number, name: string, minAgo: number) =>
  hit(now, "crashes", `container:${name}`, "bad", `${name} crashed (exit 137)`, minAgo, {
    detail: "Out of memory, killed by the kernel.",
    action: "Open its logs, then restart it from Resources.",
  });
const disk = (now: number, minAgo: number) =>
  hit(now, "disks", "disk:/mnt/media", "warn", "/mnt/media is 91% full", minAgo, {
    detail: "9% free, about 3 weeks at the current rate.",
    owner: { href: "/resources", label: "Open Resources" },
  });
const lane = (now: number, minAgo: number) =>
  hit(now, "orchestra", "orchestra", "warn", "dev lane has been stuck for 40 min", minAgo, {
    owner: { href: "/orchestrators", label: "Open AI lanes" },
  });

// SL: a lane Orchestra reports stalled but sent no agent rows for (copy from orchestraAttention in src/lib/orchestra-view.ts).
const stalledLane = (now: number, minAgo: number) =>
  hit(now, "orchestra", "orchestra", "warn", "dev has gone quiet", minAgo, {
    detail: "The service reports this lane as stalled but sent no agent details. It may be stuck.",
    action: "Check it on the AI lanes page.",
    owner: { href: "/orchestrators", label: "Open AI lanes" },
  });

// DQ: copy from doorbellQuietCopy in src/lib/attention-copy.ts (68 days, the live case).
const doorbellQuiet = (now: number, minAgo: number) =>
  hit(now, "doorbell", "doorbell", "warn", "Front door camera has gone quiet", minAgo, {
    detail: "No motion reported for 68 days",
    action: "Reload its integration in Home Assistant; it may need signing in.",
    owner: { href: "/smarthome", label: "Open Smart home" },
  });

export function build(now: number) {
  const e = baseEvents(now);
  return {
    quiet: report(now, [], e),
    one: report(now, [disk(now, 90)], e),
    // radarr is crashed and dev is stuck: neither may appear in the feed (R3).
    several: report(now, [crash(now, "radarr", 130), lane(now, 40), disk(now, 300)], e),
    doorbellQuiet: report(now, [disk(now, 90), doorbellQuiet(now, 120)], e),
    stalledLane: report(now, [stalledLane(now, 25)], e),
    partial: report(now, [], e, { smart: { state: "pending" }, mounts: { state: "pending" } }),
    dockerFailed: report(
      now,
      [],
      e.filter((x) => x.subjects.includes("backup")),
      {
        crashes: { state: "failed", error: "Cannot connect to the Docker daemon" },
        restarts: { state: "failed", error: "Cannot connect to the Docker daemon" },
        health: { state: "failed", error: "Cannot connect to the Docker daemon" },
      },
    ),
    otherFailed: report(now, [], e, { smart: { state: "failed", error: "smartctl exited with status 2" } }),
    // C1: the start (1 hit) and the arrival (a crash and a disk; the orchestra hit clears).
    c1Before: report(now, [lane(now, 40)], e),
    c1After: report(now, [crash(now, "radarr", 1), disk(now, 2)], e),
    // C2: three new events, newest first, then one more while the pointer is inside the box.
    c2Before: report(now, [], e),
    c2Events: report(now, [], [
      ev(now, "ev:n1", "handled", 1, ["container:jellyfin"], "jellyfin restarted and is healthy"),
      ev(now, "ev:n2", "routine", 2, ["container:immich"], "immich recreated from a new image"),
      ev(now, "ev:n3", "routine", 3, ["container:nginx"], "nginx restarted once"),
      ...e,
    ]),
    c2More: report(now, [], [
      ev(now, "ev:n4", "handled", 0, ["container:plex"], "plex restarted and is healthy"),
      ev(now, "ev:n1", "handled", 1, ["container:jellyfin"], "jellyfin restarted and is healthy"),
      ev(now, "ev:n2", "routine", 2, ["container:immich"], "immich recreated from a new image"),
      ev(now, "ev:n3", "routine", 3, ["container:nginx"], "nginx restarted once"),
      ...e,
    ]),
    // C10: two warn rows shown; then a bad crash arrives, and the pill is tapped.
    c10Before: report(now, [disk(now, 90), lane(now, 40)], e),
    c10After: report(now, [crash(now, "radarr", 1), disk(now, 90), lane(now, 40)], e),
  } satisfies Record<string, AttentionReport>;
}

export type FixtureName = keyof ReturnType<typeof build>;

/* The launcher's apps, so the quiet state does not depend on what the test stack happens to run (an unhealthy or
 * paused container there paints warn). Three running apps in two groups, one with a widget and its actions, one
 * stopped cleanly (so C12 still sees a stopped row). Placeholder names and addresses. */
const app = (
  name: string,
  group: string,
  over: Partial<TiledContainer> = {},
): TiledContainer => ({
  id: `${name}0000000000000000`,
  name,
  image: `example/${name}`,
  state: "running",
  status: "Up 2 days",
  health: null,
  composeProject: group.toLowerCase(),
  composeService: name,
  ports: [],
  labels: {},
  created: 0,
  startedAt: Date.now() - 2 * 24 * 3_600_000,
  finishedAt: null,
  exitCode: null,
  restartCount: 0,
  tile: { url: "http://app.invalid:8080", icon: null, group, hidden: false, hasWidget: false },
  ...over,
});

export const CONTAINERS = {
  containers: [
    app("sonarr", "Media", { tile: { url: "http://app.invalid:8989", icon: null, group: "Media", hidden: false, hasWidget: true } }),
    app("jellyfin", "Media"),
    app("proxy", "Infra"),
    app("nightwatch", "Infra"),
    app("scratch", "Infra", { state: "exited", status: "Exited (0) 3 hours ago", startedAt: null, finishedAt: Date.now() - 3 * 3_600_000, exitCode: 0 }),
  ],
  groups: ["Media", "Infra"],
  counts: { total: 5, running: 4, paused: 0, stopped: 1, restarting: 0, unhealthy: 0 },
};

export const WIDGETS = {
  widgets: {
    sonarr: { type: "sonarr", configured: true, fetchedAt: Date.now(), fields: [{ label: "Queue", value: "2" }, { label: "Wanted", value: "14" }] },
  },
};

/** /api/backup with both checks fresh, so the quiet Home has no stale or unreadable backup dot. */
export const backupOk = (now: number): BackupStatus => ({
  status: "ok",
  checkedAt: new Date(now - 60 * MIN).toISOString(),
  items: [
    { kind: "backup", state: "OK", at: new Date(now - 6 * 60 * MIN).toISOString() },
    { kind: "restore-test", state: "OK", at: new Date(now - 18 * 60 * MIN).toISOString() },
  ],
});
