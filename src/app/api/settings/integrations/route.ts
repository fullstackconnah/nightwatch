import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig, type AppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

// Auth: gated by src/middleware.ts, same as every other /api/* route.

/**
 * Dedicated read-modify-write route for the four Integrations panels
 * (Home Assistant / Nginx Proxy Manager / Forgejo / GitHub), mirroring the
 * reasoning in src/app/api/resources/pins/route.ts: routing this through the
 * general /api/settings PUT would round-trip the whole (sanitized, secret-
 * stripped) AppConfig from client state and either drop these blocks or
 * silently blank out their real secrets. This route only ever reads/writes
 * its own four keys, spreading the rest of `current` through unchanged.
 *
 * Body: one or more of homeassistant/npm/forgejo/github. Each value is either
 * `null` (delete the whole block — the panel's "Clear" action) or a partial
 * patch. A secret field (token/password) is only overwritten when a non-empty
 * string is sent; an absent or empty secret means "keep the existing value",
 * which is what lets a save with a blank password field not blank out the
 * stored one. Non-secret fields (url/email) are always taken from the patch
 * when present.
 */

type Patch = { url?: unknown; email?: unknown; token?: unknown; password?: unknown };
type Body = {
  homeassistant?: Patch | null;
  npm?: Patch | null;
  forgejo?: Patch | null;
  github?: Patch | null;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

/** `newSecret` wins only if non-empty; otherwise the existing stored secret survives. */
function mergedSecret(newValue: string | undefined, existing: string | undefined): string | undefined {
  return newValue ? newValue : existing;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const current = loadConfig();
  const next: AppConfig = { ...current };
  const now = new Date().toISOString();

  if ("homeassistant" in body) {
    if (body.homeassistant === null) {
      delete next.homeassistant;
    } else if (body.homeassistant) {
      const url = str(body.homeassistant.url) ?? current.homeassistant?.url;
      const token = mergedSecret(str(body.homeassistant.token), current.homeassistant?.token);
      if (!url) return NextResponse.json({ error: "Home Assistant needs a URL" }, { status: 400 });
      if (!token) return NextResponse.json({ error: "Home Assistant needs a long-lived access token" }, { status: 400 });
      // Spread `current` first: this block is not just {url, token} any more —
      // it carries the kiosk's hand-edited `doorbell` overrides, which this
      // panel neither shows nor sends. Rebuilding it from the patch alone
      // erased them on every HA save (the same clobber the PUT in
      // ../route.ts documents at its own read-modify-write).
      next.homeassistant = { ...current.homeassistant, url, token, updatedAt: now };
    }
  }

  if ("npm" in body) {
    if (body.npm === null) {
      delete next.npm;
    } else if (body.npm) {
      const url = str(body.npm.url) ?? current.npm?.url;
      const email = str(body.npm.email) ?? current.npm?.email;
      const password = mergedSecret(str(body.npm.password), current.npm?.password);
      if (!url) return NextResponse.json({ error: "NPM needs a URL" }, { status: 400 });
      if (!email) return NextResponse.json({ error: "NPM needs the admin email" }, { status: 400 });
      if (!password) return NextResponse.json({ error: "NPM needs the admin password" }, { status: 400 });
      next.npm = { url, email, password, updatedAt: now };
    }
  }

  if ("forgejo" in body) {
    if (body.forgejo === null) {
      delete next.forgejo;
    } else if (body.forgejo) {
      const url = str(body.forgejo.url) ?? current.forgejo?.url;
      const token = mergedSecret(str(body.forgejo.token), current.forgejo?.token);
      if (!url) return NextResponse.json({ error: "Forgejo needs a URL" }, { status: 400 });
      if (!token) return NextResponse.json({ error: "Forgejo needs an access token" }, { status: 400 });
      next.forgejo = { url, token, updatedAt: now };
    }
  }

  if ("github" in body) {
    if (body.github === null) {
      delete next.github;
    } else if (body.github) {
      const token = mergedSecret(str(body.github.token), current.github?.token);
      if (!token) return NextResponse.json({ error: "GitHub needs a personal access token" }, { status: 400 });
      next.github = { token, updatedAt: now };
    }
  }

  try {
    saveConfig(next);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    integrations: {
      homeassistant: { configured: Boolean(next.homeassistant?.token), updatedAt: next.homeassistant?.updatedAt },
      npm: { configured: Boolean(next.npm?.password), updatedAt: next.npm?.updatedAt },
      forgejo: { configured: Boolean(next.forgejo?.token), updatedAt: next.forgejo?.updatedAt },
      github: { configured: Boolean(next.github?.token), updatedAt: next.github?.updatedAt },
    },
  });
}
