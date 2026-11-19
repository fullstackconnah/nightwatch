/** Container detail heading: the name, else Docker's 12-char short id for a full 64-hex id, else the route id (a name). */
export function containerHeading(name: string | null | undefined, id: string): string {
  if (name) return name;
  return /^[0-9a-f]{64}$/.test(id) ? id.slice(0, 12) : id;
}
