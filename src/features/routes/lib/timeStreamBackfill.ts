/**
 * Fetches the `time` streams the upgrade path left behind.
 *
 * Rust fetches and persists them behind the shared governor and announces each
 * one as it lands, so this only reports the drain. Nothing is re-read while it
 * waits.
 */

import { engine } from 'veloqrs';

import { awaitTimeStreams } from './awaitTimeStreams';

/** How long to let the backfill run before moving on. It resumes on the next
 *  sync, so a slow drain never blocks the banner. */
const BACKFILL_TIMEOUT_MS = 60_000;

export interface TimeStreamBackfill {
  /** How many activities the backfill was asked for. */
  total: number;
  /** How many were still missing when the wait ended. */
  remaining: number;
}

/**
 * Ask for the missing streams and wait for them, calling `onProgress` with how
 * many have landed out of how many were asked for. `signal` ends the wait for a
 * screen that has gone away; Rust keeps fetching either way.
 */
export async function backfillTimeStreams(
  onProgress: (completed: number, total: number) => void,
  signal?: AbortSignal
): Promise<TimeStreamBackfill> {
  const needing = engine.getActivitiesNeedingTimeStreams();
  if (needing.length === 0) {
    return { total: 0, remaining: 0 };
  }

  const total = needing.length;
  engine.syncTimeStreams(needing);
  onProgress(0, total);

  const remaining = await awaitTimeStreams(needing, {
    timeoutMs: BACKFILL_TIMEOUT_MS,
    signal,
    onProgress: (left) => onProgress(total - left, total),
  });

  return { total, remaining };
}
