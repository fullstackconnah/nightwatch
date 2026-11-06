/** Memory GB field rule: blank means the server default; otherwise it must be a positive number. */
export function memoryGbError(value: string): string | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? null : "Enter a number above 0, or leave blank for the default.";
}
