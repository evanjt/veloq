/**
 * Re-tries for the detector cutover.
 *
 * The launch trigger declines while the elevation backfill still owes fetches,
 * and nothing in that process asks again. Two things can drain it, so two
 * things ask.
 *
 * A backfill that drains while the app is backgrounded is caught by the return
 * to the foreground. A backfill that drains while the app stays open in the
 * foreground gets no such cycle, and waited for a background and foreground
 * pair that might be hours away, so the engine's own phase announcement asks
 * too. The trigger is idempotent and its guards are three engine reads, so
 * either can afford to ask as often as it likes.
 */
import { useEffect } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useForeground } from '@/shared/app/useRetryTriggers';
import { getEngine } from '@/shared/native/engine';

import { startDetectorCutoverAfterUpdate } from '../lib/cutoverTrigger';

/** The channel `EngineObserver.backfill_phase` lands on. */
const PHASE_CHANNEL = 'backfillPhase';

function ask(): void {
  if (useAuthStore.getState().isDemoMode) return;
  startDetectorCutoverAfterUpdate().catch(() => {});
}

export function useCutoverRetry(): void {
  useForeground(ask);

  useEffect(() => {
    return getEngine()?.subscribe?.(PHASE_CHANNEL, ask);
  }, []);
}
