/**
 * Tiny dot-path resolver for the generic widget: "a.b[0].c" / "a.0.c".
 * Not full JSONPath on purpose — predictable, no dependency.
 */
export function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
