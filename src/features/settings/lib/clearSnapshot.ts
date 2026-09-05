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

import { runDatabaseBackup, type BackupEngine } from './runBackup';

/** The rollback copy's suffix, distinct from the restore path's `.bak`. */
const SNAPSHOT_SUFFIX = '.clear-bak';

interface SnapshotEngine extends BackupEngine {
  destroyEngine(): void;
  initWithPath(path: string): boolean;
}

export async function withDatabaseSnapshot<T>(
  engine: SnapshotEngine,
  dbPath: string,
  work: () => Promise<T>
): Promise<T> {
  const snapshotPath = `${dbPath}${SNAPSHOT_SUFFIX}`;
  await runDatabaseBackup(engine, snapshotPath);

  try {
    const result = await work();
    await FileSystem.deleteAsync(`file://${snapshotPath}`, { idempotent: true });
    return result;
  } catch (error) {
    // The engine holds the file the copy is about to overwrite, and
    // `initWithPath` no-ops on an engine that is already open.
    try {
      engine.destroyEngine();
      await FileSystem.copyAsync({
        from: `file://${snapshotPath}`,
        to: `file://${dbPath}`,
      });
      await FileSystem.deleteAsync(`file://${snapshotPath}`, { idempotent: true });
    } catch {
      // A rollback that cannot copy leaves the snapshot for manual recovery.
    }
    try {
      engine.initWithPath(dbPath);
    } catch {
      // An engine that will not reopen needs a relaunch, not a second attempt.
    }
    throw error;
  }
}
