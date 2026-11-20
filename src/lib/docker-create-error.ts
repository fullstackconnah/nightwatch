/** Fixed copy for a failed container create; picked by matching Docker's message, never echoing it. */
export function createErrorCopy(message: string): string {
  if (/bind source path does not exist/i.test(message)) {
    return "A bind source doesn't exist on the host. Bind sources must already exist; they are not created.";
  }
  if (/port is already allocated|address already in use/i.test(message)) {
    return "That host port is already in use. Pick another port or stop what's using it.";
  }
  if (/is already in use by container|Conflict\. The container name/i.test(message)) {
    return "A container with that name already exists. Pick another name or remove the old one.";
  }
  if (/pull stalled/i.test(message)) {
    return "The image pull stalled with no progress for 60 seconds. Check the image name and the registry, then try again.";
  }
  if (/abort/i.test(message)) {
    return "Docker did not answer within 10 seconds. Check that Docker is running, then try again.";
  }
  return "Docker failed to create it.";
}

type Startable = { start(o: never): Promise<unknown>; remove(o: never): Promise<unknown> };

/** Start a just-created container; if the start fails, remove it (a leftover holds its name and blocks the retry) and rethrow the start error. Volumes are kept. */
export async function startOrRemove(container: Startable, timeoutMs: number): Promise<void> {
  try {
    await container.start({ abortSignal: AbortSignal.timeout(timeoutMs) } as never);
  } catch (e) {
    await container.remove({ force: true, abortSignal: AbortSignal.timeout(timeoutMs) } as never).catch(() => {});
    throw e;
  }
}
