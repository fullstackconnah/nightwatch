/* While the doorbell takeover is open, a poll that comes back with no cameras
   (Home Assistant unreachable still answers 200 with cameras: []) must not
   unmount it: keep the camera it opened with. Closed, nothing is held. */
export function heldCameraId(current: string | null, last: string | null, open: boolean): string | null {
  return current ?? (open ? last : null);
}
