// Import-free leaf (node:test loads it without the "@/" alias). Every CPU % in
// nightwatch is a share of the WHOLE box (0-100), the same scale as the host gauge.

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

/** Docker stats: system_cpu_usage already spans all cores, so no core multiplier. */
export function containerCpuShare(cpuDelta: number, sysDelta: number): number {
  return sysDelta > 0 ? clamp((cpuDelta / sysDelta) * 100) : 0;
}

/** Host process: CPU ticks spent over spanMs, as a share of `cores` cores. */
export function processCpuShare(deltaTicks: number, clkTck: number, spanMs: number, cores: number): number {
  return spanMs > 0 && cores > 0 ? clamp(((deltaTicks * (1000 / clkTck)) / spanMs / cores) * 100) : 0;
}
