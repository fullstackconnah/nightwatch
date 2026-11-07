import assert from "node:assert/strict";
import { it } from "node:test";
import { enqueueLines, flushArchive } from "./log-archive.ts";
import type { LogLine } from "./types/log.ts";

const line: LogLine = { id: "c:l0", container: "c", ts: 1, stream: "stdout", level: "info", text: "hi" };

it("a failed IndexedDB open is retried by the next flush, not cached", async () => {
  let opens = 0;
  let transactions = 0;
  const db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      transactions += 1;
      throw new Error("stop after the write is attempted");
    },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open() {
      opens += 1;
      const failing = opens === 1;
      const request: Record<string, unknown> = { result: db, error: new Error("boom") };
      setTimeout(() => {
        const cb = failing ? request.onerror : request.onsuccess;
        (cb as () => void)();
      }, 0);
      return request;
    },
  };
  enqueueLines([line]);
  await flushArchive();
  assert.equal(opens, 1);
  assert.equal(transactions, 0);
  enqueueLines([line]);
  await flushArchive();
  assert.equal(opens, 2, "the second flush opens the database again");
  assert.equal(transactions, 1, "and reaches the write");
});
