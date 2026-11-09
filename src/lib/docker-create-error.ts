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
    return "Docker did not answer the image pull within 10 seconds. Check that Docker is running, then try again.";
  }
  return "Docker failed to create it.";
}
