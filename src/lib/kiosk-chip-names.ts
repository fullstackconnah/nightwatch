/* Chip label shortening for the kiosk hub: pure, so it is unit-tested (moved from kiosk-hub.tsx unchanged). */

// PROBLEM (production screenshot, 1024×768, 2026-08-03): 7 of 8 switch/light
// entities share a "Front door" HA-assigned prefix, so their pill labels
// truncated to "Front door Emai…" / "Front door FTP …" / "Front door Push…" —
// at 2-3m every pill reads identically because the truncation always eats
// exactly the word that would have told them apart. Fix: find the leading
// run of whole words shared by 2+ entities in a section, strip it from each
// covered entity's label, and surface it once as the section's own context
// (SectionHeader's `qualifier`) instead of repeating it on every pill.
//
// Deliberately NOT a straight "common prefix of every name in the list":
// this fixture also has "Front Doorbell Motion detection", which shares only
// the word "Front" with the rest — a naive full-set LCP would strip just
// that one meaningless word and leave every other pill still starting with
// "door …". Instead this walks the word tree, extends through any depth
// where the *whole current group* agrees, and — the first time they don't —
// branches once into the largest sub-group (size 2+) and stops extending
// after that. One branch, not recursive majority-chasing: letting it re-branch
// at every depth would keep "distinguishing" a shrinking group all the way
// down to single entities (e.g. "Record" vs "Record audio" would themselves
// get "split" into a 2-item group and reduced to "" / "audio").
export function sharedLeadingWords(names: string[]): { prefixWords: string[]; coveredIndexes: Set<number> } {
  if (names.length < 2) return { prefixWords: [], coveredIndexes: new Set() };
  const wordLists = names.map((n) => n.trim().split(/\s+/));
  let group = names.map((_, i) => i);
  const prefixWords: string[] = [];
  let depth = 0;
  let branched = false;
  for (;;) {
    const buckets = new Map<string, number[]>();
    for (const i of group) {
      const words = wordLists[i];
      if (depth >= words.length) continue; // this entity's name ends exactly here
      const key = words[depth].toLowerCase();
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    if (buckets.size === 0) break; // every remaining member ended exactly at this depth
    if (buckets.size === 1) {
      // Whole current group agrees on this word — keep extending.
      const [[, ids]] = buckets;
      prefixWords.push(wordLists[ids[0]][depth]);
      depth++;
      continue;
    }
    if (branched) break; // already spent our one branch — don't chase a deeper majority
    let best: number[] | null = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.length > best.length) best = bucket;
    }
    if (!best || best.length < 2) break;
    prefixWords.push(wordLists[best[0]][depth]);
    group = best;
    branched = true;
    depth++;
  }
  return prefixWords.length === 0 ? { prefixWords: [], coveredIndexes: new Set() } : { prefixWords, coveredIndexes: new Set(group) };
}

/** Applies {@link sharedLeadingWords} to a section's entity names. Per-entity
 *  guard: an entity whose name IS the shared prefix (nothing left after
 *  stripping) keeps its full name rather than going blank — same for any
 *  entity outside the covered group (e.g. "Front Doorbell Motion detection"
 *  above), which is left completely untouched. */
export function shortenSharedPrefix(names: string[]): { labels: string[]; qualifier: string | null } {
  const { prefixWords, coveredIndexes } = sharedLeadingWords(names);
  if (prefixWords.length === 0) return { labels: names, qualifier: null };
  const labels = names.map((name, i) => {
    if (!coveredIndexes.has(i)) return name;
    const words = name.trim().split(/\s+/);
    if (words.length <= prefixWords.length) return name;
    return words.slice(prefixWords.length).join(" ");
  });
  return { labels, qualifier: prefixWords.join(" ") };
}
