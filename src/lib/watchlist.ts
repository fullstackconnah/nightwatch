// Pure band maths for /resources (resources redesign, PR2). No imports: node:test cannot resolve the @/ alias.

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/** Scale steps: the band's chart y-axis and (PR3) the watchlist bars snap up to these. */
export const CPU_STEPS: readonly number[] = [1, 2, 5, 10, 25, 50, 100];
export const MEM_STEPS: readonly number[] = [256 * MiB, 512 * MiB, GiB, 2 * GiB, 4 * GiB, 8 * GiB, 16 * GiB];

/** Smallest step at or above `v`; a value over the top step clamps to the top step. */
export function snapScale(v: number, steps: readonly number[]): number {
  return steps.find((s) => v <= s) ?? steps[steps.length - 1];
}

export interface BandParts {
  base: number;
  /** containers, host & other, idle (or free). Always sums to `base`. */
  parts: [number, number, number];
}

const fin = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);

function split(base: number, used: number, containers: number): BandParts {
  const c = Math.min(containers, base);
  const o = Math.min(Math.max(0, used - containers), base - c); // clamps at 0 when containers exceed the host
  return { base, parts: [c, o, base - c - o] };
}

/** CPU: both numbers are percent of the whole box, so containers need no scaling. */
export function cpuBand(hostCpuPct: number, containerCpuPcts: number[]): BandParts {
  return split(100, fin(hostCpuPct), fin(containerCpuPcts.reduce((a, v) => a + fin(v), 0)));
}

export function memBand(memUsed: number, memTotal: number, containerBytes: number[]): BandParts {
  return split(fin(memTotal), fin(memUsed), fin(containerBytes.reduce((a, v) => a + fin(v), 0)));
}
