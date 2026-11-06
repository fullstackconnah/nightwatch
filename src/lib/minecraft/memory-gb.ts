/** Memory GB field rule: blank means the server default; otherwise a positive number up to the cap. */
// shortcut: 32 GB is a sanity cap above any homelab box, raise it if the host grows
export const MAX_MEMORY_GB = 32;

/** True when `n` is a usable heap size: above 0 and at most the cap. Shared by the field and the API routes. */
export const memoryGbInRange = (n: number) => Number.isFinite(n) && n > 0 && n <= MAX_MEMORY_GB;

export function memoryGbError(value: string): string | null {
  if (!value.trim()) return null;
  return memoryGbInRange(Number(value)) ? null : "Enter a number above 0 and up to 32, or leave blank for the default.";
}
