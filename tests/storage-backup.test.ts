import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  clearLocalData,
  closeChessTrainerDb,
  exportBackup,
  getChessTrainerDb,
  getSetting,
  putContentManifest,
  putSetting,
  putTrainingAttempt,
  restoreBackup,
  reviewCard,
} from "../lib/storage";

before(async () => {
  await clearLocalData();
});

after(async () => {
  await clearLocalData();
  closeChessTrainerDb();
});

test("exports and restores review history, attempts, settings, and manifests losslessly", async () => {
  const reviewedAt = new Date("2026-08-28T08:00:00.000Z");
  const finishedAt = new Date("2026-08-28T08:03:00.000Z");

  await reviewCard("opening:storage-test", 3, {
    itemId: "storage-test",
    kind: "opening",
    reviewedAt,
    source: "test",
  });
  await putTrainingAttempt({
    id: "attempt:storage-test",
    itemId: "storage-test",
    kind: "opening",
    startedAt: reviewedAt,
    finishedAt,
    outcome: "solved",
    durationMs: 180_000,
    mistakes: 0,
  });
  await putSetting("profile", { rating: 1327, orientation: "black" });
  await putContentManifest({
    id: "manifest:test",
    kind: "curriculum",
    version: "1",
    installedAt: reviewedAt,
    itemCount: 20,
    checksum: "sha256:test",
  });

  const original = JSON.parse(await exportBackup()) as {
    format: string;
    schemaVersion: number;
    data: Record<string, unknown[]>;
  };
  assert.equal(original.format, "kings-study-backup");
  assert.equal(original.schemaVersion, 2);
  assert.equal(original.data.reviewCards.length, 1);
  assert.equal(original.data.reviewEvents.length, 1);
  assert.equal(original.data.attempts.length, 1);
  assert.equal(original.data.settings.length, 1);
  assert.equal(original.data.contentManifests.length, 1);
  assert.equal((original.data.reviewEvents[0] as { schemaVersion: number }).schemaVersion, 1);

  await clearLocalData();
  assert.equal(await getSetting("profile"), undefined);
  const restored = await restoreBackup(JSON.stringify(original), { mode: "replace" });
  assert.deepEqual(restored, {
    mode: "replace",
    cards: 1,
    eventsAdded: 1,
    eventsSkipped: 0,
    attempts: 1,
    settings: 1,
    contentManifests: 1,
  });

  const afterRestore = JSON.parse(await exportBackup()) as typeof original;
  assert.deepEqual(afterRestore.data, original.data);
  assert.deepEqual(await getSetting("profile"), { rating: 1327, orientation: "black" });
});

test("merge restore skips an identical append-only review event", async () => {
  const backup = await exportBackup();
  const result = await restoreBackup(backup, { mode: "merge" });
  assert.equal(result.eventsAdded, 0);
  assert.equal(result.eventsSkipped, 1);

  const db = getChessTrainerDb();
  assert.ok(db);
  assert.equal(await db.reviewEvents.count(), 1);
});
