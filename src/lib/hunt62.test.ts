import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { contentLengthError } from "./upload-limit.ts";

const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const KB = 1024;

describe("hunt 62: body caps", () => {
  it("helper at the new limits", () => {
    for (const max of [4 * KB, 64 * KB, 256 * KB]) {
      assert.equal(contentLengthError(null, max, "The request")?.status, 411);
      assert.equal(contentLengthError(String(max), max, "The request"), null);
      const big = contentLengthError(String(max + 1), max, "The request");
      assert.equal(big?.status, 413);
      assert.match(big?.detail ?? "", new RegExp(`${max / KB}KB`));
    }
  });

  const routes: [string, string][] = [
    ["src/app/kiosk/api/assistant/route.ts", "4 * 1024|MAX_BODY_BYTES"],
    ["src/app/api/settings/system/route.ts", "MAX_BODY_BYTES"],
    ["src/app/api/settings/integrations/route.ts", "MAX_BODY_BYTES"],
    ["src/app/api/settings/hermes-daemon/route.ts", "MAX_BODY_BYTES"],
    ["src/app/api/settings/password/route.ts", "MAX_BODY_BYTES"],
    ["src/app/kiosk/api/ha/action/route.ts", "MAX_BODY_BYTES"],
    ["src/app/kiosk/api/climate-auto-off/route.ts", "MAX_BODY_BYTES"],
  ];
  for (const [file] of routes) {
    it(`${file} caps the body before req.json()`, () => {
      const s = src(file);
      const cap = s.indexOf("contentLengthError(");
      assert.ok(cap > 0, "no contentLengthError call");
      const post = s.indexOf("export async function POST");
      assert.ok(cap > post, "cap must be inside POST");
      assert.ok(cap < s.indexOf("req.json()", post), "cap must come before req.json()");
    });
  }
  it("caps are 64KB, integrations 256KB, assistant 4KB", () => {
    for (const f of ["system", "hermes-daemon", "password"]) assert.match(src(`src/app/api/settings/${f}/route.ts`), /MAX_BODY_BYTES = 64 \* 1024/);
    assert.match(src("src/app/api/settings/integrations/route.ts"), /MAX_BODY_BYTES = 256 \* 1024/);
    for (const f of ["src/app/kiosk/api/ha/action/route.ts", "src/app/kiosk/api/climate-auto-off/route.ts"]) assert.match(src(f), /MAX_BODY_BYTES = 64 \* 1024/);
    assert.match(src("src/app/kiosk/api/assistant/route.ts"), /MAX_BODY_BYTES = 4096/);
  });
});

describe("hunt 62: daemon job id", () => {
  const s = src("src/lib/hermes-ctl.ts");
  it("runHermesJob validates the daemon's id with JOB_ID_RE", () => {
    assert.match(s, /import \{[^}]*JOB_ID_RE[^}]*\} from "@\/lib\/hermes-job-map"/);
    const run = s.indexOf("const jobId = str(obj(body).jobId)");
    assert.ok(run > 0);
    assert.match(s.slice(run, run + 200), /!JOB_ID_RE\.test\(jobId\)/);
  });
  it("getHermesJob refuses a bad id before building the URL", () => {
    const fn = s.indexOf("export async function getHermesJob");
    const test = s.indexOf("JOB_ID_RE.test(id)", fn);
    assert.ok(test > fn && test < s.indexOf("hermesFetch(creds, `/jobs/", fn));
  });
});
