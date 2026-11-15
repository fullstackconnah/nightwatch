import { loadConfig } from "@/lib/config";

/** A list request never fails because of the config: no usable zone means Sydney. */
export function displayTimeZone(): string {
  try {
    return loadConfig().display?.timezone || "Australia/Sydney";
  } catch {
    return "Australia/Sydney";
  }
}
