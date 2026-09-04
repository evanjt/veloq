/**
 * Foreground re-try for the detector cutover.
 *
 * The launch trigger declines while the elevation backfill still owes fetches,
 * and nothing in that process asks again. A backfill that drains while the app
 * is backgrounded would otherwise wait for a relaunch. The trigger is
 * idempotent and its guards are three engine reads, so every return from the
 * background can afford to ask.
 */
import { useAuthStore } from '@/shared/app/AuthStore';
import { useForeground } from '@/shared/app/useRetryTriggers';

import { startDetectorCutoverAfterUpdate } from '../lib/cutoverTrigger';

export function useCutoverRetry(): void {
  useForeground(() => {
    if (useAuthStore.getState().isDemoMode) return;
    startDetectorCutoverAfterUpdate().catch(() => {});
  });
}
