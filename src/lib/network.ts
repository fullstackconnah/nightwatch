import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { docker, listContainers } from "@/lib/docker";
import { HOST_PROC, HOST_ROOTFS, HOST_SYS } from "@/lib/host-metrics";
import type {
  InterfaceRole,
  LinkState,
  ListeningSocket,
  NetInterface,
  NetworkSnapshot,
  SocketOwner,
  SocketProtocol,
  SocketScope,
} from "@/lib/network-types";

/**
 * Network collector: interface inventory (role, speed, addresses) + host
 * listening sockets. Server-only: node:fs and dockerode must never reach
 * src/lib/client.ts (see the import-free-leaf comment at the top of
 * network-types.ts).
 *
 * getNetworkSnapshot() must never throw: every read is individually guarded
 * and degrades to an honest null/empty value plus a `warnings` entry rather
 * than failing the whole scan — same contract as getSmartSnapshot().
 */

// --- small shared helpers ----------------------------------------------------

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readIntFile(filePath: string): Promise<number | null> {
  const raw = await readTextFile(filePath);
  if (raw === null) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Basename of a symlink's target, e.g. `${HOST_SYS}/class/net/enp4s0/master` -> "bond0". */
async function readSymlinkBasename(linkPath: string): Promise<string | null> {
  try {
    const target = await fsp.readlink(linkPath);
    return path.basename(target);
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- /proc/net/dev (interface byte/packet/error counters) -------------------

interface NetDevFullCounters {
  rxBytes: number;
  rxPackets: number;
  rxErrors: number;
  rxDropped: number;
  txBytes: number;
  txPackets: number;
  txErrors: number;
  txDropped: number;
}

/**
 * Shared column layout with host-metrics.ts's parseNetDevSamples: after
 * "iface:", receive is 8 columns (bytes packets errs drop fifo frame
 * compressed multicast, indices 0-7), then transmit is 8 more (bytes packets
 * errs drop fifo colls carrier compressed, indices 8-15). Receive bytes/
 * packets/errs/drop are cols 0-3; transmit bytes/packets/errs/drop are cols
 * 8-11 (the first four transmit columns).
 */
function parseNetDevFull(content: string): Map<string, NetDevFullCounters> {
  const lines = content.split("\n").slice(2); // first two lines are headers
  const out = new Map<string, NetDevFullCounters>();
  for (const line of lines) {
    const [ifacePart, rest] = line.split(":");
    if (!rest) continue;
    const iface = ifacePart.trim();
    const cols = rest.trim().split(/\s+/);
    out.set(iface, {
      rxBytes: Number(cols[0]) || 0,
      rxPackets: Number(cols[1]) || 0,
      rxErrors: Number(cols[2]) || 0,
      rxDropped: Number(cols[3]) || 0,
      txBytes: Number(cols[8]) || 0,
      txPackets: Number(cols[9]) || 0,
      txErrors: Number(cols[10]) || 0,
      txDropped: Number(cols[11]) || 0,
    });
  }
  return out;
}

async function readNetDevFull(): Promise<Map<string, NetDevFullCounters> | null> {
  // Reads PID 1's net/dev, not the top-level HOST_PROC/net/dev: /proc/net is
  // network-namespace scoped, so even through the /host/proc bind mount the
  // top-level path resolves to the READER's (container's) own namespace.
  // PID 1's /net/dev resolves to the host init process's namespace, i.e. the
  // host's — same reasoning getHostNetCounters in host-metrics.ts documents.
  const content = await readTextFile(`${HOST_PROC}/1/net/dev`);
  if (content === null) return null;
  return parseNetDevFull(content);
}

/**
 * Cheap synchronous hot path for the 1Hz telemetry loop: raw cumulative rx/tx
 * bytes keyed by interface name, no role classification, no docker calls, no
 * rate math (the caller diffs two calls itself, same contract as
 * getHostNetCounters). Returns null (not {}) when the file is unreadable so
 * the caller can distinguish "unavailable" from "no interfaces".
 */
export function getInterfaceCounters(): Record<string, { rxBytes: number; txBytes: number }> | null {
  try {
    const content = fs.readFileSync(`${HOST_PROC}/1/net/dev`, "utf8");
    const lines = content.split("\n").slice(2);
    const out: Record<string, { rxBytes: number; txBytes: number }> = {};
    for (const line of lines) {
      const [ifacePart, rest] = line.split(":");
      if (!rest) continue;
      const iface = ifacePart.trim();
      const cols = rest.trim().split(/\s+/);
      const rxBytes = Number(cols[0]);
      const txBytes = Number(cols[8]);
      if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
      out[iface] = { rxBytes, txBytes };
    }
    return out;
  } catch {
    return null;
  }
}

// --- IPv6: /proc/net/if_inet6 (interface addresses) --------------------------

/**
 * Formats a 32-hex-char address (already in correct network byte order — see
 * decodeIfInet6Hex vs decodeSocketTableIPv6Hex below, they are NOT the same
 * transform) into canonical IPv6 notation, collapsing the single longest run
 * of two-or-more all-zero groups into "::". This naturally produces "::" for
 * an all-zero address and "::1" for the loopback address — no special-casing
 * needed, the general algorithm already gets both right.
 */
function formatIPv6(bytesHex32: string): string {
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    const g = bytesHex32.slice(i, i + 4).replace(/^0+(?=.)/, "");
    groups.push(g.length ? g : "0");
  }
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

/**
 * /proc/net/if_inet6 addresses are printed via the kernel's %pi6 format,
 * which writes the in6_addr's 16 bytes in straight network (big-endian)
 * order — unlike /proc/net/tcp6's address column, which prints 4 __be32
 * words as native-endian ints and so needs a per-word byte swap (see
 * decodeSocketTableIPv6Hex). Getting this distinction wrong silently
 * produces a plausible-looking but wrong address, so it's kept as two
 * separate functions rather than one "IPv6 decoder" to avoid the two paths
 * ever being accidentally unified.
 */
function decodeIfInet6Hex(hex: string): string | null {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return formatIPv6(hex.toLowerCase());
}

/** ifname -> global-scope IPv6 addresses with prefix length, e.g. "2001:db8::1/64". */
async function readIfInet6GlobalAddresses(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const content = await readTextFile(`${HOST_PROC}/1/net/if_inet6`);
  if (content === null) return map;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    // addr devno prefixlen scope flags devname
    if (cols.length < 6) continue;
    const [addrHex, , prefixHex, scopeHex, , devName] = cols;
    // Scope is hex-encoded too: 00 = global. Link-local (20), site (40) and
    // host/loopback (10) are deliberately excluded — a link-local fe80::
    // address is not a meaningful "what is this box reachable at" answer.
    if (scopeHex.toLowerCase() !== "00") continue;
    const addr = decodeIfInet6Hex(addrHex);
    if (!addr) continue;
    const prefixLen = parseInt(prefixHex, 16);
    const entry = `${addr}/${Number.isFinite(prefixLen) ? prefixLen : 64}`;
    const arr = map.get(devName) ?? [];
    arr.push(entry);
    map.set(devName, arr);
  }
  return map;
}

// --- IPv4 default route (role-classification signal only) -------------------

/**
 * Which interface owns the kernel's default IPv4 route, read from
 * /proc/net/route (Destination 00000000). Used only as a role-classification
 * signal ("this interface carries traffic to the outside world, so it must
 * have a usable IPv4 address") — NOT as a source for the actual address. See
 * the long comment on the `addresses` field below for why deriving the real
 * IPv4 address from route+arp was tried and abandoned.
 */
async function readDefaultRouteIface(): Promise<string | null> {
  const content = await readTextFile(`${HOST_PROC}/1/net/route`);
  if (content === null) return null;
  const lines = content.split("\n").slice(1); // header line
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    if (cols[1] === "00000000") return cols[0];
  }
  return null;
}

// --- docker network labels + bridge gateway addresses ------------------------

interface DockerNetInfo {
  /** first-12-hex-of-network-id -> docker network name. */
  idToName: Map<string, string>;
  /** kernel bridge ifname (docker0 or br-XXXXXXXXXXXX) -> gateway "ip/prefix". */
  bridgeAddress: Map<string, string>;
}

/**
 * The docker daemon's own network list is the only honest source for both
 * the bridge's human label and its IPv4 address: the bridge interface's own
 * address IS the network's IPAM gateway, so this is confident data, not a
 * guess — unlike the route+arp attempt for physical interfaces below.
 */
async function readDockerNetInfo(warnings: string[]): Promise<DockerNetInfo> {
  const idToName = new Map<string, string>();
  const bridgeAddress = new Map<string, string>();
  try {
    const nets = await docker.listNetworks();
    for (const n of nets) {
      const shortId = n.Id.slice(0, 12);
      idToName.set(shortId, n.Name);
      const cfg = n.IPAM?.Config?.[0];
      if (!cfg?.Gateway || !cfg?.Subnet) continue;
      const prefix = cfg.Subnet.split("/")[1];
      if (!prefix) continue;
      const ifname = n.Name === "bridge" ? "docker0" : `br-${shortId}`;
      bridgeAddress.set(ifname, `${cfg.Gateway}/${prefix}`);
    }
  } catch (err) {
    warnings.push(`could not list docker networks: ${errMsg(err)}`);
  }
  return { idToName, bridgeAddress };
}

// --- interface role classification + assembly --------------------------------

const DOCKER_BRIDGE_RE = /^br-[0-9a-f]{12}$/;

interface RoleContext {
  ipv6ByIface: Map<string, string[]>;
  defaultRouteIface: string | null;
}

function classifyRole(
  name: string,
  state: LinkState,
  masterName: string | null,
  masterIsBond: boolean,
  isBondItself: boolean,
  ctx: RoleContext,
): InterfaceRole {
  if (name === "lo") return "loopback";
  if (name.startsWith("veth")) return "virtual-link";
  if (name === "docker0" || DOCKER_BRIDGE_RE.test(name)) return "docker-bridge";
  if (masterName && masterIsBond) return "bond-slave";
  // "non-link-local global address" is approximated by: this interface owns
  // a global-scope IPv6 address, or the kernel's default IPv4 route runs
  // through it — either is a confident signal the interface reaches outside
  // this box, without needing the actual IPv4 address (which cannot be
  // determined honestly — see readDefaultRouteIface's comment).
  const hasGlobalAddress = ctx.ipv6ByIface.has(name) || ctx.defaultRouteIface === name;
  if (isBondItself || (state === "up" && hasGlobalAddress)) return "uplink";
  return "other";
}

const ROLE_SORT_ORDER: Record<InterfaceRole, number> = {
  uplink: 0,
  "bond-slave": 1,
  "docker-bridge": 2,
  "virtual-link": 3,
  loopback: 4,
  other: 5,
};

interface BuildContext {
  devCounters: Map<string, NetDevFullCounters> | null;
  ipv6ByIface: Map<string, string[]>;
  defaultRouteIface: string | null;
  dockerNet: DockerNetInfo;
}

async function buildInterface(name: string, ctx: BuildContext): Promise<NetInterface> {
  const base = `${HOST_SYS}/class/net/${name}`;

  const operstateRaw = (await readTextFile(`${base}/operstate`))?.trim();
  const state: LinkState = operstateRaw === "up" ? "up" : operstateRaw === "down" ? "down" : "unknown";
  const mtu = await readIntFile(`${base}/mtu`);
  const mac = (await readTextFile(`${base}/address`))?.trim() || null;

  const masterName = await readSymlinkBasename(`${base}/master`);
  const isBondItself = await pathExists(`${base}/bonding`);
  const masterIsBond = masterName ? await pathExists(`${HOST_SYS}/class/net/${masterName}/bonding`) : false;

  const role = classifyRole(name, state, masterName, masterIsBond, isBondItself, {
    ipv6ByIface: ctx.ipv6ByIface,
    defaultRouteIface: ctx.defaultRouteIface,
  });

  // Only physical roles get a speed reading — sysfs happily reports a
  // (meaningless) speed for a bridge or veth, and a capacity gauge scaled to
  // that would render nonsense.
  let speedMbps: number | null = null;
  if (role === "uplink" || role === "bond-slave") {
    const raw = await readIntFile(`${base}/speed`);
    speedMbps = raw !== null && Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  let members: string[] = [];
  if (isBondItself) {
    const slaves = (await readTextFile(`${base}/bonding/slaves`))?.trim();
    members = slaves ? slaves.split(/\s+/) : [];
  } else if (role === "docker-bridge") {
    try {
      members = await fsp.readdir(`${base}/brif`);
    } catch {
      members = [];
    }
  }

  let label: string | null = null;
  if (role === "docker-bridge") {
    if (name === "docker0") {
      for (const nm of ctx.dockerNet.idToName.values()) {
        if (nm === "bridge") {
          label = nm;
          break;
        }
      }
    } else {
      const m = name.match(DOCKER_BRIDGE_RE);
      if (m) label = ctx.dockerNet.idToName.get(name.slice(3)) ?? null;
    }
  }

  const addresses: string[] = [...(ctx.ipv6ByIface.get(name) ?? [])];
  const bridgeAddr = ctx.dockerNet.bridgeAddress.get(name);
  if (bridgeAddr) addresses.push(bridgeAddr);
  // IPv4 for uplink/bond-slave interfaces is deliberately left empty: there
  // is no `ip` binary in the container, and /proc/net/arp's rows are OTHER
  // hosts' addresses keyed by the local device they were learned on, not
  // this interface's own address — using one would be a fabrication, not a
  // reading. Rather than guess, this stays honestly empty for those roles.

  const counters = ctx.devCounters?.get(name) ?? null;

  return {
    name,
    role,
    state,
    label,
    addresses,
    mac,
    mtu,
    speedMbps,
    members,
    master: masterName,
    rxBytes: counters?.rxBytes ?? 0,
    txBytes: counters?.txBytes ?? 0,
    rxPackets: counters?.rxPackets ?? 0,
    txPackets: counters?.txPackets ?? 0,
    rxErrors: counters?.rxErrors ?? 0,
    txErrors: counters?.txErrors ?? 0,
    rxDropped: counters?.rxDropped ?? 0,
    txDropped: counters?.txDropped ?? 0,
  };
}

// --- listening sockets: /proc/net/{tcp,tcp6,udp,udp6} ------------------------

const TCP_LISTEN = "0A";
const UDP_UNCONNECTED = "07";

/**
 * /proc/net/tcp6 and udp6 print each __be32 word of the address as a
 * native-endian integer, which on this (little-endian) host byte-swaps each
 * 4-byte word relative to network order — the opposite transform from
 * if_inet6's %pi6-formatted addresses (see decodeIfInet6Hex above). Getting
 * this backwards silently produces a different-but-plausible address.
 */
function decodeSocketTableIPv6Hex(hex: string): string {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return hex; // doesn't decode cleanly — emit raw hex, never drop the row
  let networkOrder = "";
  for (let w = 0; w < 4; w++) {
    const word = hex.slice(w * 8, w * 8 + 8);
    for (let i = 6; i >= 0; i -= 2) networkOrder += word.slice(i, i + 2);
  }
  return formatIPv6(networkOrder.toLowerCase());
}

/** "0100007F" (4 bytes, little-endian) -> "127.0.0.1". */
function decodeSocketTableIPv4Hex(hex: string): string | null {
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const bytes: number[] = [];
  for (let i = 6; i >= 0; i -= 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes.join(".");
}

function classifyScope(address: string): SocketScope {
  if (address === "0.0.0.0" || address === "::") return "all-interfaces";
  if (address === "127.0.0.1" || address.startsWith("127.") || address === "::1") return "loopback";
  return "specific";
}

interface RawSocketRow {
  protocol: SocketProtocol;
  family: "v4" | "v6";
  address: string;
  port: number;
  uid: number;
}

/**
 * Parses one /proc/net/{tcp,tcp6,udp,udp6}-style table. Columns (whitespace-
 * separated, header line skipped): sl local_address rem_address st
 * tx_queue:rx_queue tr:tm->when retrnsmt uid timeout inode ... — tx_queue and
 * rx_queue are ':'-joined into ONE whitespace column, likewise tr/tm->when,
 * which is why uid lands at index 7, not further right.
 */
async function parseSocketTable(
  filePath: string,
  protocol: SocketProtocol,
  family: "v4" | "v6",
): Promise<RawSocketRow[] | null> {
  const content = await readTextFile(filePath);
  if (content === null) return null;
  const out: RawSocketRow[] = [];
  for (const line of content.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8) continue;
    const [localAddr, remAddr, st] = [cols[1], cols[2], cols[3]];
    const uidStr = cols[7];
    const [localHex, localPortHex] = localAddr.split(":");
    if (!localHex || !localPortHex) continue;

    if (protocol === "tcp") {
      if (st !== TCP_LISTEN) continue;
    } else {
      if (st !== UDP_UNCONNECTED) continue;
      const remHex = remAddr.split(":")[0];
      if (!remHex || !/^0+$/.test(remHex)) continue; // must be bound-and-unconnected, not a peer
    }

    const port = parseInt(localPortHex, 16);
    if (!Number.isFinite(port)) continue;

    const address =
      family === "v4" ? (decodeSocketTableIPv4Hex(localHex) ?? localHex) : decodeSocketTableIPv6Hex(localHex);
    const uid = Number(uidStr);

    out.push({ protocol, family, address, port, uid: Number.isFinite(uid) ? uid : -1 });
  }
  return out;
}

/** uid -> username, from `${HOST_ROOTFS}/etc/passwd` ("name:x:uid:..."). */
async function readUidToUser(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const content = await readTextFile(`${HOST_ROOTFS}/etc/passwd`);
  if (content === null) return map;
  for (const line of content.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 3) continue;
    const uid = Number(parts[2]);
    if (Number.isFinite(uid) && !map.has(uid)) map.set(uid, parts[0]);
  }
  return map;
}

const SOCKET_SCOPE_RANK: Record<SocketScope, number> = { "all-interfaces": 2, specific: 1, loopback: 0 };

async function buildListeningSockets(warnings: string[]): Promise<ListeningSocket[]> {
  const files: { path: string; protocol: SocketProtocol; family: "v4" | "v6" }[] = [
    { path: `${HOST_PROC}/1/net/tcp`, protocol: "tcp", family: "v4" },
    { path: `${HOST_PROC}/1/net/tcp6`, protocol: "tcp", family: "v6" },
    { path: `${HOST_PROC}/1/net/udp`, protocol: "udp", family: "v4" },
    { path: `${HOST_PROC}/1/net/udp6`, protocol: "udp", family: "v6" },
  ];

  const allRows: RawSocketRow[] = [];
  for (const f of files) {
    const rows = await parseSocketTable(f.path, f.protocol, f.family);
    if (rows === null) {
      warnings.push(`could not read ${f.protocol}${f.family === "v6" ? "6" : ""} socket table`);
      continue;
    }
    allRows.push(...rows);
  }

  // Owner attribution, source 1: docker's published port bindings. Reuses
  // listContainers()'s already-deduped `ports` (private/public/type) rather
  // than a second docker call — `public` is the host-bound port these
  // /proc tables report.
  const portOwner = new Map<string, { container: string; containerPort: number }>();
  try {
    const containers = await listContainers();
    for (const c of containers) {
      for (const p of c.ports) {
        if (p.public === null) continue;
        portOwner.set(`${p.type}:${p.public}`, { container: c.name, containerPort: p.private });
      }
    }
  } catch (err) {
    warnings.push(`could not list docker containers for port attribution: ${errMsg(err)}`);
  }

  // Owner attribution, source 2: host uid -> username, for anything docker
  // didn't claim. If source 1 failed entirely, every socket falls through to
  // this path — the docker warning above already covers that degradation.
  const uidToUser = await readUidToUser();

  const groups = new Map<
    string,
    { protocol: SocketProtocol; port: number; addresses: Set<string>; families: Set<"v4" | "v6">; scopes: Set<SocketScope>; uid: number }
  >();
  for (const row of allRows) {
    const key = `${row.protocol}:${row.port}`;
    const g = groups.get(key) ?? {
      protocol: row.protocol,
      port: row.port,
      addresses: new Set<string>(),
      families: new Set<"v4" | "v6">(),
      scopes: new Set<SocketScope>(),
      uid: row.uid,
    };
    g.addresses.add(row.address);
    g.families.add(row.family);
    g.scopes.add(classifyScope(row.address));
    groups.set(key, g);
  }

  const sockets: ListeningSocket[] = [];
  for (const g of groups.values()) {
    let widest: SocketScope = "loopback";
    for (const s of g.scopes) if (SOCKET_SCOPE_RANK[s] > SOCKET_SCOPE_RANK[widest]) widest = s;

    const bound = portOwner.get(`${g.protocol}:${g.port}`);
    const owner: SocketOwner | null = bound
      ? { kind: "container", container: bound.container, containerPort: bound.containerPort }
      : g.uid >= 0
        ? { kind: "host", uid: g.uid, user: uidToUser.get(g.uid) ?? null }
        : null;

    sockets.push({
      protocol: g.protocol,
      port: g.port,
      addresses: [...g.addresses],
      scope: widest,
      families: [...g.families],
      owner,
    });
  }

  sockets.sort((a, b) => {
    const rank = (s: SocketScope) => (s === "all-interfaces" ? 0 : s === "specific" ? 1 : 2);
    return rank(a.scope) - rank(b.scope) || a.port - b.port;
  });

  return sockets;
}

// --- main ---------------------------------------------------------------

export async function getNetworkSnapshot(): Promise<NetworkSnapshot> {
  const ts = Date.now();
  const warnings: string[] = [];

  try {
    let names: string[];
    try {
      const entries = await fsp.readdir(`${HOST_SYS}/class/net`);
      // /sys/class/net entries are normally symlinks to a device directory,
      // but `bonding_masters` is a plain control file (not a real interface)
      // that appears here whenever the bonding module is loaded — verified
      // live on this host. Left in, it would report as a garbage "other"-
      // role interface with every field null. stat() follows the symlink,
      // so this only excludes stray flat files, never a real device.
      names = [];
      for (const name of entries) {
        try {
          const stat = await fsp.stat(`${HOST_SYS}/class/net/${name}`);
          if (stat.isDirectory()) names.push(name);
        } catch {
          // unreadable entry — skip rather than fail the whole listing
        }
      }
    } catch (err) {
      warnings.push(`could not list network interfaces: ${errMsg(err)}`);
      return { ts, interfaces: [], sockets: [], warnings };
    }

    const devCounters = await readNetDevFull();
    if (devCounters === null) warnings.push("could not read interface counters (/proc/1/net/dev)");

    const [ipv6ByIface, defaultRouteIface, dockerNet] = await Promise.all([
      readIfInet6GlobalAddresses(),
      readDefaultRouteIface(),
      readDockerNetInfo(warnings),
    ]);

    const ctx: BuildContext = { devCounters, ipv6ByIface, defaultRouteIface, dockerNet };
    const interfaces = await Promise.all(names.map((name) => buildInterface(name, ctx)));
    interfaces.sort((a, b) => ROLE_SORT_ORDER[a.role] - ROLE_SORT_ORDER[b.role] || a.name.localeCompare(b.name));

    const sockets = await buildListeningSockets(warnings);

    return { ts, interfaces, sockets, warnings };
  } catch (err) {
    // Belt-and-braces: getNetworkSnapshot must never throw. Anything that
    // reaches here is a bug in a source above, not an expected failure mode.
    return { ts, interfaces: [], sockets: [], warnings: [...warnings, errMsg(err)] };
  }
}
