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
  return "Docker failed to create it.";
}
