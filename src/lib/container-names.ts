export interface NamedContainer {
  id: string;
  name: string;
}

const find = (list: NamedContainer[], id: string) => list.find((c) => c.id === id || c.id.startsWith(id));

/** Names for the given ids (full or prefix) from one container list. */
export function namesForIds(list: NamedContainer[], ids: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of ids) {
    const match = find(list, id);
    if (match) map.set(id, match.name);
  }
  return map;
}

/** True when every id is in the list; a cached list missing one is stale for this call. */
export const allResolve = (list: NamedContainer[], ids: Iterable<string>) =>
  [...ids].every((id) => find(list, id));
