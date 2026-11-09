import type { SocketScope } from "./types/network.ts";

// Alias-free leaf so node:test can load it (network.ts imports "@/").

/** "0100007F" (4 bytes, little-endian) -> "127.0.0.1". */
export function decodeSocketTableIPv4Hex(hex: string): string | null {
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const bytes: number[] = [];
  for (let i = 6; i >= 0; i -= 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes.join(".");
}

/** A /proc/net/tcp6 address that is IPv4-mapped (::ffff:a.b.c.d) -> its dotted v4, else null.
 *  Words 0-1 are zero, word 2 is 0000FFFF (printed "FFFF0000"), word 3 is the v4 address. */
export function unmapSocketHex(hex: string): string | null {
  if (!/^0{16}[fF]{4}0{4}[0-9a-fA-F]{8}$/.test(hex)) return null;
  return decodeSocketTableIPv4Hex(hex.slice(24));
}

export function classifyScope(address: string): SocketScope {
  if (address === "0.0.0.0" || address === "::") return "all-interfaces";
  if (address.startsWith("127.") || address === "::1") return "loopback";
  return "specific";
}

export function isLoopbackAddress(address: string, family: "v4" | "v6"): boolean {
  return family === "v4" ? address.startsWith("127.") : address.toLowerCase() === "::1";
}
