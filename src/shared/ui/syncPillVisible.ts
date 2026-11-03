/**
 * Whether the floating sync pill shows for a sync that is running.
 *
 * The pill is for work an athlete waits on, not for a routine check. A sync
 * stays quiet until it has run past a grace period, or until a step reports a
 * count of items it is fetching. Every sync follows this rule, whether it began
 * at launch, on foreground or from a pull.
 */

import { SyncState } from 'veloqrs';

import { duration } from '@/theme';

/** How long a sync runs before its pill shows without a step count. */
export const SYNC_PILL_GRACE_MS = duration.grace;

interface PillStatus {
  state: SyncState;
  stepItemsDone?: number | undefined;
  stepItemsTotal?: number | undefined;
}

export function syncPillVisible(status: PillStatus | null, runningMs: number): boolean {
  if (status?.state !== SyncState.Syncing) return false;
  if ((status.stepItemsTotal ?? 0) > 0 || (status.stepItemsDone ?? 0) > 0) return true;
  return runningMs >= SYNC_PILL_GRACE_MS;
}
