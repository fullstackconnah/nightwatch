/* The one connection head for the integration pages (R12): what a page says before it has data to show, in the five
 * states where no strips render. The upstream `detail` (it can hold a host) is deliberately not an input. Pure, so
 * node:test can load it. Section 4 of the strips shape brief is the copy. */

export type ConnectionState = "loading" | "error" | "unconfigured" | "unauthorized" | "unreachable";
export interface ConnectionConfig {
  /** "Hermes", "Forgejo", "Nginx Proxy Manager". */
  name: string;
  /** "Settings → Access". */
  place: string;
  /** "/settings#access". */
  href: string;
  /** "Status, runs and ask": what is paused while the integration is not answering. */
  paused: string;
  /** The page's own refresh, in seconds. */
  retryS: number;
}
export interface ConnectionHead {
  chip: { tone: "neutral" | "warn"; label: string };
  answer: string;
  evidence: string;
  link: { href: string; label: string } | null;
  autoTarget: "keep";
}

export function connectionHead(c: ConnectionConfig, state: ConnectionState): ConnectionHead {
  const settings = { href: c.href, label: "Open Settings" };
  const h = (tone: "neutral" | "warn", label: string, answer: string, evidence: string, link: ConnectionHead["link"] = null): ConnectionHead => ({
    chip: { tone, label }, answer, evidence, link, autoTarget: "keep",
  });
  switch (state) {
    case "loading":
      return h("neutral", "Checking", `Connecting to ${c.name}…`, "First answer usually takes a second");
    case "error":
      return h("warn", "No answer", `The dashboard can’t reach its own ${c.name} check, so ${c.name}’s state is unknown.`, "Check that the dashboard is running, then reload.");
    case "unconfigured":
      return h("neutral", "Not connected", `${c.name} isn’t connected yet.`, `Add the ${c.name} address and token in ${c.place}.`, settings);
    case "unauthorized":
      return h("warn", "Token rejected", `${c.name} rejected the token. Check it in ${c.place}.`, "Everything here is paused until the token works.", settings);
    case "unreachable":
      return h("warn", "Not answering", `${c.name} isn’t answering. ${c.paused} are paused until it’s back.`, `Retrying every ${c.retryS} s.`);
  }
}
