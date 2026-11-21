type Providers = { modrinth?: string; curseforge?: string };

/** A provider that failed answers 200 with no results; name it so it isn't read as "No results." */
export function packProviderNote(search: Providers | undefined): string | null {
  const mr = search?.modrinth === "error";
  const cf = search?.curseforge === "error";
  if (mr && cf) return "Modrinth and CurseForge didn't answer. Try again.";
  if (mr) return "Modrinth didn't answer. Try again.";
  if (cf) return "CurseForge didn't answer. Try again.";
  return null;
}

export type PackSearchView = "prompt" | "failed" | "searching" | "searching-over-old" | "empty" | "empty-with-note" | "results";

export function packSearchView(
  debounced: string,
  hasError: boolean,
  search: (Providers & { results: unknown[] }) | undefined,
  isLoading: boolean,
): PackSearchView {
  if (!debounced) return "prompt";
  if (hasError) return "failed";
  if (!search) return "searching";
  if (isLoading) return "searching-over-old";
  if (search.results.length > 0) return "results";
  return packProviderNote(search) ? "empty-with-note" : "empty";
}
