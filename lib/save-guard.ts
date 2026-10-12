/** Drain a changing serialized save queue before discarding its in-memory owner. */
export async function flushPendingSaves(
  currentQueue: () => Promise<void>,
  hasFailed: () => boolean,
  onReady?: () => void,
): Promise<boolean> {
  let pending: Promise<void>;
  do {
    pending = currentQueue();
    try { await pending; } catch { return false; }
    // A move/assessment may have enqueued another snapshot while this one saved.
  } while (pending !== currentQueue());
  if (hasFailed()) return false;
  // Cancel producers synchronously at the durable checkpoint, before yielding
  // to the caller: another engine result must not sneak in a newer snapshot.
  onReady?.();
  return true;
}
