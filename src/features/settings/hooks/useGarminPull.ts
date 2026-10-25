import { useCallback, useEffect, useMemo, useState } from 'react';
import { FfiGarminPullPhase, type FfiGarminPull } from 'veloqrs';

import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { pullGarminNow } from '@/shared/native/garminPull';

/** How often a running or paused pass is read again, in milliseconds. */
const FOLLOW_MS = 5000;

/**
 * The Garmin pull's count, month and state from the engine's background jobs
 * read. No engine event announces the pass, so a running or paused one is read
 * again on a short timer, and a pull now reads once straight away. Undefined
 * while no key is held or the engine could not answer.
 */
export function useGarminPull(): { pull: FfiGarminPull | undefined; pullNow: () => void } {
  const [tick, setTick] = useState(0);
  const readEngine = useEngineRead([], [tick]);
  const pull = useMemo(
    () =>
      readEngine((engine) => {
        try {
          return engine.getBackgroundJobsData?.()?.garminPull;
        } catch {
          // empty-on-error: undefined is "could not answer", and the row stays away.
          return undefined;
        }
      }),
    [readEngine]
  );

  const live =
    pull?.phase === FfiGarminPullPhase.Running || pull?.phase === FfiGarminPullPhase.Paused;
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), FOLLOW_MS);
    return () => clearInterval(timer);
  }, [live]);

  const pullNow = useCallback(() => {
    pullGarminNow();
    setTick((n) => n + 1);
  }, []);

  return { pull, pullNow };
}
