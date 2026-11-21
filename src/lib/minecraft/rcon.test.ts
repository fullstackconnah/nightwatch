import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { encodePacket, decodePackets, parsePlayerList, rconCommand } from "./rcon.ts";

describe("rcon packets", () => {
  it("round-trips a packet", () => {
    const buf = encodePacket(7, 2, "list");
    // length prefix = 4 (id) + 4 (type) + payload + 2 null terminators
    assert.equal(buf.readInt32LE(0), 4 + 4 + 4 + 2);
    const { packets, rest } = decodePackets(buf);
    assert.equal(rest.length, 0);
    assert.deepEqual(packets, [{ id: 7, type: 2, payload: "list" }]);
  });

  it("decodes two concatenated packets and keeps a partial tail", () => {
    const two = Buffer.concat([encodePacket(1, 0, "a"), encodePacket(2, 0, "b")]);
    const withTail = Buffer.concat([two, Buffer.from([9, 0])]);
    const { packets, rest } = decodePackets(withTail);
    assert.equal(packets.length, 2);
    assert.equal(packets[1].payload, "b");
    assert.equal(rest.length, 2);
  });

  it("throws on a malformed frame instead of misparsing", () => {
    const junk = Buffer.alloc(16);
    junk.writeInt32LE(-4, 0);
    assert.throws(() => decodePackets(junk), /malformed/);
    const tiny = Buffer.alloc(16);
    tiny.writeInt32LE(4, 0);
    assert.throws(() => decodePackets(tiny), /malformed/);
  });
});

describe("parsePlayerList", () => {
  it("parses the vanilla list format", () => {
    assert.deepEqual(
      parsePlayerList("There are 2 of a max of 20 players online: Alice, Bob"),
      { online: 2, max: 20, players: ["Alice", "Bob"] },
    );
  });
  it("parses an empty server", () => {
    assert.deepEqual(
      parsePlayerList("There are 0 of a max of 20 players online: "),
      { online: 0, max: 20, players: [] },
    );
  });
  it("returns null on unrecognized text", () => {
    assert.equal(parsePlayerList("Unknown command"), null);
  });
});

describe("rconCommand close handling", () => {
  // Fake RCON server: answers the login, then runs `onCommand` on the command packet.
  async function withServer(onCommand: (s: net.Socket) => void, run: (port: number) => Promise<void>) {
    const server = net.createServer((s) => {
      s.on("error", () => {});
      s.on("data", (d) => {
        const { packets } = decodePackets(d);
        for (const p of packets) {
          if (p.type === 3) s.write(encodePacket(p.id, 2, ""));
          if (p.type === 2) onCommand(s);
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      await run((server.address() as net.AddressInfo).port);
    } finally {
      server.close();
    }
  }

  it("resolves with the reply when the server closes right after replying", async () => {
    await withServer(
      (s) => s.end(encodePacket(2, 0, "Stopping the server")),
      async (port) => {
        const out = await rconCommand({ host: "127.0.0.1", port, password: "x", command: "stop" });
        assert.equal(out, "Stopping the server");
      },
    );
  });

  it("still rejects when the server closes after auth with no reply", async () => {
    await withServer(
      (s) => s.end(),
      async (port) => {
        await assert.rejects(rconCommand({ host: "127.0.0.1", port, password: "x", command: "stop" }), /rcon unreachable/);
      },
    );
  });
});
