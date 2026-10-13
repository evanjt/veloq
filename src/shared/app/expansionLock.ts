/**
 * When the latch a reset puts on the Local Data Range slider comes off.
 *
 * The latch exists so cached activities arriving after a clear cannot widen
 * the range on their own. Releasing it on a completed GPS pass alone left it
 * on for the session whenever no pass could complete: a new athlete with
 * nothing in the launch window, a login with no network, a clear that errored
 * mid-sync.
 */

import type { GpsSyncProgress } from '@/shared/app/SyncDateRangeStore';

/**
 * Whether the GPS sync has stopped for good since the reset that set the
 * latch. `activityCount` is the library's, null until the engine answers, and
 * zero means the sync returns before running, so no terminal status will ever
 * arrive. A terminal status counts only when the run that wrote it started at
 * `lockGeneration`: the one a run from before the reset left standing says
 * nothing about the new state.
 */
export function syncSettledForExpansion(
  progress: Pick<GpsSyncProgress, 'status' | 'generation'>,
  activityCount: number | null,
  lockGeneration: number
): boolean {
  if (progress.status === 'complete' || progress.status === 'error') {
    return progress.generation === lockGeneration;
  }
  return activityCount === 0;
}
