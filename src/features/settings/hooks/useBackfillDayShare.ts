import { useMemo } from 'react';

import { useEngineRead } from '@/shared/native/useEngineSubscription';

/**
 * The activities the backfill draws in one budget day, from the engine's
 * background jobs read. Undefined while the engine cannot answer or has no
 * daily cap, which the callers read as no limit to name.
 */
export function useBackfillDayShare(): number | undefined {
  const readEngine = useEngineRead([]);
  return useMemo(
    () =>
      readEngine((engine) => {
        try {
          return engine.getBackgroundJobsData?.()?.backfillDayShare;
        } catch {
          // empty-on-error: undefined is "could not answer", and the confirm names no days.
          return undefined;
        }
      }),
    [readEngine]
  );
}
