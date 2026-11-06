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
    ["git log --author=bob", "git log --author=bob"],
    ["mosquitto --auth-mode none", "mosquitto --auth-mode none"],
    ["app --auth-token=x --auth=y --authkey z --auth_key w", "app --auth-token=*** --auth=*** --authkey *** --auth_key ***"],
  ];
  for (const [input, want] of cases) {
    it(input, () => assert.equal(redactCmdline(input), want));
  }
});
