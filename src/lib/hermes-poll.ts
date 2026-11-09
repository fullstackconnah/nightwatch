/**
 * Whether askHermes keeps polling after a failed job fetch. Only a transient
 * "unreachable" retries, and only inside the deadline; a 404 (daemon restarted,
 * job gone) or any other failure ends the ask.
 */
export function shouldKeepPolling(status: string, now: number, deadline: number): boolean {
  return status === "unreachable" && now < deadline;
}
