import { NextRequest, NextResponse } from "next/server";
import { getHaStates, performHaAction } from "@/lib/ha";
import { getHermesJob, runHermesJob } from "@/lib/hermes-ctl";
import { matchIntent, type KioskIntent } from "@/lib/kiosk-intent";
import type { HaActionRequest } from "@/lib/ha-types";

export const dynamic = "force-dynamic";

/**
 * The assistant's single write surface: an utterance in, an action taken and a
 * sentence to speak back out.
 *
 * PUBLIC AND UNAUTHENTICATED, like the rest of /kiosk/api/* (middleware.ts's
 * PUBLIC_PATHS covers "/kiosk"). The owner was shown that this means anyone on
 * the LAN can drive it and chose that deliberately, so there is no elevation
 * gate here. What that choice does NOT extend to is widening what the kiosk
 * can reach at all: this route reuses exactly the capability the tap-driven
 * surface already has.
 *
 * Concretely, the safety properties this route preserves:
 *  - LOCKS ARE UNREACHABLE. Nothing here can emit a "lock"/"unlock" action —
 *    the intent type has no such variant, so it is excluded by construction
 *    rather than by a filter someone could later loosen. That exclusion is a
 *    standing decision (see kiosk/api/ha/action/route.ts's header) and is not
 *    part of the "open access" choice.
 *  - ENTITIES ARE RE-RESOLVED SERVER-SIDE. The client sends prose, never an
 *    entity id, and the matcher runs against a fresh getHaStates() here. A
 *    caller cannot name an entity the kiosk was never willing to show, because
 *    the caller never names an entity at all.
 *  - Temperatures are clamped before they reach HA, mirroring the bounds the
 *    tap surface's own route enforces.
 *  - Nothing leaks: HA and hermes tokens live server-side, and every failure
 *    returns a flat message rather than an upstream body or a stack.
 */

const MAX_UTTERANCE = 500;

/** Same absolute backstop the tap surface uses, restated rather than imported
 *  so a change there can never silently widen what speech can ask for. */
const MIN_TEMP = 5;
const MAX_TEMP = 35;

/** How long to wait for hermes to answer an open question before giving up.
 *  The ask path is a poll-until-done job; a wall display asking "what's the
 *  weather in Perth" should not hold a request open indefinitely. */
const ASK_TIMEOUT_MS = 30_000;
const ASK_POLL_MS = 1500;

interface AssistantResponse {
  ok: boolean;
  /** The sentence to show and speak. Always present, always human-readable. */
  say: string;
  kind: KioskIntent["kind"];
  /** Only for `ask` — the model's prose answer. */
  answer?: string;
}

function reply(body: AssistantResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function runHaAction(req: HaActionRequest): Promise<{ ok: boolean; detail?: string }> {
  const result = await performHaAction(req);
  return result.ok ? { ok: true } : { ok: false, detail: result.detail };
}

/** Polls a hermes ask job to completion. Returns null on timeout or failure —
 *  the caller turns that into a spoken apology rather than an error page. */
async function askHermes(question: string): Promise<string | null> {
  const started = await runHermesJob("ask", question);
  if (!started.ok) return null;
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, ASK_POLL_MS));
    const job = await getHermesJob(started.jobId);
    if (!job.ok) return null;
    if (job.job.state === "done") return job.job.result?.body ?? job.job.result?.title ?? null;
    if (job.job.state === "error") return null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => null);
    const utterance = raw && typeof raw === "object" ? (raw as Record<string, unknown>).utterance : null;
    if (typeof utterance !== "string" || !utterance.trim()) {
      return reply({ ok: false, say: "I didn't catch that.", kind: "unresolved" }, 400);
    }
    if (utterance.length > MAX_UTTERANCE) {
      return reply({ ok: false, say: "That was a bit long for me.", kind: "unresolved" }, 400);
    }

    // Fresh, server-side truth about what exists. If HA is unreachable the
    // matcher still runs — it just can't resolve devices, so device phrasings
    // fall through to `unresolved` and open questions still work.
    const states = await getHaStates();
    const entities = states.status === "ok" ? states.entities ?? null : null;

    const intent = matchIntent(utterance, { entities });

    switch (intent.kind) {
      case "light": {
        // The kiosk's HA layer exposes toggle rather than explicit on/off, so
        // an explicit request only acts when it would actually change state —
        // "turn on" on an already-on light must be a no-op, not a toggle off.
        const light = entities?.lights.find((l) => l.entityId === intent.entityId);
        if (!light) return reply({ ok: false, say: "I couldn't find that light.", kind: intent.kind });
        const wantOn = intent.action === "turn_on" ? true : intent.action === "turn_off" ? false : !light.on;
        if (light.on === wantOn) {
          return reply({ ok: true, say: `${light.name} is already ${wantOn ? "on" : "off"}.`, kind: intent.kind });
        }
        const r = await runHaAction({ entityId: intent.entityId, action: "toggle" });
        return reply({ ok: r.ok, say: r.ok ? intent.say : "That didn't work.", kind: intent.kind });
      }

      case "scene": {
        const r = await runHaAction({ entityId: intent.entityId, action: "activate_scene" });
        return reply({ ok: r.ok, say: r.ok ? intent.say : "That didn't work.", kind: intent.kind });
      }

      case "climate.power": {
        const unit = entities?.climates.find((c) => c.entityId === intent.entityId);
        if (!unit) return reply({ ok: false, say: "I couldn't find that room.", kind: intent.kind });
        // Mirrors the tile's own preference order for what "on" means, since
        // HA has no generic climate on: let the unit self-manage where it can.
        const onMode = ["heat_cool", "auto", "heat", "cool"].find((m) => unit.hvacModes.includes(m))
          ?? unit.hvacModes.find((m) => m !== "off");
        const hvacMode = intent.on ? onMode : "off";
        if (!hvacMode) return reply({ ok: false, say: `${unit.name} has no mode I can set.`, kind: intent.kind });
        const r = await runHaAction({ entityId: intent.entityId, action: "set_hvac_mode", hvacMode });
        return reply({ ok: r.ok, say: r.ok ? intent.say : "That didn't work.", kind: intent.kind });
      }

      case "climate.temp": {
        const temperature = Math.min(MAX_TEMP, Math.max(MIN_TEMP, intent.temperature));
        const r = await runHaAction({ entityId: intent.entityId, action: "set_temp", temperature });
        return reply({ ok: r.ok, say: r.ok ? intent.say : "That didn't work.", kind: intent.kind });
      }

      case "climate.mode": {
        const r = await runHaAction({ entityId: intent.entityId, action: "set_hvac_mode", hvacMode: intent.hvacMode });
        return reply({ ok: r.ok, say: r.ok ? intent.say : "That didn't work.", kind: intent.kind });
      }

      case "camera":
        // Nothing to execute server-side — the client owns the modal. The
        // `kind` is the instruction; `say` is what gets spoken alongside it.
        return reply({ ok: true, say: intent.say, kind: intent.kind });

      /* Container lifecycle has no case here and no intent of its own. It is
         reachable today only through the authenticated dashboard or the
         bearer-gated MCP server, and routing it through an unauthenticated
         voice surface would be a genuine capability increase rather than a
         new way to do something the kiosk could already do — which is the
         line this route holds even under the owner's "open access" choice.
         Those phrasings therefore fall through to `ask`, where hermes
         declines them accurately (verified live: it named the container,
         reported its real state, and pointed at the dashboard). */

      case "ask": {
        const answer = await askHermes(intent.question);
        if (!answer) return reply({ ok: false, say: "I couldn't reach Hermes for that.", kind: intent.kind });
        return reply({ ok: true, say: answer, kind: intent.kind, answer });
      }

      case "unresolved":
      default:
        return reply({ ok: false, say: intent.say, kind: "unresolved" });
    }
  } catch {
    // A public route must never surface an unhandled error's message.
    return reply({ ok: false, say: "Something went wrong.", kind: "unresolved" }, 500);
  }
}
