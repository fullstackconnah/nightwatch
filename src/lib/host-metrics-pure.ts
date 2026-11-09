// Pure host-metrics helpers with no module-alias imports, so node:test can load them.

/**
 * Picks the interfaces that represent real host throughput. Bridges, veth pairs and
 * loopback carry bytes that are already counted on the uplink, and a bond aggregates
 * its slaves — summing everything would multiply the same packets several times.
 */
export function selectHostNetInterfaces(names: string[]): string[] {
  const virtualPrefixes = ["docker", "br-", "veth", "virbr", "tap", "tun", "dummy", "wg"];
  const physical = names.filter(
    (name) => name !== "lo" && !virtualPrefixes.some((p) => name.startsWith(p)),
  );
  // A bond aggregates its slave NICs (e.g. enp4s0) — if present, only the
  // bond itself should be summed, or the slave's bytes would be counted twice.
  const bonds = physical.filter((name) => name.startsWith("bond"));
  return bonds.length > 0 ? bonds : physical;
}

interface NetDevSample {
  iface: string;
  rxBytes: number;
  txBytes: number;
}

/** Every interface's raw rx/tx byte counters from a /proc/net/dev table, unfiltered. */
export function parseNetDevSamples(content: string): NetDevSample[] {
  const lines = content.split("\n").slice(2); // first two lines are headers
  const out: NetDevSample[] = [];
  for (const line of lines) {
    const [ifacePart, rest] = line.split(":");
    if (!rest) continue;
    const iface = ifacePart.trim();
    const cols = rest.trim().split(/\s+/);
    // Receive bytes is col 0; transmit bytes is col 8 (first transmit column, after receive's 8).
    out.push({ iface, rxBytes: Number(cols[0]), txBytes: Number(cols[8]) });
  }
  return out;
}

/**
 * Summed rx/tx over the real host interfaces (selectHostNetInterfaces). Null when no
 * interface remains or a counter is non-finite — zeros would read as "measured no traffic".
 */
export function sumHostNetCounters(content: string): { rxBytes: number; txBytes: number } | null {
  const samples = parseNetDevSamples(content);
  const selected = new Set(selectHostNetInterfaces(samples.map((s) => s.iface)));
  let rxBytes = 0;
  let txBytes = 0;
  let interfaceCount = 0;
  for (const s of samples) {
    if (!selected.has(s.iface)) continue;
    rxBytes += s.rxBytes;
    txBytes += s.txBytes;
    interfaceCount++;
  }
  if (interfaceCount === 0) return null;
  if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) return null;
  return { rxBytes, txBytes };
}

/** df's maths: root-reserved blocks are neither used nor available to the percentage. */
export function statfsUsage(s: { blocks: number; bfree: number; bavail: number; bsize: number }) {
  const total = s.blocks * s.bsize;
  const used = (s.blocks - s.bfree) * s.bsize;
  const avail = s.bavail * s.bsize;
  return { total, used, avail, percent: groupPercent(used, avail) };
}

/** df percent: used over used plus available; also applied to summed per-disk groups. */
export function groupPercent(used: number, avail: number): number {
  return used + avail > 0 ? (used / (used + avail)) * 100 : 0;
}

/** Hottest sane zone in °C; one throwing zone or a bogus (>150 °C) sensor does not spoil the rest. */
export function maxThermalC(reads: (() => number)[]): number | null {
  const temps: number[] = [];
  for (const read of reads) {
    try {
      const raw = read();
      if (Number.isFinite(raw) && raw > 1000 && raw <= 150000) temps.push(raw / 1000);
    } catch {
      // unreadable zone: skip it
    }
  }
  return temps.length ? Math.max(...temps) : null;
}

/** nvme/mmc partitions end in p<digits>; sd/vd/xvd/hd partitions are letters then digits. */
export function isPartitionName(name: string): boolean {
  return /^(nvme\d+n\d+|mmcblk\d+|nbd\d+)p\d+$/.test(name) || /^mmcblk\d+(boot\d+|rpmb)$/.test(name) || /^(sd|vd|xvd|hd)[a-z]+\d+$/.test(name);
}
