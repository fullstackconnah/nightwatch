/* Containers other automation starts and stops all day (test stacks, `docker run --rm` runners).
 * Their going down is not worth telling the owner about. Pure, so node:test can load it. */

const TOKEN_SPLIT = /[-_.]/;
const hasTestToken = (s: string | null) =>
  s !== null && s.toLowerCase().split(TOKEN_SPLIT).some((t) => t === "test" || t.startsWith("vvtest") || t.startsWith("pgtest"));

export function isTestContainer(c: { name: string; composeProject: string | null }): boolean {
  if (hasTestToken(c.name) || hasTestToken(c.composeProject)) return true;
  // shortcut: a bare `word_word` name with no compose project is read as Docker's random name, so a hand-named
  // standalone container shaped like that is also muted; upgrade by checking the image or a label if one appears.
  return c.composeProject === null && /^[a-z]+_[a-z]+$/.test(c.name);
}
