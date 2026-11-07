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
