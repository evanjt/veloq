/**
 * Run destructive database work with a rollback copy standing beside it.
 *
 * A clear removes section decisions and custom sections, which intervals.icu
 * cannot give back: the athlete made them here. The copy is taken through the
 * engine's own online backup, so the connection stays open and no frame waits
 * on the file, and it is deleted the moment the work returns.
 *
 * A copy that cannot be taken refuses the work rather than running it
 * unguarded.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { withAwakeDeadline } from '@/shared/async/awakeDeadline';
import { openLibrary } from '@/shared/storage/routeDbLocation';

import { inBackupSlot } from './backupSlot';
import { clearDatabaseSidecars } from './databaseSidecars';

/** The rollback copy's suffix, written beside the database it guards. */
const SNAPSHOT_SUFFIX = '.clear-bak';

/**
 * Delete the rollback copy beside `dbPath`, and its pair. A clear killed part
 * way, or a rollback that could not copy, leaves it there, and it is a whole
 * copy of the library, so the wipe takes it once its own clear has committed.
 */
export async function deleteClearSnapshot(dbPath: string): Promise<void> {
  const snapshotPath = `${dbPath}${SNAPSHOT_SUFFIX}`;
  await FileSystem.deleteAsync(`file://${snapshotPath}`, { idempotent: true });
  await clearDatabaseSidecars(snapshotPath);
}

/**
 * A snapshot that has not finished by here is stuck, not slow.
 *
 * Nobody is watching it, so it would rather wait than give up, and its expiry
 * has to stay a failure or the clear proceeds with nothing to roll back to.
 * The ceiling runs on the awake clock: a suspension stops the waiting and not
 * the copy.
 */
export const CLEAR_SNAPSHOT_TIMEOUT_MS = 5 * 60 * 1000;

interface SnapshotEngine {
  writeClearSnapshot(destPath: string): Promise<void>;
  destroyEngine(): void;
  initWithPath(path: string): boolean;
}

/**
 * Copy the database to `snapshotPath` on a Rust thread and wait for it.
 *
 * It runs inside the backup slot, so it waits for a record backup that is
 * writing instead of being refused by Rust's own claim on the same slot. A
 * failed copy rejects with the Rust message.
 */
export async function writeClearSnapshot(
  engine: Pick<SnapshotEngine, 'writeClearSnapshot'>,
  snapshotPath: string,
  timeoutMs: number = CLEAR_SNAPSHOT_TIMEOUT_MS
): Promise<void> {
  const work = inBackupSlot(() => engine.writeClearSnapshot(snapshotPath));
  // A copy that outlives the ceiling can still fail afterwards, with nobody
  // waiting on it.
  work.catch(() => {});
  const outcome = await withAwakeDeadline(work, timeoutMs);
  if (outcome.state !== 'complete') throw new Error('Clear snapshot did not finish in time');
}

export async function withDatabaseSnapshot<T>(
  engine: SnapshotEngine,
  dbPath: string,
  work: () => Promise<T>
): Promise<T> {
  const snapshotPath = `${dbPath}${SNAPSHOT_SUFFIX}`;
  await writeClearSnapshot(engine, snapshotPath);

  try {
    const result = await work();
    // `work` can return while a wipe is still running on its Rust thread. That
    // is safe to outlive: each wipe is one SQLite transaction, so a late
    // failure or a kill rolls it back whole and the copy would restore nothing
    // the database does not already hold. Work that spans several commits
    // must not return before they settle.
    await FileSystem.deleteAsync(`file://${snapshotPath}`, { idempotent: true });
    return result;
  } catch (error) {
    // The engine holds the file the copy is about to overwrite, and
    // `initWithPath` no-ops on an engine that is already open.
    try {
      engine.destroyEngine();
      // The snapshot is a standalone file from the online backup, so anything
      // still sitting beside the database belongs to the one being replaced.
      // `destroyEngine` only drops the pair when it closes the last connection,
      // and the detection worker and the export source each hold one.
      await clearDatabaseSidecars(dbPath);
      await FileSystem.copyAsync({
        from: `file://${snapshotPath}`,
        to: `file://${dbPath}`,
      });
      await FileSystem.deleteAsync(`file://${snapshotPath}`, { idempotent: true });
    } catch {
      // A rollback that cannot copy leaves the snapshot for manual recovery.
    }
    try {
      openLibrary(engine, dbPath);
    } catch {
      // An engine that will not reopen needs a relaunch, not a second attempt.
    }
    throw error;
  }
}
