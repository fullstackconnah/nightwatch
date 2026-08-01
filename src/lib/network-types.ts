/**
 * Wire contract for the network monitor: interface inventory, per-interface
 * throughput and host listening sockets.
 *
 * Deliberately import-free, for the same reason telemetry-types.ts is: this file
 * is reachable from `src/lib/client.ts` ("use client"), so anything imported here
 * lands in the browser bundle — and the producer side reaches `node:fs` and
 * dockerode. Keep this a leaf.
 */

/**
 * What an interface *is*, which decides whether its bytes may be added to any
 * other interface's bytes. This is the whole reason the type exists: a naive sum
 * over /proc/net/dev double- or triple-counts every packet on this host, because
 * one download crosses the uplink, its bond, the docker bridge and a veth, and
 * shows up in all four counters.
 *
 * - `uplink`      — carries traffic to the outside world. The only role that counts
 *                   toward "what is this box doing on the network".
 * - `bond-slave`  — a physical NIC enslaved to a bond. Its bytes are the *same*
 *                   packets the bond already reported; show it, never add it.
 * - `docker-bridge` — docker0 or a br-<netid> bridge. Container-to-container and
 *                   container-to-host traffic, plus the container side of anything
 *                   that also crossed the uplink.
 * - `virtual-link` — a veth: one container's end of a bridge. Names are ephemeral
 *                   (regenerated on every container recreate) and carry no meaning.
 * - `loopback`    — lo. Traffic the box sent to itself.
 * - `other`       — anything unrecognised. Displayed, never silently bucketed.
 */
export type InterfaceRole =
  | "uplink"
  | "bond-slave"
  | "docker-bridge"
  | "virtual-link"
  | "loopback"
  | "other";

/** Kernel operational state, verbatim from /sys/class/net/<if>/operstate. */
export type LinkState = "up" | "down" | "unknown";

export interface NetInterface {
  /** Kernel name: bond0, enp4s0, docker0, br-10b904353edb, veth3b2b14d, lo. */
  name: string;
  role: InterfaceRole;
  state: LinkState;
  /**
   * Human-meaningful name when one exists, else null — never a guess.
   * For a docker bridge this is the Docker network's name, resolved by matching
   * the `br-<first 12 hex of network id>` convention against the daemon's network
   * list, so `br-10b904353edb` renders as `homelab_homelab`. Null for a bridge
   * means the match failed and the raw name is all we honestly have.
   */
  label: string | null;
  /** IPv4/IPv6 addresses with prefix length, e.g. "192.168.1.70/22". */
  addresses: string[];
  mac: string | null;
  mtu: number | null;
  /**
   * Negotiated link speed in Mbit/s, or null when there is no honest answer.
   * Only physical roles (`uplink`, `bond-slave`) get a value: /sys reports 10000
   * for a veth and -1 or an error for a bridge, and a capacity gauge scaled to a
   * fabricated 10 GbE would render a busy 1 GbE link as idle. Null must render as
   * "no link rate", never as unlimited.
   */
  speedMbps: number | null;
  /** Bond slaves, for an interface whose role is `uplink` and which is a bond. */
  members: string[];
  /** The bond or bridge this interface belongs to, if any. */
  master: string | null;
  /** Cumulative since boot. Rates are derived by the telemetry loop, not here. */
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  /**
   * Cumulative error and drop counters since boot. Kept separate from bytes
   * because they answer a different question ("is this link healthy") and because
   * a nonzero drop count on a bridge is routine while one on the uplink is not.
   */
  rxErrors: number;
  txErrors: number;
  rxDropped: number;
  txDropped: number;
}

/** Which addresses a listening socket is reachable from. */
export type SocketScope =
  /** Bound to 0.0.0.0 or :: — reachable from anything that can route to this box. */
  | "all-interfaces"
  /** Bound to 127.0.0.1 or ::1 — reachable only from the host itself. */
  | "loopback"
  /** Bound to one specific address, e.g. a docker bridge gateway or the LAN IP. */
  | "specific";

/**
 * Who owns a listening port, and — just as importantly — how confidently we know.
 *
 * The host's /proc/net/{tcp,udp} tables give a uid and a socket inode but no
 * process: mapping inode → pid means reading /proc/<pid>/fd, which is 0500 and
 * unreadable as the container's uid 1000. So attribution comes from two honest
 * sources and stops there rather than guessing from a well-known-ports table.
 */
export type SocketOwner =
  /**
   * Docker publishes this host port to a container (matched on host IP + port +
   * protocol from the daemon's port bindings). Note this names the container that
   * *holds the binding*, which for a VPN-fronted stack is the network container
   * (gluetun), not the app behind it — that is the truth about the port.
   */
  | { kind: "container"; container: string; containerPort: number }
  /**
   * A host process. `user` is the uid resolved through /etc/passwd, or null when
   * the uid has no passwd entry; `uid` is always present because it is what the
   * kernel actually reported.
   */
  | { kind: "host"; uid: number; user: string | null };

export type SocketProtocol = "tcp" | "udp";

/**
 * One listening endpoint, already merged across address families. A service bound
 * to both 0.0.0.0 and :: appears twice in /proc but is one port to a human, so the
 * collector folds them into a single row and records both families here.
 */
export interface ListeningSocket {
  protocol: SocketProtocol;
  port: number;
  /** The bind addresses that produced this row, e.g. ["0.0.0.0", "::"]. */
  addresses: string[];
  /** Widest scope across the merged rows: all-interfaces beats specific beats loopback. */
  scope: SocketScope;
  /** ipv4, ipv6, or both. */
  families: ("v4" | "v6")[];
  owner: SocketOwner | null;
}

/** Threshold Rule: a single remote holding more concurrent connections than
 *  this earns a warn-coloured count. Not a security verdict — an unusually
 *  high number for what this host normally sees, named as exactly that. */
export const ESTABLISHED_WARN_THRESHOLD = 50;

/**
 * One local port an established connection group touched, with the same
 * honest attribution as a ListeningSocket's owner (docker binding, else uid,
 * else null — never a well-known-ports guess).
 */
export interface ConnectionLocalEndpoint {
  port: number;
  owner: SocketOwner | null;
}

/**
 * ESTABLISHED (state 01) TCP rows from the host's socket tables, grouped by
 * remote address — many connections from one remote collapse into one row,
 * because "how many ports is this remote using" is rarely the question;
 * "who is this remote and how much is it doing" is. Sorted by `count`
 * descending by the collector, same convention as ListeningSocket's scope sort.
 */
export interface EstablishedConnectionGroup {
  remoteAddress: string;
  family: "v4" | "v6";
  /** Total ESTABLISHED rows folded into this row. */
  count: number;
  /**
   * True when `remoteAddress` falls outside RFC1918 (IPv4 private), RFC4193
   * (IPv6 unique-local), link-local and loopback — a computed fact about the
   * address's own bits, never a geolocation or reputation claim. Threshold
   * Rule: this is the one real signal a raw address can honestly carry.
   */
  isPublic: boolean;
  /**
   * Remote is a loopback address (127.0.0.0/8 or ::1) — this box talking to
   * itself. Folded behind a disclosure by the UI, same idiom as the
   * host-only listening-port group, because a loopback pair is never
   * actionable network information.
   */
  isLoopback: boolean;
  /** Distinct local ports this remote touched, each independently attributed —
   *  a remote can legitimately hold connections to more than one local service. */
  localPorts: ConnectionLocalEndpoint[];
}

/**
 * Everything the network page needs that changes slowly enough to poll rather
 * than stream. Per-interface *rates* ride the 1Hz telemetry SSE instead.
 */
export interface NetworkSnapshot {
  ts: number;
  interfaces: NetInterface[];
  sockets: ListeningSocket[];
  connections: EstablishedConnectionGroup[];
  /**
   * False when neither the host's tcp nor tcp6 table could be read — distinct
   * from `connections` being empty, which is a real and common state ("nothing
   * established right now"). Mirrors the `sockets`/`warnings` split: an empty
   * array must never be the only signal for "we could not look".
   */
  connectionsAvailable: boolean;
  /**
   * Non-fatal degradations, phrased for display. A collector that cannot read the
   * host's socket tables returns an empty `sockets` array *and* a warning here —
   * the UI must be able to tell "nothing is listening" (never true in practice)
   * from "we could not look".
   */
  warnings: string[];
}
