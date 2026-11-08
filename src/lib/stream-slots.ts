/* Cap on concurrently open proxied streams. acquire() returns a release fn (idempotent) or null at the cap. */
export function createStreamSlots(max: number) {
  let open = 0;
  return {
    open: () => open,
    acquire(): (() => void) | null {
      if (open >= max) return null;
      open++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        open--;
      };
    },
  };
}
