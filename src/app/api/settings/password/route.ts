import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { candidatePasswordHashes } from "@/lib/auth-server";
import { loadConfig, saveConfig, type AppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route — this
// only rotates the password for the session that is already logged in.

const MIN_LENGTH = 8;
// Same bcrypt cost as scripts/hash-password.mjs, so a hash minted here is
// indistinguishable from one minted at the CLI.
const BCRYPT_ROUNDS = 12;

/**
 * The one writer of config.json's system.adminPasswordHash (GOAL A's
 * "Change password" flow). Requires the CURRENT password and verifies it
 * against candidatePasswordHashes() — the SAME both-sources check the login
 * route uses, so this can never be bypassed by a stale config value, and a
 * broken config hash can still be rotated as long as the env hash still
 * verifies. There is no "no current password" bootstrap path here: if
 * nothing is configured yet (candidates.length === 0), the owner sets
 * ADMIN_PASSWORD_HASH once via the environment/CLI (see
 * `npm run hash-password`), then manages it here from then on — mirroring
 * how the dev-mode login bypass (any password accepted) is a login-only
 * affordance and deliberately does not extend to this destructive write.
 */
export async function POST(req: NextRequest) {
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!newPassword || newPassword.length < MIN_LENGTH) {
    return NextResponse.json({ error: `New password must be at least ${MIN_LENGTH} characters` }, { status: 400 });
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

  let verified = false;
  for (const candidate of candidates) {
    if (await bcrypt.compare(currentPassword, candidate.hash)) {
      verified = true;
      break;
    }
  }
  if (!verified) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  const now = new Date().toISOString();
  const current = loadConfig();
  const next: AppConfig = {
    ...current,
    system: { ...current.system, adminPasswordHash: newHash, updatedAt: now },
  };

  try {
    saveConfig(next);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, updatedAt: now });
}
