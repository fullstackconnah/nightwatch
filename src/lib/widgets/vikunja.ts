import { formatNumber } from "../format.ts";
import { fetchJsonWithHeaders, WidgetError, type WidgetFetcher, type WidgetField } from "./types.ts";

/** Each field's `path` is a Vikunja task filter; the value is how many tasks match (counts ride in response headers). */
export const vikunja: WidgetFetcher = async (w) => {
  if (!w.key) throw new WidgetError("no API token");
  const specs = w.fields?.length ? w.fields.slice(0, 4) : [{ label: "Open", path: "done = false" }]; // a card shows 4
  const base = w.url.replace(/\/+$/, "");
  if (specs.some((f) => !f.path?.trim())) throw new WidgetError("empty filter"); // an empty filter counts every task or gets a 400
  return Promise.all(
    specs.map(async (f): Promise<WidgetField> => {
      const { headers } = await fetchJsonWithHeaders(`${base}/api/v1/tasks?per_page=1&filter=${encodeURIComponent(f.path)}`, {
        headers: { Authorization: `Bearer ${w.key}` },
      });
      // per_page=1 makes total pages equal the match count; an empty page still reports 1 page.
      const rows = headers.get("X-Pagination-Result-Count");
      const pages = headers.get("X-Pagination-Total-Pages");
      const n = rows === "0" ? 0 : parseInt(pages ?? "", 10);
      if (!Number.isInteger(n)) throw new WidgetError("no count header");
      return { label: f.label, value: formatNumber(n) };
    }),
  );
};
