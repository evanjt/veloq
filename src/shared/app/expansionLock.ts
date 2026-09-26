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
 * Whether the GPS sync has stopped for good. `activityCount` is null until the
 * activities are loaded, and zero means the sync returns before running, so no
 * terminal status will ever arrive.
 */
export function syncSettledForExpansion(
  status: GpsSyncProgress['status'],
  activityCount: number | null
): boolean {
  if (status === 'complete' || status === 'error') return true;
  return activityCount === 0;
}
