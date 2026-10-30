// Exactly what an elevated kiosk calls (kiosk-admin-panel + KioskVoicePanel):
// the container list, container lifecycle actions (the route itself accepts only
// start/stop/restart/pause/unpause — no remove or kill), and the voice proxy.
// Everything else needs a real session.
const ELEVATED_KIOSK_ALLOWED: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["GET", /^\/api\/docker\/containers$/],
  ["POST", /^\/api\/docker\/containers\/[^/]+\/action$/],
  ["GET", /^\/api\/voice\/status$/],
  ["POST", /^\/api\/voice\/(transcribe|speak)$/],
];

export function kioskMayCall(method: string, pathname: string): boolean {
  return ELEVATED_KIOSK_ALLOWED.some(([m, re]) => m === method && re.test(pathname));
}
