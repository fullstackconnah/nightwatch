import assert from "node:assert/strict";
import { test } from "node:test";
import { discordStepUpNeeded, splitUserIds, stepUpAsked } from "./discord-step-up.ts";

const stored = { discordAllowedUserIds: ["111", "222"], discordChannelId: "999" };

test("nothing typed, no stored list: not a change", () => {
  assert.equal(discordStepUpNeeded({ allowedUserIds: [] }, {}), false);
  assert.equal(discordStepUpNeeded({}, stored), false);
});

test("pipeline and dry run are not part of the change, so a save of only those never asks", () => {
  assert.equal(discordStepUpNeeded({ allowedUserIds: ["111", "222"], channelId: "999" }, stored), false);
});

test("secrets: a typed bot token or webhook is a change, spaces only are not, and each clear flag is", () => {
  assert.equal(discordStepUpNeeded({ botToken: "abc" }, stored), true);
  assert.equal(discordStepUpNeeded({ webhookUrl: "https://discord.com/api/webhooks/1/x" }, stored), true);
  assert.equal(discordStepUpNeeded({ botToken: "   ", webhookUrl: "" }, stored), false);
  assert.equal(discordStepUpNeeded({ clearBotToken: true }, stored), true);
  assert.equal(discordStepUpNeeded({ clearWebhookUrl: true }, stored), true);
});

test("allowlist: add, remove, empty and reorder are changes; extra spaces and blanks are not", () => {
  assert.equal(discordStepUpNeeded({ allowedUserIds: ["111", "222", "333"] }, stored), true);
  assert.equal(discordStepUpNeeded({ allowedUserIds: ["111"] }, stored), true);
  assert.equal(discordStepUpNeeded({ allowedUserIds: [] }, stored), true);
  assert.equal(discordStepUpNeeded({ allowedUserIds: ["222", "111"] }, stored), true);
  assert.equal(discordStepUpNeeded({ allowedUserIds: [" 111 ", "", "222"] }, stored), false);
  assert.equal(discordStepUpNeeded({ allowedUserIds: ["111"] }, {}), true);
});

test("channel id: a different value is a change, the same value (even padded) is not, and absent is not", () => {
  assert.equal(discordStepUpNeeded({ channelId: "888" }, stored), true);
  assert.equal(discordStepUpNeeded({ channelId: "" }, stored), true);
  assert.equal(discordStepUpNeeded({ channelId: " 999 " }, stored), false);
  assert.equal(discordStepUpNeeded({ channelId: "" }, {}), false);
  assert.equal(discordStepUpNeeded({ channelId: "777" }, {}), true);
});

test("splitUserIds is the one comma split: trimmed, blanks dropped, order kept", () => {
  assert.deepEqual(splitUserIds(" 111 ,222,, 333 "), ["111", "222", "333"]);
  assert.deepEqual(splitUserIds(""), []);
  assert.equal(discordStepUpNeeded({ allowedUserIds: splitUserIds("111,   222") }, stored), false);
});

test("stepUpAsked: a refusal keeps the field only while the drafts are the ones refused, a pending change always shows it", () => {
  assert.equal(stepUpAsked(false, null, "a"), false);
  assert.equal(stepUpAsked(true, null, "a"), true);
  // refused with the drafts at "a": still shown while they stay "a" (a stale card the server disagrees with)
  assert.equal(stepUpAsked(false, "a", "a"), true);
  // the Discord edits were reverted (drafts moved on, nothing pending): the field goes away
  assert.equal(stepUpAsked(false, "a", "b"), false);
  // changed to something else that is pending: shown by the pending rule
  assert.equal(stepUpAsked(true, "a", "b"), true);
});
