import { useCallback, useEffect, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';

/** How often the cutover is re-read while it holds. Nothing polls once it lifts. */
const RECHECK_MS = 5000;

/** Which of the two things is holding detection, or neither. */
export type DetectionHold = 'elevation' | 'cutover' | null;

function readCutoverHold(): boolean {
  const engine = getEngine();
  if (!engine) return false;
  try {
    return !!engine.isCutoverPending?.() || !!engine.isCutoverRunning?.();
  } catch {
    return false;
  }
}

/**
 * Why the engine is refusing to detect, so the sections page can say which.
 *
 * Two things hold it and they end differently, which is why the answer is a
 * reason rather than a boolean. The elevation backfill suspends detection
 * wholesale for the length of a pass and stays owed while its queue is
 * non-empty, and it waits on the network. The detector cutover refuses every
 * detect until the migration has run, and it clears itself.
 *
 * The backfill answers first: it runs first and the cutover waits behind it,
 * so on the upgrade path, where both hold, the honest sentence is the one
 * about elevation. An unanswerable count is not a hold: `null` must never read
 * as work owed.
 *
 * The cutover turns off at most once in an install's life, so it is read on
 * the `sections` channel, which the migration's own detect fires, with a slow
 * timer only while it holds. The backfill's own hook carries its events.
 */
export function useDetectionHold(): DetectionHold {
  const backfill = useElevationBackfill();
  const [cutoverHeld, setCutoverHeld] = useState(readCutoverHold);

  const recheck = useCallback(() => {
    const next = readCutoverHold();
    setCutoverHeld((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return undefined;
    return engine.subscribe('sections', recheck);
  }, [recheck]);

  useEffect(() => {
    if (!cutoverHeld) return undefined;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [cutoverHeld, recheck]);

  if (backfill.isRunning) return 'elevation';
  if (backfill.remaining !== null && backfill.remaining > 0) return 'elevation';
  return cutoverHeld ? 'cutover' : null;
}
