const p2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:MM" (24-hour) in the browser's own zone. Client-only: the server runs in UTC. */
export function localStamp(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** YYYY-MM-DD in `timezone` (en-CA formats it directly). An unset zone is the owner's, not the UTC server's. */
export function localDateString(timezone: string | undefined, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
