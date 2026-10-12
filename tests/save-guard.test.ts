import assert from "node:assert/strict";
import { test } from "node:test";

import { flushPendingSaves } from "../lib/save-guard";

test("leaving waits for every snapshot enqueued during the flush", async () => {
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  let queue = new Promise<void>((resolve) => { finishFirst = resolve; });
  let allowed = false;
  const flush = flushPendingSaves(() => queue, () => false).then((result) => { allowed = result; });
  queue = queue.then(() => new Promise<void>((resolve) => { finishSecond = resolve; }));
  finishFirst();
  await Promise.resolve();
  assert.equal(allowed, false);
  finishSecond();
  await flush;
  assert.equal(allowed, true);
});

test("a caught autosave failure blocks leaving the live game", async () => {
  let failed = false;
  const queue = Promise.reject(new Error("Storage quota exceeded")).catch(() => { failed = true; });
  assert.equal(await flushPendingSaves(() => queue, () => failed), false);
});

test("a successful retry permits leaving after an earlier failed save", async () => {
  let failed = true;
  const queue = Promise.resolve().then(() => { failed = false; });
  assert.equal(await flushPendingSaves(() => queue, () => failed), true);
});

test("an uncaught persistence error also blocks navigation", async () => {
  const queue = Promise.reject(new Error("IndexedDB unavailable"));
  assert.equal(await flushPendingSaves(() => queue, () => false), false);
});

test("stops producers only at a successful durable checkpoint", async () => {
  const queue = Promise.resolve();
  let stopped = false;
  const stop = () => { stopped = true; };
  assert.equal(await flushPendingSaves(() => queue, () => true, stop), false);
  assert.equal(stopped, false, "failed navigation must not leave the live game stopped");
  assert.equal(await flushPendingSaves(() => queue, () => false, stop), true);
  assert.equal(stopped, true);
});
