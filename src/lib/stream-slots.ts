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

/** Wraps an upstream body so `release` runs when it ends, errors or the consumer cancels. */
export function releaseOnEnd(body: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          c.close();
        } else c.enqueue(value);
      } catch (e) {
        release();
        c.error(e);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
}
