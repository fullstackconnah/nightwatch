import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { JOB_ID_RE } from "./hermes-job-map.ts";
import { redactLogText, tailLogBytes } from "./redact.ts";

const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const HERMES = "src/lib/hermes-ctl.ts";

describe("hunt 61: redactLogText additions", () => {
  const masked: [string, string][] = [
    ["access_key=AKIA1234", "AKIA1234"],
    ["private-key: abcd1234", "abcd1234"],
    ["apikey=zzz999", "zzz999"],
    ["KEY=topsecret1", "topsecret1"],
    ["aws_credentials=xyz789", "xyz789"],
    ["session_id=sess123", "sess123"],
    ["SENTRY_DSN=https://abc@o1.ingest.sentry.io/1", "abc@o1"],
    ["authorization=Basic-abc", "Basic-abc"],
    ["Set-Cookie: sid=abc123; Path=/; HttpOnly", "abc123"],
    ["Cookie: a=1; b=secretval", "secretval"],
    ["got eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk ok", "eyJhbGci"],
    ["tok ghp_abcdefghijklmnopqrstuvwxyz0123456789 end", "ghp_abc"],
    ["tok github_pat_11ABCDEFG0abcdefghijklmnop end", "github_pat_11"],
    ["x ghs_abcdefghijklmnopqrstu y", "ghs_abc"],
  ];
  for (const [line, secret] of masked) {
    it(`masks ${line.slice(0, 30)}`, () => assert.ok(!redactLogText(line).includes(secret), redactLogText(line)));
  }
  for (const line of ["keyboard=us", "keyspace=x", "monkeys=3"]) {
    it(`leaves ${line}`, () => assert.equal(redactLogText(line), line));
  }
  it("keeps existing output format", () => {
    assert.equal(redactLogText("password: hunter2"), "password: ***");
    assert.equal(redactLogText("GET /health 200 3ms"), "GET /health 200 3ms");
  });
  it("handles a 1 MB line fast", () => {
    // "a-a-" once made the scheme scan in URL_PASS quadratic.
    for (const line of ["a".repeat(1 << 20), "eyJ" + "a".repeat(1 << 20), "a-".repeat(1 << 16)]) {
      const t = performance.now();
      redactLogText(line);
      assert.ok(performance.now() - t < 500);
    }
  });
});

describe("hunt 61: tailLogBytes", () => {
  it("returns short text unchanged", () => assert.equal(tailLogBytes("a\nb", 10), "a\nb"));
  it("keeps the tail from a line start and marks the drop", () => {
    const out = tailLogBytes("aaaa\nbbbb\ncccc", 8);
    assert.equal(out, "[earlier output dropped]\ncccc");
  });
  it("caps a big text", () => {
    const out = tailLogBytes("line\n".repeat(200000));
    assert.ok(Buffer.byteLength(out) < 262144 + 100);
    assert.ok(out.startsWith("[earlier output dropped]\n"));
  });
});

describe("hunt 61: hermes job id", () => {
  it("accepts ids and rejects traversal", () => {
    for (const ok of ["job-1", "abc_DEF-123", "a".repeat(64)]) assert.ok(JOB_ID_RE.test(ok), ok);
    for (const bad of ["..", ".", "a/b", "", "a".repeat(65), "a b", "a.b"]) assert.ok(!JOB_ID_RE.test(bad), bad);
  });
  it("the jobs route rejects before any outbound call", () => {
    const s = src("src/app/api/hermes-ctl/jobs/[id]/route.ts");
    assert.ok(s.indexOf("JOB_ID_RE.test(id)") > 0);
    assert.ok(s.indexOf("JOB_ID_RE.test(id)") < s.indexOf("getHermesJob(id)"));
    assert.match(s, /status: 400/);
  });
});

describe("hunt 61: source guards", () => {
  it("run route maps unauthorized to 502, never 401", () => {
    const s = src("src/app/api/hermes-ctl/run/route.ts");
    assert.match(s, /case "unauthorized":\s*return 502/);
    assert.ok(!s.includes("return 401"));
  });
  for (const [file, cap] of [
    ["src/app/api/mcp/route.ts", "256 * 1024"],
    ["src/app/api/voice/speak/route.ts", "64 * 1024"],
    ["src/app/api/hermes-ctl/run/route.ts", "64 * 1024"],
  ] as const) {
    it(`${file} caps the body before req.json()`, () => {
      const s = src(file);
      assert.ok(s.includes(cap), cap);
      const a = s.indexOf("contentLengthError(");
      assert.ok(a > 0 && a < s.indexOf("req.json()"));
    });
  }
  it("mcp route keeps its JSON-RPC error shape for an oversized body", () => {
    const s = src("src/app/api/mcp/route.ts");
    assert.ok(s.indexOf("contentLengthError(") > s.indexOf("isAuthorized("));
    assert.match(s, /INVALID_REQUEST[\s\S]*tooBig\.detail|tooBig\.detail[\s\S]*INVALID_REQUEST/);
  });
  it("run has its own 15 s timeout, status reads keep 5 s", () => {
    const s = src(HERMES);
    assert.match(s, /const RUN_TIMEOUT_MS = 15000/);
    assert.match(s, /const TIMEOUT_MS = 5000/);
    assert.match(s, /hermesFetch\(creds, "\/run", \{[\s\S]*?\}, RUN_TIMEOUT_MS\)/);
  });
  it("the non-202 error body is read with readCapped", () => {
    const s = src(HERMES);
    assert.match(s, /readCapped\(res, 500\)/);
    assert.ok(!s.includes("await res.text()"));
  });
  it("MCP logs are byte-capped before redaction", () => {
    const s = src("src/lib/mcp/resources.ts");
    assert.match(s, /redactLogText\(tailLogBytes\(/);
  });
});
