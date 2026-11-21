const PAGE_SIZE = 50;
const MAX_PAGES = 10;

type Ok<T> = { ok: true; data: T[] };

/** Reads 1-based pages of 50 until one comes back short. Any failed page is returned as the failure, never a short list. */
export async function fetchAllPages<T, E extends { ok: false }>(
  fetchPage: (page: number) => Promise<Ok<T> | E>,
): Promise<Ok<T> | E> {
  const all: T[] = [];
  // shortcut: stops at 10 pages (500), raise the cap or page lazily if a repo ever exceeds it
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchPage(page);
    if (!r.ok) return r;
    // A non-array body is the caller's to guard (it does); on page 1 hand it back untouched.
    if (!Array.isArray(r.data)) return page === 1 ? r : { ok: true, data: all };
    all.push(...r.data);
    if (r.data.length < PAGE_SIZE) break;
  }
  return { ok: true, data: all };
}
