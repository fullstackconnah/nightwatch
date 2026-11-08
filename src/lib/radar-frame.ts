/* Radar frame proxy checks, pure and relative-import-only so node:test can load them. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when the bytes start with the 8-byte PNG signature. */
export function isPngBytes(body: ArrayBuffer): boolean {
  const head = new Uint8Array(body, 0, Math.min(8, body.byteLength));
  return head.length === 8 && PNG_SIGNATURE.every((b, i) => head[i] === b);
}

/** The proxy serves only the product the kiosk itself loops; `loop` is buildRadarLoop(), null when unconfigured. */
export function isKioskRadarProduct(product: string, loop: { product: string } | null): boolean {
  return loop !== null && product === loop.product;
}

function stampMs(t: string): number {
  return Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12));
}

/** A listed stamp, or the one grid step before the oldest: the list route's 2-min cache can hand out a list one step older than this route's fresh one. */
export function isListedFrame(t: string, frames: string[]): boolean {
  if (frames.includes(t)) return true;
  if (frames.length < 2) return false;
  const step = stampMs(frames[1]) - stampMs(frames[0]);
  return stampMs(t) === stampMs(frames[0]) - step;
}
