export interface ReclaimImage {
  Id: string;
  RepoTags?: string[] | null;
  Size: number;
  Created: number;
}

/** Dangling = untagged and used by no container (running or stopped): the set
 *  `docker image prune` removes. unusedBytes is every unused image, tagged or not. */
export function classifyImages(images: readonly ReclaimImage[], inUseImageIds: ReadonlySet<string>) {
  const dangling: { id: string; tags: string[]; size: number; created: number }[] = [];
  let danglingBytes = 0;
  let unusedBytes = 0;
  for (const img of images) {
    const tags = (img.RepoTags ?? []).filter((t) => t !== "<none>:<none>");
    const used = inUseImageIds.has(img.Id);
    if (!used) unusedBytes += img.Size;
    if (tags.length === 0 && !used) {
      danglingBytes += img.Size;
      dangling.push({ id: img.Id, tags, size: img.Size, created: img.Created });
    }
  }
  return { dangling, danglingBytes, unusedBytes };
}
