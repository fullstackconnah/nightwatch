import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const login = readFileSync(new URL("../app/login/login-form.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../components/side-nav.tsx", import.meta.url), "utf8");

test("login: the password and SSO error lines are role=alert", () => {
  assert.match(login, /<p role="alert" className="text-bad text-xs">\{error\}<\/p>/);
  assert.match(login, /<p role="alert" className="text-bad text-xs text-center">\{SSO_ERROR_COPY/);
});

test("login: the fetch catch shows loginUnreachable, not the raw message", () => {
  assert.match(login, /loginUnreachable\(/);
  assert.doesNotMatch(login, /err instanceof Error \? err\.message/);
});

test("side nav: all three Links carry aria-current from isActive", () => {
  assert.equal(nav.match(/aria-current=\{active \? "page" : undefined\}/g)?.length, 3);
});
