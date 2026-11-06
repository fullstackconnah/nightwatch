import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactCmdline } from "./redact.ts";

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
  ];
  for (const [input, want] of cases) {
    it(input, () => assert.equal(redactCmdline(input), want));
  }
});
