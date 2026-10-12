import Dexie, { type Table } from "dexie";
import {
  FSRSVersion,
  createEmptyCard,
  fsrs,
  type Card as FsrsCard,
  type Grade as FsrsGrade,
} from "ts-fsrs";

import type {
  BackupRestoreMode,
  BackupRestoreResult,
  ChessTrainerBackup,
  ContentManifest,
  JsonValue,
  ReviewCardOptions,
  ReviewCardRecord,
  ReviewEvent,
  ReviewGrade,
  ReviewResult,
  SerializedContentManifest,
  SerializedFsrsCard,
  SerializedReviewCardRecord,
  SerializedReviewEvent,
  SerializedSettingRecord,
  SerializedTrainingAttempt,
  SettingRecord,
  TrainingAttempt,
} from "./types";

export const CHESS_TRAINER_DB_NAME = "kings-study";
export const CHESS_TRAINER_DB_VERSION = 2;

export class StorageUnavailableError extends Error {
  constructor(message = "Local training storage is unavailable in this environment.", options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export class BackupValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupValidationError";
  }
}

export class ChessTrainerDb extends Dexie {
  reviewCards!: Table<ReviewCardRecord, string>;
  reviewEvents!: Table<ReviewEvent, string>;
  attempts!: Table<TrainingAttempt, string>;
  settings!: Table<SettingRecord, string>;
  contentManifests!: Table<ContentManifest, string>;

  constructor() {
    super(CHESS_TRAINER_DB_NAME);

    // Kept as a real migration chain so future releases can open early local
    // databases without rebuilding or silently dropping review history.
    this.version(1).stores({
      reviewCards: "&id, due, kind, itemId, updatedAt",
      reviewEvents: "&id, cardId, reviewedAt, itemId",
      attempts: "&id, itemId, kind, finishedAt",
      settings: "&key, updatedAt",
    });

    this.version(CHESS_TRAINER_DB_VERSION).stores({
      reviewCards: "&id, due, kind, itemId, updatedAt, [kind+due]",
      reviewEvents: "&id, cardId, reviewedAt, itemId, [cardId+reviewedAt]",
      attempts: "&id, itemId, kind, finishedAt, [kind+finishedAt]",
      settings: "&key, updatedAt",
      contentManifests: "&id, kind, version, installedAt",
    });
  }
}

let database: ChessTrainerDb | null = null;
let scheduler: ReturnType<typeof fsrs> | null = null;

export function isStorageAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.indexedDB !== "undefined" &&
    typeof globalThis.IDBKeyRange !== "undefined"
  );
}

/** Returns null during SSR or in browsers without IndexedDB. Does not open the DB. */
export function getChessTrainerDb(): ChessTrainerDb | null {
  if (!isStorageAvailable()) return null;
  if (!database) {
    try {
      database = new ChessTrainerDb();
    } catch {
      return null;
    }
  }
  return database;
}

async function requireDatabase(): Promise<ChessTrainerDb> {
  const db = getChessTrainerDb();
  if (!db) throw new StorageUnavailableError();
  try {
    await db.open();
    return db;
  } catch (error) {
    db.close();
    database = null;
    throw new StorageUnavailableError("Could not open local training storage.", { cause: error });
  }
}

export function closeChessTrainerDb(): void {
  database?.close();
  database = null;
}

function getScheduler(): ReturnType<typeof fsrs> {
  scheduler ??= fsrs();
  return scheduler;
}

function makeId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}:${randomUuid}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function checkedDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BackupValidationError(`Invalid ${label}.`);
  return date;
}

function cloneCard(card: FsrsCard): FsrsCard {
  return {
    ...card,
    due: checkedDate(card.due, "card due date"),
    ...(card.last_review
      ? { last_review: checkedDate(card.last_review, "card last-review date") }
      : {}),
  };
}

function serializeCard(card: FsrsCard): SerializedFsrsCard {
  const { due, last_review: lastReview, ...rest } = card;
  return {
    ...rest,
    due: checkedDate(due, "card due date").toISOString(),
    ...(lastReview
      ? { last_review: checkedDate(lastReview, "card last-review date").toISOString() }
      : {}),
  };
}

function deserializeCard(card: SerializedFsrsCard): FsrsCard {
  const { due, last_review: lastReview, ...rest } = card;
  return {
    ...rest,
    due: checkedDate(due, "card due date"),
    ...(lastReview
      ? { last_review: checkedDate(lastReview, "card last-review date") }
      : {}),
  };
}

function normalizeGrade(grade: ReviewGrade): FsrsGrade {
  if (![1, 2, 3, 4].includes(grade)) {
    throw new RangeError(`FSRS grade must be 1, 2, 3, or 4; received ${grade}.`);
  }
  return grade as FsrsGrade;
}

type AppendReviewEventInput = Omit<ReviewEvent, "id" | "schemaVersion"> & { id?: string };

/** Adds an immutable review event. No update/delete event API is exposed. */
export async function appendReviewEvent(input: AppendReviewEventInput): Promise<ReviewEvent> {
  const db = await requireDatabase();
  const event: ReviewEvent = {
    ...input,
    schemaVersion: 1,
    id: input.id ?? makeId("review"),
    reviewedAt: checkedDate(input.reviewedAt, "review date"),
    previousCard: cloneCard(input.previousCard),
    nextCard: cloneCard(input.nextCard),
  };
  await db.reviewEvents.add(event);
  return event;
}

/**
 * Applies one FSRS grade and appends its audit event in the same IndexedDB
 * transaction. A missing card is created at the review timestamp.
 */
export async function reviewCard(
  cardId: string,
  grade: ReviewGrade,
  options: ReviewCardOptions = {},
): Promise<ReviewResult> {
  if (!cardId.trim()) throw new TypeError("cardId is required.");
  const db = await requireDatabase();
  const reviewedAt = checkedDate(options.reviewedAt ?? new Date(), "review date");

  return db.transaction("rw", db.reviewCards, db.reviewEvents, async () => {
    const current = await db.reviewCards.get(cardId);
    const previousCard = current
      ? cloneCard(current.card)
      : createEmptyCard(reviewedAt);
    const scheduled = getScheduler().next(previousCard, reviewedAt, normalizeGrade(grade));
    const now = new Date();
    const itemId = options.itemId ?? current?.itemId ?? cardId;
    const kind = options.kind ?? current?.kind ?? "custom";
    const record: ReviewCardRecord = {
      id: cardId,
      itemId,
      kind,
      card: cloneCard(scheduled.card),
      due: checkedDate(scheduled.card.due, "scheduled due date"),
      state: scheduled.card.state,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    const event: ReviewEvent = {
      schemaVersion: 1,
      id: makeId("review"),
      cardId,
      itemId,
      kind,
      grade,
      reviewedAt,
      ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
      ...(options.source ? { source: options.source } : {}),
      ...(options.context !== undefined ? { context: options.context } : {}),
      schedulerVersion: FSRSVersion,
      previousCard: cloneCard(previousCard),
      nextCard: cloneCard(scheduled.card),
    };

    // add(), not put(), preserves append-only semantics and catches id reuse.
    await db.reviewEvents.add(event);
    await db.reviewCards.put(record);
    return { card: record, event };
  });
}

export async function getDueReviewCards(
  asOf: Date = new Date(),
  limit = 100,
): Promise<ReviewCardRecord[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer.");
  const db = await requireDatabase();
  return db.reviewCards
    .where("due")
    .belowOrEqual(checkedDate(asOf, "due cutoff"))
    .limit(limit)
    .sortBy("due");
}

export async function putTrainingAttempt(
  attempt: Omit<TrainingAttempt, "id"> & { id?: string },
): Promise<TrainingAttempt> {
  const db = await requireDatabase();
  const record: TrainingAttempt = {
    ...attempt,
    id: attempt.id ?? makeId("attempt"),
    startedAt: checkedDate(attempt.startedAt, "attempt start date"),
    finishedAt: checkedDate(attempt.finishedAt, "attempt finish date"),
  };
  await db.attempts.put(record);
  return record;
}

export async function putSetting(key: string, value: JsonValue): Promise<SettingRecord> {
  if (!key.trim()) throw new TypeError("setting key is required.");
  const db = await requireDatabase();
  const record: SettingRecord = { key, value, updatedAt: new Date() };
  await db.settings.put(record);
  return record;
}

export async function getSetting<T extends JsonValue>(key: string): Promise<T | undefined> {
  const db = await requireDatabase();
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function putContentManifest(
  manifest: Omit<ContentManifest, "schemaVersion"> & { schemaVersion?: 1 },
): Promise<ContentManifest> {
  const db = await requireDatabase();
  const record: ContentManifest = {
    ...manifest,
    schemaVersion: 1,
    installedAt: checkedDate(manifest.installedAt, "content install date"),
  };
  await db.contentManifests.put(record);
  return record;
}

function serializeReviewCard(record: ReviewCardRecord): SerializedReviewCardRecord {
  return {
    ...record,
    card: serializeCard(record.card),
    due: checkedDate(record.due, "review card due date").toISOString(),
    createdAt: checkedDate(record.createdAt, "review card creation date").toISOString(),
    updatedAt: checkedDate(record.updatedAt, "review card update date").toISOString(),
  };
}

function deserializeReviewCard(record: SerializedReviewCardRecord): ReviewCardRecord {
  return {
    ...record,
    card: deserializeCard(record.card),
    due: checkedDate(record.due, "review card due date"),
    createdAt: checkedDate(record.createdAt, "review card creation date"),
    updatedAt: checkedDate(record.updatedAt, "review card update date"),
  };
}

function serializeReviewEvent(event: ReviewEvent): SerializedReviewEvent {
  return {
    ...event,
    schemaVersion: 1,
    reviewedAt: checkedDate(event.reviewedAt, "event review date").toISOString(),
    previousCard: serializeCard(event.previousCard),
    nextCard: serializeCard(event.nextCard),
  };
}

function deserializeReviewEvent(event: SerializedReviewEvent): ReviewEvent {
  return {
    ...event,
    schemaVersion: 1,
    reviewedAt: checkedDate(event.reviewedAt, "event review date"),
    previousCard: deserializeCard(event.previousCard),
    nextCard: deserializeCard(event.nextCard),
  };
}

function serializeAttempt(attempt: TrainingAttempt): SerializedTrainingAttempt {
  return {
    ...attempt,
    startedAt: checkedDate(attempt.startedAt, "attempt start date").toISOString(),
    finishedAt: checkedDate(attempt.finishedAt, "attempt finish date").toISOString(),
  };
}

function deserializeAttempt(attempt: SerializedTrainingAttempt): TrainingAttempt {
  return {
    ...attempt,
    startedAt: checkedDate(attempt.startedAt, "attempt start date"),
    finishedAt: checkedDate(attempt.finishedAt, "attempt finish date"),
  };
}

function serializeSetting(setting: SettingRecord): SerializedSettingRecord {
  return { ...setting, updatedAt: checkedDate(setting.updatedAt, "setting update date").toISOString() };
}

function deserializeSetting(setting: SerializedSettingRecord): SettingRecord {
  return { ...setting, updatedAt: checkedDate(setting.updatedAt, "setting update date") };
}

function serializeManifest(manifest: ContentManifest): SerializedContentManifest {
  return {
    ...manifest,
    schemaVersion: 1,
    installedAt: checkedDate(manifest.installedAt, "manifest install date").toISOString(),
  };
}

function deserializeManifest(manifest: SerializedContentManifest): ContentManifest {
  return {
    ...manifest,
    schemaVersion: 1,
    installedAt: checkedDate(manifest.installedAt, "manifest install date"),
  };
}

export async function createBackup(): Promise<ChessTrainerBackup> {
  const db = await requireDatabase();
  const [reviewCards, reviewEvents, attempts, settings, contentManifests] = await Promise.all([
    db.reviewCards.toArray(),
    db.reviewEvents.toArray(),
    db.attempts.toArray(),
    db.settings.toArray(),
    db.contentManifests.toArray(),
  ]);
  return {
    format: "kings-study-backup",
    schemaVersion: CHESS_TRAINER_DB_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      reviewCards: reviewCards.map(serializeReviewCard),
      reviewEvents: reviewEvents.map(serializeReviewEvent),
      attempts: attempts.map(serializeAttempt),
      settings: settings.map(serializeSetting),
      contentManifests: contentManifests.map(serializeManifest),
    },
  };
}

export async function exportBackup(space = 2): Promise<string> {
  if (!Number.isInteger(space) || space < 0 || space > 10) {
    throw new RangeError("JSON indentation must be an integer from 0 to 10.");
  }
  return JSON.stringify(await createBackup(), null, space);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBackup(input: string | ChessTrainerBackup): ChessTrainerBackup {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      throw new BackupValidationError("Backup is not valid JSON.", { cause: error });
    }
  }
  if (!isObject(value) || value.format !== "kings-study-backup") {
    throw new BackupValidationError("This is not a King's Study backup.");
  }
  if (
    typeof value.schemaVersion !== "number" ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion < 1 ||
    value.schemaVersion > CHESS_TRAINER_DB_VERSION
  ) {
    throw new BackupValidationError(`Unsupported backup schema version: ${String(value.schemaVersion)}.`);
  }
  if (typeof value.exportedAt !== "string") {
    throw new BackupValidationError("Backup export timestamp is missing.");
  }
  checkedDate(value.exportedAt, "backup export date");
  if (!isObject(value.data)) throw new BackupValidationError("Backup data is missing.");

  const required = ["reviewCards", "reviewEvents", "attempts", "settings"] as const;
  for (const key of required) {
    if (!Array.isArray(value.data[key])) {
      throw new BackupValidationError(`Backup table ${key} is missing.`);
    }
  }
  if (value.data.contentManifests !== undefined && !Array.isArray(value.data.contentManifests)) {
    throw new BackupValidationError("Backup table contentManifests is invalid.");
  }

  return {
    format: "kings-study-backup",
    schemaVersion: value.schemaVersion,
    exportedAt: value.exportedAt,
    data: {
      reviewCards: value.data.reviewCards as SerializedReviewCardRecord[],
      reviewEvents: value.data.reviewEvents as SerializedReviewEvent[],
      attempts: value.data.attempts as SerializedTrainingAttempt[],
      settings: value.data.settings as SerializedSettingRecord[],
      contentManifests: (value.data.contentManifests ?? []) as SerializedContentManifest[],
    },
  };
}

function sameEvent(left: ReviewEvent, right: ReviewEvent): boolean {
  return JSON.stringify(serializeReviewEvent(left)) === JSON.stringify(serializeReviewEvent(right));
}

/**
 * Restores a validated JSON backup. Merge never overwrites review events: an
 * identical id is skipped, while a conflicting id aborts the transaction.
 */
export async function restoreBackup(
  input: string | ChessTrainerBackup,
  options: { mode?: BackupRestoreMode } = {},
): Promise<BackupRestoreResult> {
  const backup = parseBackup(input);
  const mode = options.mode ?? "merge";
  const db = await requireDatabase();

  const cards = backup.data.reviewCards.map(deserializeReviewCard);
  const events = backup.data.reviewEvents.map(deserializeReviewEvent);
  const attempts = backup.data.attempts.map(deserializeAttempt);
  const settings = backup.data.settings.map(deserializeSetting);
  const manifests = backup.data.contentManifests.map(deserializeManifest);

  return db.transaction(
    "rw",
    db.reviewCards,
    db.reviewEvents,
    db.attempts,
    db.settings,
    db.contentManifests,
    async () => {
      if (mode === "replace") {
        await Promise.all([
          db.reviewCards.clear(),
          db.reviewEvents.clear(),
          db.attempts.clear(),
          db.settings.clear(),
          db.contentManifests.clear(),
        ]);
      }

      let eventsSkipped = 0;
      const eventsToAdd: ReviewEvent[] = [];
      if (mode === "merge") {
        const existingEvents = await db.reviewEvents.bulkGet(events.map((event) => event.id));
        events.forEach((event, index) => {
          const existing = existingEvents[index];
          if (!existing) {
            eventsToAdd.push(event);
          } else if (sameEvent(existing, event)) {
            eventsSkipped += 1;
          } else {
            throw new BackupValidationError(`Review event id ${event.id} conflicts with local history.`);
          }
        });
      } else {
        eventsToAdd.push(...events);
      }

      const cardsToPut = mode === "replace"
        ? cards
        : (await Promise.all(cards.map(async (card) => {
            const local = await db.reviewCards.get(card.id);
            return !local || local.updatedAt <= card.updatedAt ? card : null;
          }))).filter((card): card is ReviewCardRecord => card !== null);
      const settingsToPut = mode === "replace"
        ? settings
        : (await Promise.all(settings.map(async (setting) => {
            const local = await db.settings.get(setting.key);
            return !local || local.updatedAt <= setting.updatedAt ? setting : null;
          }))).filter((setting): setting is SettingRecord => setting !== null);

      if (cardsToPut.length) await db.reviewCards.bulkPut(cardsToPut);
      if (eventsToAdd.length) await db.reviewEvents.bulkAdd(eventsToAdd);
      if (attempts.length) await db.attempts.bulkPut(attempts);
      if (settingsToPut.length) await db.settings.bulkPut(settingsToPut);
      if (manifests.length) await db.contentManifests.bulkPut(manifests);

      return {
        mode,
        cards: cardsToPut.length,
        eventsAdded: eventsToAdd.length,
        eventsSkipped,
        attempts: attempts.length,
        settings: settingsToPut.length,
        contentManifests: manifests.length,
      };
    },
  );
}

/** Explicit user-facing reset primitive. Review events are otherwise append-only. */
export async function clearLocalData(): Promise<void> {
  const db = await requireDatabase();
  await db.transaction(
    "rw",
    db.reviewCards,
    db.reviewEvents,
    db.attempts,
    db.settings,
    db.contentManifests,
    async () => {
      await Promise.all([
        db.reviewCards.clear(),
        db.reviewEvents.clear(),
        db.attempts.clear(),
        db.settings.clear(),
        db.contentManifests.clear(),
      ]);
    },
  );
}
