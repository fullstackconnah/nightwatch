import net from "node:net";

// Source RCON framing: [int32 LE length][int32 LE id][int32 LE type][payload][\0\0]
// type 3 = login, 2 = command, 0 = response. Login failure echoes id -1.

export function encodePacket(id: number, type: number, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const buf = Buffer.alloc(4 + 4 + 4 + body.length + 2);
  buf.writeInt32LE(4 + 4 + body.length + 2, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  body.copy(buf, 12);
  return buf;
}

export function decodePackets(buf: Buffer): {
  packets: { id: number; type: number; payload: string }[];
  rest: Buffer;
} {
  const packets: { id: number; type: number; payload: string }[] = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const length = buf.readInt32LE(offset);
    if (length < 10 || length > 1_048_576) throw new Error("rcon malformed frame");
    if (buf.length - offset - 4 < length) break;
    packets.push({
      id: buf.readInt32LE(offset + 4),
      type: buf.readInt32LE(offset + 8),
      payload: (buf.subarray(offset + 12, offset + 4 + length - 2) as Buffer).toString("utf8"),
    });
    offset += 4 + length;
  }
  return { packets, rest: buf.subarray(offset) as Buffer };
}

const LOGIN = 3;
const COMMAND = 2;

export function rconCommand(opts: {
  host: string;
  port: number;
  password: string;
  command: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: opts.host, port: opts.port });
    let pending: Buffer = Buffer.alloc(0);
    let authed = false;
    const responses: string[] = [];
    let settleTimer: NodeJS.Timeout | null = null;
    let settled = false;
    const overall = setTimeout(() => fail(new Error("rcon unreachable")), timeoutMs);

    function done(value: string) {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      if (settleTimer) clearTimeout(settleTimer);
      socket.destroy();
      resolve(value);
    }
    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      if (settleTimer) clearTimeout(settleTimer);
      socket.destroy();
      reject(err);
    }

    socket.on("error", () => fail(new Error("rcon unreachable")));
    socket.on("connect", () => socket.write(encodePacket(1, LOGIN, opts.password)));
    socket.on("data", (chunk) => {
      try {
        pending = Buffer.concat([pending, chunk]);
        const { packets, rest } = decodePackets(pending);
        pending = rest;
        for (const p of packets) {
          if (!authed) {
            if (p.type !== 2) continue;
            if (p.id === -1) return fail(new Error("rcon auth failed"));
            authed = true;
            socket.write(encodePacket(2, COMMAND, opts.command));
          } else {
            responses.push(p.payload);
            // Responses can span packets; settle 150ms after the last one.
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => done(responses.join("")), 150);
          }
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error("rcon protocol error"));
      }
    });
    socket.on("close", () => {
      if (!settled) fail(new Error("rcon unreachable"));
    });
  });
}

const LIST_RE = /There are (\d+) of a max of (\d+) players online:\s*(.*)/;

export function parsePlayerList(
  text: string,
): { online: number; max: number; players: string[] } | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const players = m[3].split(",").map((s) => s.trim()).filter(Boolean);
  return { online: Number(m[1]), max: Number(m[2]), players };
}
