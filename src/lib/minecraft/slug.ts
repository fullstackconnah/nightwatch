/**
 * The manager's slug rule is `^[a-z0-9][a-z0-9-_]{0,63}$`. Pack slugs from
 * CurseForge/Modrinth are already close (both are lowercase-with-hyphens by
 * convention) but not guaranteed — this sanitizes rather than rejects, so a
 * pack with an unusual slug (or a user-supplied override) still installs
 * instead of bouncing with a validation error the operator can't act on.
 */
export function sanitizeSlug(input: string): string {
  const lowered = input.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
  if (/^[a-z0-9]/.test(lowered)) return lowered;
  // Leading char must be [a-z0-9] per the manager's rule — prefix rather than
  // strip, so a slug that was otherwise fine doesn't lose a character.
  return `m${lowered}`.slice(0, 64) || "pack";
}
