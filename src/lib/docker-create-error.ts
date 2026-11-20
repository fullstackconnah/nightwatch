const GENERIC = "Docker failed to create it.";

/** Fixed copy plus an HTTP status for a failed container create, picked by matching Docker's message, never echoing it. 409/400: the user can fix it in the form; 500: they cannot. */
export function createErrorResult(message: string): { copy: string; status: number } {
  const m = typeof message === "string" ? message : "";
  const r = (copy: string, status: number) => ({ copy, status });
  if (/bind source path does not exist/i.test(m)) {
    return r("A bind source doesn't exist on the host. Bind sources must already exist; they are not created.", 400);
  }
  if (/port is already allocated|address already in use/i.test(m)) {
    return r("That host port is already in use. Pick another port or stop what's using it.", 409);
  }
  if (/is already in use by container|Conflict\. The container name/i.test(m)) {
    return r("A container with that name already exists. Pick another name or remove the old one.", 409);
  }
  if (/pull stalled/i.test(m)) {
    return r("The image pull stalled with no progress for 60 seconds. Check the image name and the registry, then try again.", 500);
  }
  if (/pull access denied|manifest unknown|manifest for|not found: manifest|repository does not exist|No such image/i.test(m)) {
    return r("Docker could not find that image. Check the image name and tag, then try again.", 400);
  }
  if (/no such host|dial tcp|connection refused|TLS handshake timeout|i\/o timeout/i.test(m)) {
    return r("Docker could not reach the image registry. Check the host's network and DNS, then try again.", 500);
  }
  if (/invalid mount config|invalid volume specification|is not a valid/i.test(m)) {
    return r("Docker refused a mount. Check the host and container paths, then try again.", 400);
  }
  if (/no space left on device/i.test(m)) {
    return r("The Docker host is out of disk space. Free some space, then try again.", 500);
  }
  if (/abort/i.test(m)) {
    return r("Docker did not answer within 10 seconds. Check that Docker is running, then try again.", 500);
  }
  return r(GENERIC, 500);
}

export function createErrorCopy(message: string): string {
  return createErrorResult(message).copy;
}

type Startable = { start(o: never): Promise<unknown>; remove(o: never): Promise<unknown> };

/** Start a just-created container; if the start fails, remove it (a leftover holds its name and blocks the retry) and rethrow the start error. Volumes are kept. */
export async function startOrRemove(container: Startable, timeoutMs: number): Promise<void> {
  try {
    await container.start({ abortSignal: AbortSignal.timeout(timeoutMs) } as never);
  } catch (e) {
    await container.remove({ force: true, abortSignal: AbortSignal.timeout(timeoutMs) } as never).catch((re) => {
      console.warn(`[docker] created container could not be removed after a failed start: ${re instanceof Error ? re.message : String(re)}`);
    });
    throw e;
  }
}
