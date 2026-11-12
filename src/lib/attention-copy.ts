/**
 * Plain-English copy for the kiosk's "One Thing Needs You" alerts: what is
 * wrong, how bad it is, and the one next step. Import-free so node:test can
 * load it (attention.ts cannot be loaded there). Nothing that changes per
 * poll goes in a headline: the kiosk keys an alert on severity + headline +
 * since, so a ticking number would re-raise the same alert every poll.
 * Headlines are at most 48 chars (fixed text <= 24 plus ids clipped to 24),
 * details at most 100, actions at most 70.
 */
export type AlertCopy = { headline: string; detail?: string; action?: string };

const ID_MAX = 24;
/** Clips an identifier so a headline built around it stays inside the 48-char budget. */
export const id = (s: string): string => (s.length <= ID_MAX ? s : `${s.slice(0, ID_MAX - 1)}…`);

/** A mount as it reads in a sentence: "/" is the system disk. */
export const place = (mount: string): string => (mount === "/" ? "the system disk" : id(mount));

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const RESTART = "Restart it on the Containers page.";
const LOGS = "Look for its error on the Logs page.";
const RESOURCES = "Check it on the Resources page.";

// --- containers ---------------------------------------------------------------

export function containerDown(name: string, up: string | null): AlertCopy {
  return {
    headline: `${id(name)} is down`,
    detail: `It stopped${up ? ` after ${up}` : ""} and is stuck, so anything using it is unavailable.`,
    action: RESTART,
  };
}

export function containerCrashed(name: string, code: number): AlertCopy {
  return {
    headline: `${id(name)} crashed`,
    detail:
      code === 137
        ? "It was force-stopped (code 137), often from running out of memory. It's down until restarted."
        : `It stopped with an error (code ${code}) and is down until restarted.`,
    action: "Restart it on the Containers page; if it crashes again, check Logs.",
  };
}

export function stuckRestarting(name: string, restarts: number): AlertCopy {
  return {
    headline: `${id(name)} is stuck restarting`,
    detail: `It keeps crashing and starting again (${restarts} restarts so far), so it isn't usable.`,
    action: LOGS,
  };
}

export function keepsRestarting(name: string, delta: number, total: number): AlertCopy {
  return {
    headline: `${id(name)} keeps restarting`,
    detail: `It crashed and started again ${plural(delta, "time", "times")} since the last check (${total} in all).`,
    action: LOGS,
  };
}

export function containerUnhealthy(name: string): AlertCopy {
  return {
    headline: `${id(name)} isn't working right`,
    detail: "It's running but failing its own health check, so it may be slow or stuck.",
    action: "If it doesn't recover, restart it on the Containers page.",
  };
}

// --- drives (smart.ts reason strings) -------------------------------------------

const REPLACE_NOW = "Copy anything important off it now, then replace it.";
const REPLACE_SOON = "Plan to replace it, and keep its data backed up.";

// Plain words for the SMART attributes smart.ts can flag as critical (ids 5, 187, 188, 197, 198), keyed by lowercased name with spaces.
const SMART_WORDS: Record<string, string> = {
  "reallocated sector ct": "worn-out sectors it has replaced",
  "reported uncorrect": "read errors it could not fix",
  "command timeout": "commands that timed out",
  "current pending sector": "sectors waiting to be checked",
  "offline uncorrectable": "sectors it could not read",
  "udma crc error count": "cable or connection errors",
  "raw read error rate": "read errors",
};
const smartWords = (raw: string) => SMART_WORDS[raw.toLowerCase().replace(/_/g, " ")];

type DriveRule = { re: RegExp; bad: boolean; build: (n: string, m: RegExpMatchArray) => AlertCopy };
const drv = (headline: string, detail: string, action: string): AlertCopy => ({ headline, detail, action });

// Bad-class rules first in the order the producer pushes them; the selection rule
// in driveAlert() prefers any bad-class match over a warn-class one.
const DRIVE_RULES: DriveRule[] = [
  { re: /^SMART overall self-assessment failed$/, bad: true, build: (n) => drv(`Drive ${n} is failing`, "Its own health check says it's failing. Data on it is at risk.", REPLACE_NOW) },
  { re: /^NVMe critical warning bitfield (0x\w+)/, bad: true, build: (n, m) => drv(`Drive ${n} has a fault`, `It raised a critical warning (${m[1]}). Data on it is at risk.`, REPLACE_NOW) },
  { re: /^(\d+) media errors?$/, bad: true, build: (n, m) => drv(`Drive ${n} is failing`, `It couldn't read or write some data (${m[1]} errors). More usually follow.`, REPLACE_NOW) },
  { re: /^available spare (\d+)% below threshold/, bad: true, build: (n, m) => drv(`Drive ${n} is worn out`, `Its spare capacity is used up (${m[1]}% left). It may fail soon.`, REPLACE_NOW) },
  { re: /^(.+) failing now \(pre-fail/, bad: true, build: (n, m) => drv(`Drive ${n} is failing`, `A key health reading${smartWords(m[1]) ? ` (${smartWords(m[1])})` : ""} has crossed its failure line.`, REPLACE_NOW) },
  { re: /^.+ at (\d+) °C, at\/above critical$/, bad: true, build: (n, m) => drv(`Drive ${n} is overheating`, `It's at ${m[1]} °C, at or above its safe limit.`, "Check the server's fans and airflow now.") },
  { re: /^available spare (\d+)% approaching threshold/, bad: false, build: (n, m) => drv(`Drive ${n} is wearing out`, `Its spare capacity is running low (${m[1]}% left).`, REPLACE_SOON) },
  { re: /^(.+) failed its threshold previously$/, bad: false, build: (n, m) => drv(`Drive ${n} had a past fault`, `A health reading${smartWords(m[1]) ? ` (${smartWords(m[1])})` : ""} failed once before.`, "Keep its data backed up and watch it.") },
  { re: /^(\d+) ([a-z0-9 ]+)$/, bad: false, build: (n, m) => drv(`Drive ${n} is showing errors`, `It has logged ${m[1]} ${smartWords(m[2]) ?? "errors"}, an early sign of wear.`, REPLACE_SOON) },
  { re: /^.+ (\d+) °C, \d+ °C from critical$/, bad: false, build: (n, m) => drv(`Drive ${n} is running hot`, `It's at ${m[1]} °C, close to its safe limit.`, "Check the server's fans and airflow.") },
  { re: /^wear at (\d+)%$/, bad: false, build: (n, m) => drv(`Drive ${n} is wearing out`, `It has used ${m[1]}% of its rated life.`, REPLACE_SOON) },
];

/** A drive whose verdict is bad. Reasons arrive interleaved with warn-class lines, so a bad-class match wins; no match falls back to a safe generic line. */
export function driveAlert(name: string, reasons: string[]): AlertCopy {
  const n = id(name);
  for (const wantBad of [true, false]) {
    for (const r of reasons) {
      for (const rule of DRIVE_RULES) {
        const m = rule.bad === wantBad ? r.match(rule.re) : null;
        if (m) return rule.build(n, m);
      }
    }
  }
  return drv(`Drive ${n} needs checking`, "Its health check flagged a problem.", RESOURCES);
}

export function driveUnreadable(name: string): AlertCopy {
  return {
    headline: `Drive ${id(name)} stopped reporting`,
    detail: "Its health readings stopped coming through. It may have disconnected.",
    action: "Check the drive on the Resources page.",
  };
}

// --- array and integrity (smart.ts integrity reasons) ---------------------------------

const POOL_STATE: Record<string, string> = { DEGRADED: "A disk has dropped out", FAULTED: "It has stopped working", UNAVAIL: "It has stopped working" };

export function integrityAlert(reasons: string[]): AlertCopy {
  const r = reasons[0] ?? "";
  let m = r.match(/^(.+): (\d+) filesystem errors?$/);
  if (m) {
    return {
      headline: `${id(m[1])} has file system errors`,
      detail: `${plural(Number(m[2]), "error", "errors")} found in how files are stored. Some files may be damaged.`,
      action: "Back up what's there, then run a disk check.",
    };
  }
  m = r.match(/^RAID array (\S+) degraded \((.+)\/(.+)\)$/);
  if (m) {
    const known = m[2] !== "?" && m[3] !== "?";
    return {
      headline: `Array ${id(m[1])} lost a drive`,
      detail: `${known ? `Only ${m[2]} of its ${m[3]} drives are working.` : "It's running without one of its drives."} One more failure loses data.`,
      action: "Replace the failed drive soon.",
    };
  }
  m = r.match(/^pool (\S+) (\S+)$/);
  if (m) {
    return {
      headline: `Storage pool ${id(m[1])} at risk`,
      detail: `${POOL_STATE[m[2]] ?? "It reports a fault"} and is running without full protection.`,
      action: "Check its drives on the Resources page.",
    };
  }
  return { headline: "The storage array has a problem", detail: "It reported a fault.", action: RESOURCES };
}

// --- disk capacity ----------------------------------------------------------------------

/** `days` is null when there is no honest projection. The percent stays in the headline so a disk that keeps filling re-raises; the day estimate lives in the detail. */
export function diskFull(mount: string, pct: number, days: number | null): AlertCopy {
  return {
    headline: `${cap(place(mount))} is ${pct}% full`,
    detail: days != null ? `At the current rate it fills up in about ${plural(days, "day", "days")}.` : `Only ${100 - pct}% of its space is left.`,
    action: "Delete or move files you no longer need.",
  };
}

// --- ODIP backup ------------------------------------------------------------------------------

/** Detail and action for the worst backup item; `rel` is the already-formatted age of its last good run, or null. */
export function backupDetail(worst: "FAILED" | "STALE", rel: string | null): Pick<AlertCopy, "detail" | "action"> {
  if (worst === "FAILED") {
    return {
      detail: `Recent ODIP changes could be lost. ${rel ? `Last good run: ${rel}.` : "There's no record of a good run."}`,
      action: "Check the backup job on the server and run it again.",
    };
  }
  return {
    detail: `It hasn't succeeded on schedule${rel ? `. Last good run: ${rel}.` : ", and there's no record of a good run."}`,
    action: "Check the backup job on the server is still scheduled.",
  };
}

export function backupCheckStopped(rel: string): AlertCopy {
  return {
    headline: "The ODIP backup check has stopped",
    detail: `It last ran ${rel}, so the backup status shown may be out of date.`,
    action: "Make sure the backup check is still scheduled.",
  };
}

// --- front door camera ------------------------------------------------------------------------

/** `days` is null when no motion was ever reported. The count stays in the detail: a ticking number in the headline would re-raise the alert. */
export function doorbellQuietCopy(days: number | null): AlertCopy {
  return {
    headline: "Front door camera has gone quiet",
    detail: days == null ? "It has not reported any motion" : `No motion reported for ${plural(days, "day", "days")}`,
    action: "Reload its integration in Home Assistant; it may need signing in.",
  };
}
