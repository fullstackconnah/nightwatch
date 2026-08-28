import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodePacket, decodePackets, parsePlayerList } from "./rcon.ts";

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
