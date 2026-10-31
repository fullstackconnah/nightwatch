// Docker ids are hex; names are [a-zA-Z0-9][a-zA-Z0-9_.-]. Anything else (slashes,
// encoded traversal) must never reach docker.getContainer(id)'s URL path.
export const isContainerId = (id: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id);
