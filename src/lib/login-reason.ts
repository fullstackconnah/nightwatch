/* The 401 text of /api/auth/login (alias-free so node:test can load it). */

/** `hasHash`: a password hash exists anywhere. `problem`: configProblem(); a damaged config.json may be hiding the hash. */
export const loginFailReason = (hasHash: boolean, problem: string | null): string =>
  hasHash
    ? "Wrong password"
    : problem
      ? "The saved settings can't be read, so password sign-in is off until they are restored."
      : "No admin password is configured — login disabled";
