import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyScope, decodeSocketTableIPv4Hex, isLoopbackAddress, unmapSocketHex } from "./socket-addr.ts";

// /proc/net/tcp6 prints each __be32 word native-endian: ::ffff:127.0.0.1
const MAPPED_LOOPBACK = "0000000000000000FFFF00000100007F";
const MAPPED_LAN = "0000000000000000FFFF00000501A8C0"; // ::ffff:192.168.1.5
const MAPPED_ANY = "0000000000000000FFFF000000000000"; // ::ffff:0.0.0.0
const V6_LOOPBACK = "00000000000000000000000001000000"; // ::1
const V6_ULA = "000080FD000000000000000001000000"; // fd80::1 (word-swapped)

describe("unmapSocketHex", () => {
  it("decodes a mapped loopback to dotted v4", () => {
    assert.equal(unmapSocketHex(MAPPED_LOOPBACK), "127.0.0.1");
    assert.equal(isLoopbackAddress("127.0.0.1", "v4"), true);
  });
  it("a LAN peer on tcp and tcp6 gets the same group key address", () => {
    assert.equal(unmapSocketHex(MAPPED_LAN), decodeSocketTableIPv4Hex("0501A8C0"));
    assert.equal(unmapSocketHex(MAPPED_LAN), "192.168.1.5");
  });
  it("a listener on mapped loopback has scope loopback; mapped any is all-interfaces", () => {
    assert.equal(classifyScope(unmapSocketHex(MAPPED_LOOPBACK)!), "loopback");
    assert.equal(classifyScope(unmapSocketHex(MAPPED_ANY)!), "all-interfaces");
  });
  it("leaves ::1, ULA and junk alone", () => {
    assert.equal(unmapSocketHex(V6_LOOPBACK), null);
    assert.equal(unmapSocketHex(V6_ULA), null);
    assert.equal(unmapSocketHex("xyz"), null);
    assert.equal(isLoopbackAddress("::1", "v6"), true);
  });
});
