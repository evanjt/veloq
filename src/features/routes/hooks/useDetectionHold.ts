import { useCallback, useEffect, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';

/** How often the cutover is re-read while it holds. Nothing polls once it lifts. */
const RECHECK_MS = 5000;

/**
 * What is holding detection, or neither.
 *
 * The backfill's three states are told apart because they end differently and
 * only one of them is the athlete's to end. A pass in flight ends on its own,
 * a queue nothing is working on waits on the network, and a pause lifts from
 * the Settings page. They used to read identically, so a library stuck for a
 * fortnight looked exactly like one that was busy.
 */
export type DetectionHold =
  | 'elevation-running'
  | 'elevation-waiting'
  | 'elevation-paused'
  | 'cutover'
  | null;

/** Whether a hold is one of the backfill's, rather than the cutover's. */
export function isElevationHold(hold: DetectionHold): boolean {
  return (
    hold === 'elevation-running' || hold === 'elevation-waiting' || hold === 'elevation-paused'
  );
}

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
 * A pause answers ahead of a pass, because the pass in flight is ending at its
 * next batch and the pause is what the athlete has to lift. It is not a hold
 * on its own: with nothing left to download there is nothing for the pause to
 * hold up.
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
    // Defensive like the read above: a host that cannot answer must not cost
    // the screen its mount.
    try {
      return engine.subscribe?.('sections', recheck);
    } catch {
      return undefined;
    }
  }, [recheck]);

  useEffect(() => {
    if (!cutoverHeld) return undefined;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [cutoverHeld, recheck]);

  const owed = backfill.remaining !== null && backfill.remaining > 0;
  if (backfill.isPaused && (owed || backfill.isRunning)) return 'elevation-paused';
  if (backfill.isRunning) return 'elevation-running';
  if (owed) return 'elevation-waiting';
  return cutoverHeld ? 'cutover' : null;
}
