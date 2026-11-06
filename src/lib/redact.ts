/**
 * Masks secrets in a host process command line before it reaches the client.
 * Heuristic by flag/key name; unmatched text is returned unchanged.
 */
const SECRET_NAME = String.raw`[\w.-]*(?:pass|token|secret|api[-_]?key|auth(?:[-_]?(?:token|key|header)|orization)?(?![\w.-]))[\w.-]*`;

// --flag=value and --flag value (a value starting with "-" is the next flag).
const FLAG = new RegExp(String.raw`(--?${SECRET_NAME})(=|\s+)(?!-)\S+`, "gi");
// KEY=value env-style args (no dashes).
const ENV = new RegExp(String.raw`((?:^|\s)${SECRET_NAME}=)\S+`, "gi");
const URL_PASS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*):[^\s/@]*@/gi;

// Short flags that are only secrets for these commands; the word may sit anywhere (sh -c "mysqladmin ping -pX").
const MYSQL = /\b(?:mysql\w*|mariadb\w*)\b/i;

export function redactCmdline(s: string): string {
  let out = s.replace(URL_PASS, "$1:***@");
  // mysql form: -psecret attached; runs before FLAG so "-psecret db" is not read as a flag.
  if (MYSQL.test(s)) out = out.replace(/(^|\s)-p(?=\S)\S+/g, "$1-p***");
  if (/\bredis-cli\b/.test(s)) out = out.replace(/(\s-a\s+)(?!-)\S+/g, "$1***");
  if (/\bsshpass\b/.test(s)) out = out.replace(/(\bsshpass\b.*?\s-p\s*)(?!-)\S+/, "$1***");
  return out
    .replace(/(\s(?:-u|--user)(?:\s+|=)?[^\s:]+):\S+/g, (m, a: string) => (/\bcurl\b/.test(s) ? `${a}:***` : m))
    .replace(/(Authorization:\s*\w+\s+)\S+/gi, "$1***")
    .replace(/(X-(?:Api-Key|Auth-Token):\s*)\S+/gi, "$1***")
    .replace(FLAG, (_m, name: string, sep: string) => `${name}${sep}***`)
    .replace(ENV, "$1***");
}
