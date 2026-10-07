/**
 * The engine's one backup slot, as this process takes it.
 *
 * Rust runs every backup write, the record archive and the database copy
 * alike, under a single slot and refuses a second claim with `Busy`. Three
 * callers reach it: the auto-backup, Export Backup and the rollback copy taken
 * before a clear. None of them knows when another is writing, so each takes
 * its turn here and a caller that arrives during another's write waits for it
 * rather than being refused.
 */

let tail: Promise<void> = Promise.resolve();

/** Run `write` once every write queued before it has ended, either way. */
export function inBackupSlot<T>(write: () => Promise<T>): Promise<T> {
  const turn = tail.then(write);
  tail = turn.then(
    () => undefined,
    () => undefined
  );
  return turn;
}
