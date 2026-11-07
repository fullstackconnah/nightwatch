/** Units the nightly sweep should switch off: on, and reachable (an unplugged AC would fail every night). */
export function climatesToTurnOff<T extends { available: boolean; hvacMode: string }>(climates: T[]): T[] {
  return climates.filter((c) => c.available && c.hvacMode !== "off");
}

/** True once the sweep gave up for this date; a new day's window works again. */
export function gaveUpForWindow(gaveUpDateKey: string | null, dateKey: string): boolean {
  return gaveUpDateKey === dateKey;
}
