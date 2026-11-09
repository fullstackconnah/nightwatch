import type { HostVitals } from "./host-metrics.ts";

/** Exactly what the kiosk vitals UI reads. The route is public, so no host mount path, hostname, OS or CPU model. */
export interface KioskVitalsData {
  cpu: { percent: number };
  memory: { total: number; used: number; percent: number };
  disk: { total: number; used: number; percent: number }[];
  network: { rxPerSec: number; txPerSec: number };
  ts: number;
}

export function kioskVitals(v: HostVitals): KioskVitalsData {
  return {
    cpu: { percent: v.cpu.percent },
    memory: { total: v.memory.total, used: v.memory.used, percent: v.memory.percent },
    disk: v.disk.map((d) => ({ total: d.total, used: d.used, percent: d.percent })),
    network: { rxPerSec: v.network.rxPerSec, txPerSec: v.network.txPerSec },
    ts: v.ts,
  };
}
