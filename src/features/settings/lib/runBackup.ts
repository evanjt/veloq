/**
 * Await a database copy that runs on a Rust thread.
 *
 * The copy takes over a second on a full library. Started synchronously it
 * froze the frame that asked for it, so Rust runs it on its own thread and
 * connection and answers with a promise.
 *
 * The ceiling runs on the awake clock: a suspension stops the waiting and not
 * the copy, so the wall clock it spends is not time the copy failed to finish
 * in.
 */
import { withAwakeDeadline } from '@/shared/async/awakeDeadline';

/**
 * A copy that has not finished by here is stuck, not slow.
 *
 * This is the budget for the two callers nobody is watching: the snapshot that
 * stands beside a destructive wipe, and the auto-backup. Both would rather wait
 * than give up, and the snapshot's expiry has to stay a failure or the wipe
 * proceeds with nothing to roll back to.
 */
export const BACKUP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * What a caller staring at a disabled row waits.
 *
 * The copy is over a second on a full library, so this is sixty times a healthy
 * run. Past it the athlete is told the copy is still running rather than told
 * it failed, which is what the five-minute budget said on the one path where
 * somebody is watching.
 */
export const FOREGROUND_BACKUP_TIMEOUT_MS = 60_000;

export interface BackupEngine {
  runBackup(destPath: string): Promise<void>;
}

export interface RunBackupOptions {
  timeoutMs?: number;
  /**
   * What the lapse means. `throw` is a copy that is stuck, which is what an
   * unwatched caller wants. `report` answers `running`, for a caller that can
   * show the athlete that the copy is still going and come back for it.
   */
  onLapse?: 'throw' | 'report';
}

/** `complete` when the copy landed, `running` when the budget lapsed under `report`. */
export type BackupWaitOutcome = 'complete' | 'running';

/**
 * A copy in flight, and what it has done so far.
 *
 * The screen that gave up at its ceiling comes back to the same copy rather
 * than starting a second one over the same database, and reads `settled` and
 * `failure` to know where it got to. Both are written by the copy itself, so a
 * caller that never awaits it still sees the truth.
 */
export interface PendingBackup {
  readonly work: Promise<void>;
  /** Whether the copy has ended, either way. */
  settled(): boolean;
  /** What it failed with, once it has, or null. */
  failure(): Error | null;
}

/** Start the copy and watch it, without waiting for it. */
export function startDatabaseBackup(engine: BackupEngine, destPlainPath: string): PendingBackup {
  let settled = false;
  let failure: Error | null = null;
  const work = engine.runBackup(destPlainPath).then(
    () => {
      settled = true;
    },
    (err: unknown) => {
      settled = true;
      failure = err instanceof Error ? err : new Error(String(err));
      throw failure;
    }
  );
  // Nothing has to be waiting when it ends: the failure is kept above and the
  // caller reads it when it comes back.
  work.catch(() => {});
  return { work, settled: () => settled, failure: () => failure };
}

/**
 * Wait out a copy already in flight.
 *
 * A failed copy rejects with the Rust message, the same as a copy waited on
 * from the start.
 */
export async function awaitDatabaseBackup(
  pending: PendingBackup,
  options: RunBackupOptions = {}
): Promise<BackupWaitOutcome> {
  const { timeoutMs = BACKUP_TIMEOUT_MS, onLapse = 'throw' } = options;
  const outcome = await withAwakeDeadline(pending.work, timeoutMs);
  if (outcome.state === 'complete') return 'complete';
  if (onLapse === 'report') return 'running';
  throw new Error('Backup did not finish in time');
}

/** Start a copy and wait for it, which is what every caller but the export does. */
export async function runDatabaseBackup(
  engine: BackupEngine,
  destPlainPath: string,
  options: RunBackupOptions = {}
): Promise<BackupWaitOutcome> {
  return awaitDatabaseBackup(startDatabaseBackup(engine, destPlainPath), options);
}
