import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactCmdline, redactLogText } from "./redact.ts";

describe("redactCmdline", () => {
  const cases: [string, string][] = [
    ["app --password=hunter2 --x", "app --password=*** --x"],
    ["app --api-key abc123 run", "app --api-key *** run"],
    ["app --Token=t --db-pass p", "app --Token=*** --db-pass ***"],
    ["app --secret s --apikey k --api_key j", "app --secret *** --apikey *** --api_key ***"],
    ["app --auth-header Bearer x", "app --auth-header *** x"],
    ["mysql -uroot -psecret db", "mysql -uroot -p*** db"],
    ["psql postgres://bob:pw@db:5432/x", "psql postgres://bob:***@db:5432/x"],
    ["env DB_PASSWORD=abc API_TOKEN=def PATH=/bin", "env DB_PASSWORD=*** API_TOKEN=*** PATH=/bin"],
    ["nginx -g daemon off;", "nginx -g daemon off;"],
    ["node server.js -p 8080", "node server.js -p 8080"],
    ["mysqladmin ping -psecret", "mysqladmin ping -p***"],
    ["sh -c mariadb-dump -psecret db", "sh -c mariadb-dump -p*** db"],
    ["ffmpeg -preset veryfast -pix_fmt yuv420p -profile:v high", "ffmpeg -preset veryfast -pix_fmt yuv420p -profile:v high"],
    ["find / -perm 644", "find / -perm 644"],
    ["nginx -pidfile=x", "nginx -pidfile=x"],
    ["curl -u bob:secret http://x", "curl -u bob:*** http://x"],
    ["curl --user bob:secret http://x", "curl --user bob:*** http://x"],
    ["curl -H Authorization: Bearer abc http://x", "curl -H Authorization: Bearer *** http://x"],
    ["curl -H authorization: basic abc http://x", "curl -H authorization: basic *** http://x"],
    ["redis-cli -h db -a secret ping", "redis-cli -h db -a *** ping"],
    ["sshpass -p secret ssh host", "sshpass -p *** ssh host"],
    ["sshpass -p secret ssh -p 2222 host", "sshpass -p *** ssh -p 2222 host"],
    ["sshpass -p a ssh x; sshpass -p b ssh y", "sshpass -p *** ssh x; sshpass -p *** ssh y"],
    ["curl --user-agent=Foo:bar http://x", "curl --user-agent=Foo:bar http://x"],
    ["curl --user-agent Foo:bar http://x", "curl --user-agent Foo:bar http://x"],
    ["curl -u admin:secret http://x", "curl -u admin:*** http://x"],
    ["curl -uadmin:secret http://x", "curl -uadmin:*** http://x"],
    ["curl --user=admin:secret http://x", "curl --user=admin:*** http://x"],
    ["curl --user admin:secret http://x", "curl --user admin:*** http://x"],
    ["git log --author=bob", "git log --author=bob"],
    ["mosquitto --auth-mode none", "mosquitto --auth-mode none"],
    ["app --auth-token=x --auth=y --authkey z --auth_key w", "app --auth-token=*** --auth=*** --authkey *** --auth_key ***"],
    ["app --authorization=secret", "app --authorization=***"],
    ["curl -uadmin:secret http://x", "curl -uadmin:*** http://x"],
    ["curl --user=admin:secret http://x", "curl --user=admin:*** http://x"],
    ["wget --user=admin:secret http://x", "wget --user=admin:secret http://x"],
    ["curl -H Authorization: token abc http://x", "curl -H Authorization: token *** http://x"],
    ["curl -H X-Api-Key: abc123 http://x", "curl -H X-Api-Key: *** http://x"],
    ["curl -H x-auth-token: t http://x", "curl -H x-auth-token: *** http://x"],
    ["sshpass -p secret ssh -p 2222 host", "sshpass -p *** ssh -p 2222 host"],
  ];
  for (const [input, want] of cases) {
    it(input, () => assert.equal(redactCmdline(input), want));
  }
});

describe("redactLogText", () => {
  const log = [
    "token=abc",
    '{"password":"p"}',
    "Authorization: Bearer abc",
    "Bearer abc",
    "api_key=abc",
    "password: hunter2",
    '"api_key": "k"',
    "GET /health 200 3ms",
  ].join("\n");
  it("masks every secret value, line by line", () => {
    const out = redactLogText(log);
    for (const v of ["=abc", '"p"', "Bearer abc", "hunter2", '"k"']) assert.ok(!out.includes(v), v);
    assert.ok(out.includes("GET /health 200 3ms"));
    assert.equal(out.split("\n").length, 8);
  });
});

describe("redactLogText hunt 10 review", () => {
  it("masks a quoted secret that holds a space", () => {
    const out = redactLogText('POSTGRES_PASSWORD="s3cret pw"');
    assert.ok(!out.includes("s3cret") && !out.includes("pw"), out);
  });
  it("still masks --password=x command lines", () => {
    assert.ok(!redactLogText("app --password=hunter2 --x").includes("hunter2"));
  });
  it("masks a JSON value with an escaped quote", () => {
    const out = redactLogText('{"password":"a\\"b c"}');
    assert.ok(!out.includes("b c") && !out.includes("a\\"), out);
  });
  it("masks a Ruby-style password => x", () => {
    assert.ok(!redactLogText("password => hunter2").includes("hunter2"));
  });
});
