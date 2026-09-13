/**
 * Await a database copy that runs on a Rust thread.
 *
 * The copy takes over a second on a full library. Started synchronously it
 * froze the frame that asked for it, so Rust runs it on its own thread and
 * connection and this only polls the outcome.
 *
 * The deadline runs on the awake clock: a suspension stops the polling and not
 * the copy, so the wall clock it spends is not time the copy failed to finish
 * in.
 */
import { createAwakeClock } from '@/shared/app/awakeClock';

/** Cheap enough to poll at, short enough that a small copy still returns promptly. */
const POLL_INTERVAL_MS = 50;

/** A copy that has not finished by here is stuck, not slow. */
const BACKUP_TIMEOUT_MS = 5 * 60 * 1000;

export interface BackupEngine {
  startBackup(destPath: string): void;
  pollBackup(): string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runDatabaseBackup(
  engine: BackupEngine,
  destPlainPath: string,
  timeoutMs: number = BACKUP_TIMEOUT_MS
): Promise<void> {
  engine.startBackup(destPlainPath);

  const awake = createAwakeClock(POLL_INTERVAL_MS);
  const deadline = awake() + timeoutMs;
  for (;;) {
    await wait(POLL_INTERVAL_MS);
    // A failed copy throws out of pollBackup, carrying the Rust message.
    const state = engine.pollBackup();
    if (state === 'complete') return;
    if (state !== 'running') {
      throw new Error(`Backup stopped without finishing (${state})`);
    }
    if (awake() > deadline) {
      throw new Error('Backup did not finish in time');
    }
  }
}
