/**
 * Masks secrets in a host process command line before it reaches the client.
 * Heuristic by flag/key name; unmatched text is returned unchanged.
 */
const SECRET_NAME = String.raw`[\w.-]{0,128}(?:pass|token|secret|api[-_]?key|auth(?:[-_]?(?:token|key|header)|orization)?(?![\w.-]))[\w.-]{0,128}`;

// --flag=value and --flag value (a value starting with "-" is the next flag).
const FLAG = new RegExp(String.raw`(--?${SECRET_NAME})(=|\s+)(?!-)\S+`, "gi");
// KEY=value env-style args (no dashes).
const ENV = new RegExp(String.raw`((?:^|\s)${SECRET_NAME}=)\S+`, "gi");
const URL_PASS = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:@]*):[^\s/@]*@/gi;

// Short flags that are only secrets for these commands; the word may sit anywhere (sh -c "mysqladmin ping -pX").
const MYSQL = /\b(?:mysql\w*|mariadb\w*)\b/i;

// "key": "value", key=value, key: value where the key holds a secret word; quoted or bare value.
const KV = /((?<![\w.-])["']?[\w.-]{0,128}(?:pass|token|secret|api[-_]?key|credential|cookie|session|dsn|authorization)[\w.-]{0,128}["']?\s*(?:=>|[:=])\s*)("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s,;}&"']+)/gi;
// A name that ENDS in key after a separator or at the start (access_key, KEY), never keyboard or monkeys.
const KV_KEY = /((?<![\w.-])["']?(?:[\w.-]{0,128}[_.-])?key["']?\s*(?:=>|[:=])\s*)("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s,;}&"']+)/gi;
// Cookie headers hold several pairs: mask the whole value to the end of the line.
const COOKIE = /(\b(?:set-)?cookie\s*:\s*).+/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const GH_TOKEN = /\b(?:gh[pousr]_|github_pat_)\w{20,}/g;
// Any scheme (Token, ApiKey, Digest, AWS4...): mask to the end of the line; the colon or equals keeps prose "authorization failed" and "Basic settings" intact.
const AUTH = /((?<![\w.-])(?:[\w.-]{0,128}[_.-])?(?:proxy-)?authorization\\?["']?\s*[:=]\s*).+/gi;
const BEARER =/\bBearer\s+[\w.~+/=-]+/gi;

/** Container log text for the MCP client: cmdline masking plus key-value secrets and bare bearer tokens. */
export function redactLogText(text: string): string {
  return text
    .split("\n")
    .map((line) => redactCmdline(line.replace(AUTH, "$1***").replace(BEARER, "Bearer ***").replace(COOKIE, "$1***").replace(JWT, "***").replace(GH_TOKEN, "***").replace(KV, "$1***").replace(KV_KEY, "$1***")))
    .join("\n");
}

export function redactCmdline(s: string): string {
  let out = s.replace(URL_PASS, "$1:***@");
  // mysql form: -psecret attached; runs before FLAG so "-psecret db" is not read as a flag.
  if (MYSQL.test(s)) out = out.replace(/(^|\s)-p(?=\S)\S+/g, "$1-p***");
  if (/\bredis-cli\b/.test(s)) out = out.replace(/(\s-a\s+)(?!-)\S+/g, "$1***");
  if (/\bsshpass\b/.test(s)) out = out.replace(/(\bsshpass\b.*?\s-p\s*)(?!-)\S+/g, "$1***");
  return out
    .replace(/(\s(?:-u|--user(?=[\s=]))(?:\s+|=)?[^\s:]+):\S+/g, (m, a: string) => (/\bcurl\b/.test(s) ? `${a}:***` : m))
    .replace(/(Authorization:\s*\w+\s+)\S+/gi, "$1***")
    .replace(/(X-(?:Api-Key|Auth-Token):\s*)\S+/gi, "$1***")
    .replace(FLAG, (_m, name: string, sep: string) => `${name}${sep}***`)
    .replace(ENV, "$1***");
}

/** Cap AFTER redactCmdline so a cut can never split a secret before it is masked. */
export function capCmdline(redacted: string): string {
  return redacted.slice(0, 2048);
}

const DROPPED = "[earlier output dropped]\n";

/** Keeps the last `max` bytes of log text, cut at a line start when one exists, with a one-line marker. Run BEFORE redactLogText. */
export function tailLogBytes(text: string, max = 256 * 1024): string {
  const buf = Buffer.from(text);
  if (buf.length <= max) return text;
  const kept = buf.subarray(buf.length - max).toString();
  const nl = kept.indexOf("\n");
  // No newline: the kept text is one partial line whose secret name may be cut off, so drop it.
  return nl >= 0 ? DROPPED + kept.slice(nl + 1) : DROPPED;
}
