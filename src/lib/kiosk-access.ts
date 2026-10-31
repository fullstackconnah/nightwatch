// Exactly what an elevated kiosk calls (kiosk-admin-panel + KioskVoicePanel):
// the container list, the voice-panel Hermes status/run/job calls, container lifecycle actions (the route itself accepts only
// start/stop/restart/pause/unpause — no remove or kill), and the voice proxy.
// Everything else needs a real session.
const ELEVATED_KIOSK_ALLOWED: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["GET", /^\/api\/docker\/containers$/],
  ["POST", /^\/api\/docker\/containers\/[^/]+\/action$/],
  ["GET", /^\/api\/hermes-ctl\/status$/],
  ["POST", /^\/api\/hermes-ctl\/run$/], // the route limits elevation-only callers to kind "ask"
  ["GET", /^\/api\/hermes-ctl\/jobs\/[^/]+$/],
  ["GET", /^\/api\/voice\/status$/],
  ["POST", /^\/api\/voice\/(transcribe|speak)$/],
];

export function kioskMayCall(method: string, pathname: string): boolean {
  return ELEVATED_KIOSK_ALLOWED.some(([m, re]) => m === method && re.test(pathname));
}

// Hermes job kinds a caller without a real session (kiosk PIN elevation only) may start or read: only "ask".
// Unknown kinds are refused.
export function runAllowed(kind: string, hasSession: boolean): boolean {
  return hasSession || kind === "ask";
}

// Same rule for reading a job back (/api/hermes-ctl/jobs/[id]); the route answers 404 when this is false.
export const jobVisible = runAllowed;
