import { NextRequest, NextResponse } from "next/server";
import { contentLengthError } from "@/lib/upload-limit";
import bcrypt from "bcryptjs";
import { candidatePasswordHashes } from "@/lib/auth-server";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { epochOf, loadConfigForSave, readAuthStateForSave, saveAuthState, saveConfig, saveErrorText, type AppConfig, type AuthState } from "@/lib/config";
import { isSecureRequest } from "@/lib/oidc-origin";
import { isPasswordOverBytes } from "@/lib/settings-field-checks";
import { checkCurrentPassword, currentPasswordLimiter } from "@/lib/step-up";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route — this
// only rotates the password for the session that is already logged in.

const MIN_LENGTH = 8;
// Same bcrypt cost as scripts/hash-password.mjs, so a hash minted here is
// indistinguishable from one minted at the CLI.
const BCRYPT_ROUNDS = 12;

/**
 * The one writer of the stored password hash (data/auth.json, mirrored into config.json) (GOAL A's
 * "Change password" flow). Requires the CURRENT password and verifies it
 * against candidatePasswordHashes() — the SAME stored-hash-else-env choice the
 * login route uses, so the password that signs in is the one that can be
 * changed. There is no "no current password" bootstrap path here: if
 * nothing is configured yet (candidates.length === 0), the owner sets
 * ADMIN_PASSWORD_HASH once via the environment/CLI (see
 * `npm run hash-password`), then manages it here from then on — mirroring
 * how the dev-mode login bypass (any password accepted) is a login-only
 * affordance and deliberately does not extend to this destructive write.
 * A change signs out every other session (system.sessionEpoch); this browser gets a fresh cookie.
 */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const tooBig = contentLengthError(req.headers.get("content-length"), MAX_BODY_BYTES, "The request");
  if (tooBig) return NextResponse.json({ error: tooBig.detail }, { status: tooBig.status });
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!newPassword || newPassword.length < MIN_LENGTH) {
    return NextResponse.json({ error: `New password must be at least ${MIN_LENGTH} characters` }, { status: 400 });
  }
  if (isPasswordOverBytes(newPassword)) {
    return NextResponse.json({ error: "New password is too long: the most is 72 bytes (72 plain letters, fewer with accents or emoji)" }, { status: 400 });
  }

  const candidates = candidatePasswordHashes();
  if (!candidates.length) {
    return NextResponse.json(
      { error: "No admin password is configured yet — set ADMIN_PASSWORD_HASH in the environment first, then it can be rotated here." },
      { status: 400 },
    );
  }
  if (!currentPassword) {
    return NextResponse.json({ error: "Current password is required" }, { status: 400 });
  }

  // One damper shared with the system route: the current-password check is otherwise a free bcrypt oracle.
  const check = await checkCurrentPassword(currentPassword, candidates.map((c) => c.hash), {
    limiter: currentPasswordLimiter,
    compare: bcrypt.compare,
  });
  if (check === "limited") {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 });
  }
  if (check !== "ok") {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }
  const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  const now = new Date().toISOString();
  let current: AppConfig;
  let auth: AuthState;
  try {
    current = loadConfigForSave();
    auth = readAuthStateForSave();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  // The higher of both stores, so a stale config copy can never hand out an epoch an old session already holds.
  const nextEpoch = Math.max(epochOf(auth.sessionEpoch), epochOf(current.system?.sessionEpoch)) + 1;
  if (!Number.isSafeInteger(nextEpoch)) {
    return NextResponse.json({ error: "The sign-out counter is out of range, so nothing was saved." }, { status: 500 });
  }
  const next: AppConfig = {
    ...current,
    system: { ...current.system, adminPasswordHash: newHash, sessionEpoch: nextEpoch, updatedAt: now },
  };

  // auth.json first: it owns the epoch and the hash. A crash between the two writes leaves the new password in force (the config is only a mirror for a rollback).
  try {
    saveAuthState({ ...auth, v: 2, adminPasswordHash: newHash, sessionEpoch: nextEpoch, updatedAt: now });
  } catch (e) {
    console.error("settings/password save auth state", e);
    return NextResponse.json({ error: saveErrorText(e) }, { status: 500 });
  }
  try {
    saveConfig(next);
  } catch (e) {
    // The password HAS changed (auth.json is written), so this still answers ok; only the rollback mirror is stale.
    console.error("settings/password mirror to config failed", e);
  }

  const res = NextResponse.json({ ok: true, updatedAt: now });
  // The changing browser would otherwise be signed out by its own change; if minting fails the password is saved, sign in again.
  try {
    res.cookies.set(SESSION_COOKIE, await createSessionToken(epochOf(nextEpoch)), sessionCookieOptions(isSecureRequest(req)));
  } catch (e) {
    console.error("settings/password re-issue session", e);
  }
  return res;
}
