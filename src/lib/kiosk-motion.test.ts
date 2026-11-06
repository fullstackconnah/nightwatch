import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { usePrefersReducedMotion } from "./kiosk-motion.ts";

function Probe() {
  return createElement("i", null, String(usePrefersReducedMotion()));
}

function stubMatchMedia(matches: boolean) {
  const w = globalThis as unknown as { window?: unknown };
  w.window = { matchMedia: () => ({ matches, addEventListener() {}, removeEventListener() {} }) };
  return () => { delete w.window; };
}

test("server render reports not-reduced even when the browser asks for reduced motion", () => {
  const restore = stubMatchMedia(true);
  try {
    assert.match(renderToString(createElement(Probe)), /false/);
  } finally {
    restore();
  }
});
