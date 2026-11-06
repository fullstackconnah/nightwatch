/**
 * Masks secrets in a host process command line before it reaches the client.
 * Heuristic by flag/key name; unmatched text is returned unchanged.
 */
const SECRET_NAME = String.raw`[\w.-]*(?:pass|token|secret|api[-_]?key|auth)[\w.-]*`;

// --flag=value and --flag value (a value starting with "-" is the next flag).
const FLAG = new RegExp(String.raw`(--?${SECRET_NAME})(=|\s+)(?!-)\S+`, "gi");
// KEY=value env-style args (no dashes).
const ENV = new RegExp(String.raw`((?:^|\s)${SECRET_NAME}=)\S+`, "gi");
const URL_PASS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*):[^\s/@]*@/gi;

export function redactCmdline(s: string): string {
  return s
    .replace(URL_PASS, "$1:***@")
    // mysql form: -psecret attached; a bare "-p 8080" is left alone. Runs before FLAG so "-psecret db" is not read as a flag.
    .replace(/(^|\s)-p(?=\S)\S+/g, "$1-p***")
    .replace(FLAG, (_m, name: string, sep: string) => `${name}${sep}***`)
    .replace(ENV, "$1***");
}
