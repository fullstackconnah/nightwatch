const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;

/** Header line of the Network page; 0 takes the plural. */
export function networkSummary(interfaces: number, ports: number, peers: number): string {
  return [n(interfaces, "interface", "interfaces"), n(ports, "listening port", "listening ports"), n(peers, "remote peer", "remote peers")].join(" · ");
}
