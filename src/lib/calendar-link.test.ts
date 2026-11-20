import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CALENDAR_LINK, calendarLinkError, normalizeCalendarLink } from "./settings-checks.ts";

// Test links are built from words at run time: no whole link is ever written in this repo.
const link = (...parts: string[]) => parts.join("");
const GOOD = link("https://", "calendar", ".", "example", "/", "private", "-", "token", ".ics");

describe("calendarLinkError", () => {
  it("accepts a secure link, with or without a query string (the token lives there)", () => {
    assert.equal(calendarLinkError(GOOD), null);
    assert.equal(calendarLinkError(GOOD + link("?key=", "wordsonly")), null);
  });
  it("trims spaces before checking", () => {
    assert.equal(calendarLinkError(`  ${GOOD}\n`), null);
    assert.equal(normalizeCalendarLink(`  ${GOOD}  `), GOOD);
  });
  it("accepts the calendar-app scheme and rewrites it to the secure one", () => {
    const app = GOOD.replace("https:", "webcal:");
    assert.equal(calendarLinkError(app), null);
    assert.equal(normalizeCalendarLink(app), GOOD);
    assert.equal(normalizeCalendarLink(app.toUpperCase().slice(0, 7) + app.slice(7)), GOOD);
  });
  it("refuses text that is not a link", () => {
    const msg = "That isn't a link. Paste the private link from your calendar's sharing settings.";
    for (const bad of ["", "   ", "not a link", "calendar.example/x.ics", "ftp://example.test/x", "javascript:alert(1)"]) {
      assert.equal(calendarLinkError(bad), msg, JSON.stringify(bad));
    }
  });
  it("refuses the plain web scheme", () => {
    assert.equal(
      calendarLinkError(GOOD.replace("https:", "http:")),
      "Use the secure version of the link. Your calendar's sharing settings show it.",
    );
  });
  it("refuses a username or password in the link", () => {
    const msg = "Paste the link without a username or password in it.";
    assert.equal(calendarLinkError(GOOD.replace("https://", "https://someone@")), msg);
    assert.equal(calendarLinkError(GOOD.replace("https://", "https://someone:words@")), msg);
  });
  it("refuses a link over MAX_CALENDAR_LINK characters, counted after trimming", () => {
    assert.equal(MAX_CALENDAR_LINK, 2048);
    const edge = GOOD + "?k=" + "a".repeat(MAX_CALENDAR_LINK - GOOD.length - 3);
    assert.equal(edge.length, MAX_CALENDAR_LINK);
    assert.equal(calendarLinkError(` ${edge} `), null);
    assert.equal(calendarLinkError(edge + "a"), "That link is too long for a calendar link.");
  });
  it("never echoes the link in its message", () => {
    for (const bad of [GOOD.replace("https:", "http:"), GOOD.replace("https://", "https://u:p@"), GOOD + "a".repeat(3000)]) {
      assert.ok(!(calendarLinkError(bad) ?? "").includes("private"));
    }
  });
});
