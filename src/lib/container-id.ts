// Docker ids are hex; names are [a-zA-Z0-9][a-zA-Z0-9_.-]. Anything else (slashes,
// encoded traversal) must never reach docker.getContainer(id)'s URL path.
export const isContainerId = (id: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id);

// Image ids from the list route are "sha256:" + 64 hex; short ids are 12-64 hex.
export const isImageId = (id: string): boolean => /^(sha256:)?[a-f0-9]{12,64}$/.test(id);
