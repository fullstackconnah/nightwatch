/* Attention-report fixtures for scripts/home-shots.mjs. Built relative to `now`, so every age and every
 * hh:mm is the same whatever day the run happens. `satisfies AttentionReport` makes tsc check each one
 * against the real type; the shots script imports this file under node --experimental-strip-types.
 * Names are placeholders: no real host, address or token appears here. */
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

export function build(now: number) {
  const e = baseEvents(now);
  return {
    quiet: report(now, [], e),
    one: report(now, [disk(now, 90)], e),
    // radarr is crashed and dev is stuck: neither may appear in the feed (R3).
    several: report(now, [crash(now, "radarr", 130), lane(now, 40), disk(now, 300)], e),
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
